"""`eos-resolve health` — read-only one-shot report: every line carries an
OK/ATTN marker, ends with a one-line verdict; vault git state and worktree
cleanup candidates come from real (temporary) git repos."""

import os
import subprocess


def run_git(cwd, *args):
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd, capture_output=True, text=True, check=True,
    ).stdout.strip()


def test_health_output_shape(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    reg = {"machine": {}, "contexts": {"personal": {"vaults": {}}}}
    lines = resolver.compute_health(reg)
    assert lines, "health produced no lines"
    *items, verdict = lines
    for l in items:
        assert l.startswith(("OK  ", "ATTN")), l
    assert verdict.startswith("verdict:")
    # always-present items
    assert any("queue:" in l for l in items)
    assert any("eos-issues:" in l for l in items)
    assert any("worktrees:" in l or "worktree " in l for l in items)


def test_health_verdict_counts_attn(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    state = tmp_path / "state"
    state.mkdir()
    (state / "eos-issues.jsonl").write_text(
        '{"ts": "2026-07-01T00:00:00+0000", "severity": "blocking", "summary": "x"}\n'
    )
    reg = {"machine": {}, "contexts": {"personal": {"vaults": {}}}}
    lines = resolver.compute_health(reg)
    (issues,) = [l for l in lines if "eos-issues:" in l and "pulse:" not in l]
    assert issues.startswith("ATTN")
    assert "1 blocking" in issues
    assert "need attention" in lines[-1]


def test_vault_git_state_counts(resolver, tmp_path):
    repo = tmp_path / "vault"
    repo.mkdir()
    run_git(repo, "init", "-q")
    (repo / "tracked.md").write_text("a\n")
    run_git(repo, "add", "tracked.md")
    run_git(repo, "commit", "-qm", "init")
    (repo / "tracked.md").write_text("b\n")   # 1 dirty
    (repo / "new.md").write_text("c\n")       # 1 untracked
    dirty, untracked, unpushed = resolver.vault_git_state(str(repo))
    assert (dirty, untracked) == (1, 1)
    assert unpushed is None  # no upstream configured
    assert resolver.vault_git_state(str(tmp_path / "not-a-repo")) is None


def test_health_flags_dirty_vault(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    repo = tmp_path / "vault"
    repo.mkdir()
    run_git(repo, "init", "-q")
    (repo / "x.md").write_text("x\n")  # untracked
    reg = {"machine": {}, "contexts": {"personal": {"vaults": {
        "wiki": {"name": "Tech Notes", "exposure": "personal",
                 "private": False, "path": str(repo)},
    }}}}
    lines = resolver.compute_health(reg)
    (vline,) = [l for l in lines if "vault Tech Notes:" in l]
    assert vline.startswith("ATTN")
    assert "1 untracked" in vline


def test_worktree_removable_detection(resolver, tmp_path):
    # "origin": a bare-ish upstream with main; worktree root holds a merged,
    # clean checkout of a feature branch -> removable.
    origin = tmp_path / "origin"
    origin.mkdir()
    run_git(origin, "init", "-q", "-b", "main")
    (origin / "f.md").write_text("1\n")
    run_git(origin, "add", "f.md")
    run_git(origin, "commit", "-qm", "one")

    wtroot = tmp_path / "worktrees"
    clone = wtroot / "owner" / "repo" / "merged-branch"
    os.makedirs(clone.parent)
    run_git(tmp_path, "clone", "-q", str(origin), str(clone))
    run_git(clone, "checkout", "-qb", "merged-branch")  # same tip as origin/main

    found = resolver.find_worktrees(str(wtroot))
    assert [os.path.realpath(str(clone))] == [os.path.realpath(p) for p in found]
    branch, default = resolver.worktree_removable(str(clone))
    assert (branch, default) == ("merged-branch", "main")

    # An unmerged commit or a dirty tree disqualifies it.
    (clone / "g.md").write_text("2\n")
    assert resolver.worktree_removable(str(clone)) is None
