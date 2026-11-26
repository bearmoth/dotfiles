"""Git guardrail (ADR-0004): commands are parsed, not text-matched, and a
fast-forward-only sync is allowed on a default-branch mirror."""

import pytest

from test_git_guardrail import run_main, two_repos


def verdict(guardrail, monkeypatch, tmp_path, command, **kw):
    """"deny" or "allow" for `command` run from a session elsewhere, with the
    mirror repo (default-branch checkout outside the session) at `other`."""
    session, other, repos = two_repos(tmp_path)
    command = command.replace("MIRROR", other)
    res = run_main(guardrail, monkeypatch, tmp_path, command, cwd=session,
                   repos=repos, project_dir=session, **kw)
    return "allow" if res is None else res["hookSpecificOutput"]["permissionDecision"]


# --- fast-forward-only sync is allowed on a mirror ---------------------------

ALLOWED = [
    "git -C MIRROR pull --ff-only",
    "git -C MIRROR pull --ff-only origin main",
    "git -C MIRROR pull --ff-only --autostash -q",
    "git -C MIRROR merge --ff-only origin/main",
    "git -C MIRROR merge --ff-only refs/remotes/origin/main",
    "git -C MIRROR merge --ff-only @{u}",
    "cd MIRROR && git pull --ff-only",
    "git -C MIRROR fetch origin",
    "git -C MIRROR status",
    "git -C MIRROR log --oneline",
]


@pytest.mark.parametrize("command", ALLOWED)
def test_mirror_sync_is_allowed(guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "allow"


# --- everything else stays blocked on a mirror -------------------------------

BLOCKED = [
    "git -C MIRROR commit -m x",
    "git -C MIRROR pull",
    "git -C MIRROR pull origin main",
    "git -C MIRROR pull --rebase",
    "git -C MIRROR pull --ff-only --rebase",
    "git -C MIRROR pull --ff-only --no-ff",
    "git -C MIRROR pull --ff-only . feature",
    "git -C MIRROR merge feature",
    "git -C MIRROR merge --no-ff origin/main",
    "git -C MIRROR merge --ff-only feature",
    "git -C MIRROR merge --ff-only",
    "git -C MIRROR merge --ff-only --squash origin/main",
    "git -C MIRROR rebase origin/main",
    "git -C MIRROR checkout -b topic",
    "git -C MIRROR switch -c topic",
    "git -C MIRROR branch topic",
]


@pytest.mark.parametrize("command", BLOCKED)
def test_mirror_mutation_is_blocked(guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "deny"


def test_deny_message_names_the_ff_only_exception(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   f"git -C {other} commit -m x", cwd=session,
                   repos=repos, project_dir=session)
    assert "pull --ff-only" in res["hookSpecificOutput"]["permissionDecisionReason"]


# --- chains: every git command in the command is vetted ----------------------


def test_chained_commit_is_caught(guardrail, monkeypatch, tmp_path):
    cmd = "git -C MIRROR add -A && git -C MIRROR commit -m x"
    assert verdict(guardrail, monkeypatch, tmp_path, cmd) == "deny"


def test_commit_after_allowed_sync_is_caught(guardrail, monkeypatch, tmp_path):
    cmd = "git -C MIRROR pull --ff-only && git -C MIRROR commit -m x"
    assert verdict(guardrail, monkeypatch, tmp_path, cmd) == "deny"


@pytest.mark.parametrize("command", [
    "echo hi | git -C MIRROR commit -F -",
    "echo hi; git -C MIRROR commit -m x",
    "false || git -C MIRROR commit -m x",
])
def test_commit_in_pipeline_and_sequence_is_caught(
        guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "deny"


@pytest.mark.parametrize("command", [
    "bash -c 'git -C MIRROR commit -m x'",
    'sh -c "cd MIRROR && git commit -m x"',
    "echo \"$(git -C MIRROR commit -m x)\"",
    "echo `git -C MIRROR commit -m x`",
    "(cd MIRROR && git commit -m x)",
    "env GIT_AUTHOR_NAME=x git -C MIRROR commit -m x",
    "sudo git -C MIRROR commit -m x",
    "eval 'git -C MIRROR commit -m x'",
    "bash <<EOF\ngit -C MIRROR commit -m x\nEOF",
])
def test_git_hidden_behind_shell_constructs_is_caught(
        guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "deny"


def test_cd_in_a_closed_subshell_does_not_leak(guardrail, monkeypatch, tmp_path):
    """The commit runs in the session repo, which is exempt."""
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   f"(cd {other}); git commit -m x", cwd=session,
                   repos=repos, project_dir=session)
    assert res is None


# --- unresolvable targets still fail closed ----------------------------------


@pytest.mark.parametrize("command", [
    "git -C $REPO commit -m x",
    "git -C $REPO pull --ff-only",
    'git -C "$(pwd)/x" pull --ff-only',
    "cd $REPO && git pull --ff-only",
    "git -C /a -C $REPO pull --ff-only",
])
def test_unresolvable_target_is_blocked_even_for_ff_only(
        guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "deny"


# --- text that merely mentions git or the mirror path is not git -------------

NOT_GIT = [
    'eos-issue log --summary "x" --actual "pull --ff-only on MIRROR; git pull failed"',
    "echo 'git -C MIRROR commit -m x'",
    'echo "git -C MIRROR commit -m x"',
    "printf '%s\\n' 'git -C MIRROR pull'",
    "grep -rn 'git commit' MIRROR",
    "gh issue create --body 'run git -C MIRROR rebase main'",
    "git -C MIRROR log --grep 'git commit'",
    "# git -C MIRROR commit -m x",
    "cat <<EOF\ngit -C MIRROR commit -m x\nEOF",
    "cat <<'EOF' > notes.md\ngit -C MIRROR pull\nEOF",
    "cat <<-EOF\n\tgit -C MIRROR commit -m x\n\tEOF",
    "echo hi > git-commit.txt",
    "git-lfs -C MIRROR commit",
    "legit -C MIRROR commit -m x",
]


@pytest.mark.parametrize("command", NOT_GIT)
def test_non_git_text_is_not_blocked(guardrail, monkeypatch, tmp_path, command):
    assert verdict(guardrail, monkeypatch, tmp_path, command) == "allow"


def test_command_after_heredoc_is_still_parsed(guardrail, monkeypatch, tmp_path):
    cmd = "cat <<EOF\nhello\nEOF\ngit -C MIRROR commit -m x"
    assert verdict(guardrail, monkeypatch, tmp_path, cmd) == "deny"


def test_commit_message_heredoc_with_quotes_does_not_hide_the_commit(
        guardrail, monkeypatch, tmp_path):
    cmd = ("git -C MIRROR commit -m \"$(cat <<'EOF'\n"
           "it's a message with ) and ' chars\nEOF\n)\"")
    assert verdict(guardrail, monkeypatch, tmp_path, cmd) == "deny"


# --- parser units -------------------------------------------------------------


def test_find_git_invocations_reports_subcommand_and_args(guardrail):
    invs = guardrail.find_git_invocations(
        "cd /x && git -C sub -c a=b --no-pager pull --ff-only origin main")
    assert [(i.sub, i.args, i.c_paths, i.cds) for i in invs] == [
        ("pull", ["--ff-only", "origin", "main"], ["sub"], ["/x"])]


def test_ff_only_flag_allowlist_rejects_unknown_flags(guardrail):
    classify = guardrail.classify
    inv = lambda s: guardrail.find_git_invocations(s)[0]
    assert classify(inv("git pull --ff-only")) == "ff-sync"
    assert classify(inv("git pull --ff-only --rebas")) == "mutating"
    assert classify(inv("git pull --ff-only --no-ff")) == "mutating"
    assert classify(inv("git status")) is None
