"""eos-push-gate — push-time exposure gate for org vaults (#29): pre-push
stdin parsing, the outbound summary (subjects, per-file adds/dels, the
outside-wiki/ and large-add flags), the TTY / env-ack decision branches, and
--install's vault-root refusal + shim wiring."""

import io
import os
import subprocess

import pytest

ZERO = "0" * 40


def run_git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd, capture_output=True, text=True, check=True,
    ).stdout.strip()


@pytest.fixture
def vault_repo(tmp_path):
    """A vault-ish repo with an 'already pushed' base commit and two
    outbound commits: a small wiki edit and a large non-wiki add."""
    repo = tmp_path / "vault"
    repo.mkdir()
    run_git(repo, "init", "-q", "-b", "main")
    (repo / "wiki").mkdir()
    (repo / "wiki" / "note.md").write_text("one\n")
    run_git(repo, "add", ".")
    run_git(repo, "commit", "-qm", "base")
    base = run_git(repo, "rev-parse", "HEAD")

    (repo / "wiki" / "note.md").write_text("one\ntwo\n")
    run_git(repo, "add", ".")
    run_git(repo, "commit", "-qm", "wiki: extend note")
    (repo / "raw").mkdir()
    (repo / "raw" / "dump.md").write_text("x\n" * 300)
    run_git(repo, "add", ".")
    run_git(repo, "commit", "-qm", "raw: big dump")
    head = run_git(repo, "rev-parse", "HEAD")
    return {"path": str(repo), "base": base, "head": head}


def ref_line(local_sha, remote_sha):
    return f"refs/heads/main {local_sha} refs/heads/main {remote_sha}"


# --- stdin parsing -----------------------------------------------------------


def test_parse_ref_lines_skips_deletions_and_junk(push_gate):
    lines = [
        ref_line("a" * 40, "b" * 40),
        f"refs/heads/gone {ZERO} refs/heads/gone {'c' * 40}",  # deletion
        "not a ref line",
        "",
    ]
    updates = push_gate.parse_ref_lines(lines)
    assert len(updates) == 1
    assert updates[0]["local_sha"] == "a" * 40


def test_rev_range_new_branch_vs_update(push_gate):
    upd = {"local_sha": "a" * 40, "remote_sha": "b" * 40}
    assert push_gate.rev_range(upd) == [f"{'b' * 40}..{'a' * 40}"]
    new = {"local_sha": "a" * 40, "remote_sha": ZERO}
    assert push_gate.rev_range(new) == ["a" * 40, "--not", "--remotes"]


# --- summary -----------------------------------------------------------------


def test_summary_counts_subjects_files_and_flags(push_gate, vault_repo):
    updates = push_gate.parse_ref_lines(
        [ref_line(vault_repo["head"], vault_repo["base"])])
    lines = push_gate.summary_lines(updates, "origin", "git@example:v.git",
                                    repo=vault_repo["path"])
    text = "\n".join(lines)
    assert "outbound to origin" in text
    assert "2 commits" in text
    assert "- wiki: extend note" in text
    assert "- raw: big dump" in text
    # wiki file: 1 add, 0 dels, no flags
    (wiki_line,) = [l for l in lines if "wiki/note.md" in l]
    assert "+1" in wiki_line and "[outside wiki/]" not in wiki_line
    # raw file: outside wiki/ and >200 added lines, both flagged
    (raw_line,) = [l for l in lines if "raw/dump.md" in l]
    assert "[outside wiki/]" in raw_line
    assert "[+300 lines added]" in raw_line


def test_summary_new_branch_uses_not_remotes(push_gate, vault_repo):
    # No remotes in the fixture repo, so a new-branch push summarises all
    # three commits without crashing.
    updates = push_gate.parse_ref_lines([ref_line(vault_repo["head"], ZERO)])
    lines = push_gate.summary_lines(updates, "origin", "url",
                                    repo=vault_repo["path"])
    assert any("3 commits" in l for l in lines)


# --- gate decision branches ----------------------------------------------------


def _gate(push_gate, monkeypatch, vault_repo, tty, ack, err=None):
    monkeypatch.setattr(push_gate, "open_tty", lambda: tty)
    if ack is None:
        monkeypatch.delenv("EOS_PUSH_ACK", raising=False)
    else:
        monkeypatch.setenv("EOS_PUSH_ACK", ack)
    err = err if err is not None else io.StringIO()
    stdin = io.StringIO(ref_line(vault_repo["head"], vault_repo["base"]) + "\n")
    rc = push_gate.main(argv=["origin", "url"], stdin=stdin,
                        repo=vault_repo["path"])
    return rc, err


class FakeTTY(io.StringIO):
    def __exit__(self, *a):  # `with tty:` in gate()
        return False


def test_no_tty_no_ack_blocks_with_relay_instructions(push_gate, monkeypatch,
                                                      vault_repo, capsys):
    rc, _ = _gate(push_gate, monkeypatch, vault_repo, tty=None, ack=None)
    assert rc == 1
    err = capsys.readouterr().err
    assert "BLOCKED" in err
    assert "EOS_PUSH_ACK=1" in err
    assert "raw/dump.md" in err  # the summary was printed before blocking


def test_no_tty_with_ack_proceeds(push_gate, monkeypatch, vault_repo, capsys):
    rc, _ = _gate(push_gate, monkeypatch, vault_repo, tty=None, ack="1")
    assert rc == 0
    assert "acknowledged via EOS_PUSH_ACK=1" in capsys.readouterr().err


def test_tty_yes_proceeds_no_declines(push_gate, monkeypatch, vault_repo):
    rc, _ = _gate(push_gate, monkeypatch, vault_repo, tty=FakeTTY("y\n"), ack=None)
    assert rc == 0
    rc, _ = _gate(push_gate, monkeypatch, vault_repo, tty=FakeTTY("\n"), ack=None)
    assert rc == 1  # default is N


def test_tty_confirm_beats_env_ack(push_gate, monkeypatch, vault_repo):
    # With a human present, their answer decides — the ack is for agents.
    rc, _ = _gate(push_gate, monkeypatch, vault_repo, tty=FakeTTY("n\n"), ack="1")
    assert rc == 1


def test_deletion_only_push_passes_silently(push_gate, monkeypatch, capsys):
    monkeypatch.setattr(push_gate, "open_tty", lambda: None)
    monkeypatch.delenv("EOS_PUSH_ACK", raising=False)
    stdin = io.StringIO(f"refs/heads/gone {ZERO} refs/heads/gone {'c' * 40}\n")
    assert push_gate.main(argv=["origin", "url"], stdin=stdin) == 0
    assert capsys.readouterr().err == ""


# --- --install -----------------------------------------------------------------


def test_install_refuses_non_vault_path(push_gate, tmp_path, capsys):
    repo = tmp_path / "not-a-vault"
    repo.mkdir()
    run_git(repo, "init", "-q")
    rc = push_gate.install(str(repo), roots=set())
    assert rc == 1
    assert "not a registered vault root" in capsys.readouterr().err
    assert not (repo / ".githooks").exists()


def test_install_writes_shim_and_hookspath(push_gate, vault_repo, capsys):
    root = os.path.realpath(vault_repo["path"])
    rc = push_gate.install(vault_repo["path"], roots={root})
    assert rc == 0
    hook = os.path.join(root, ".githooks", "pre-push")
    content = open(hook).read()
    assert push_gate.SHIM_MARKER in content
    assert "eos-push-gate" in content
    assert os.access(hook, os.X_OK)
    assert run_git(vault_repo["path"], "config", "core.hooksPath") == ".githooks"
    # Idempotent: re-install over our own shim is fine.
    assert push_gate.install(vault_repo["path"], roots={root}) == 0


def test_install_refuses_to_clobber_foreign_hook(push_gate, vault_repo, capsys):
    root = os.path.realpath(vault_repo["path"])
    hooks = os.path.join(root, ".githooks")
    os.makedirs(hooks)
    foreign = os.path.join(hooks, "pre-push")
    with open(foreign, "w") as f:
        f.write("#!/bin/sh\n# journal remote pin\nexit 1\n")
    rc = push_gate.install(vault_repo["path"], roots={root})
    assert rc == 1
    assert "not an eos-push-gate shim" in capsys.readouterr().err
    assert "journal remote pin" in open(foreign).read()  # untouched
