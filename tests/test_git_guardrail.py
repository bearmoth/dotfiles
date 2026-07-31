"""Git guardrail (ADR-0004) target resolution: `cd`/`pushd` prefixes now
resolve the guardrail target (closing the `cd /other/repo && git merge`
bypass), and mutating commands with a statically unresolvable cd fail closed."""

import io
import json
import os
from contextlib import redirect_stdout

HOME = os.path.expanduser("~")


# --- static_path -------------------------------------------------------------


def test_static_path_forms(guardrail):
    sp = guardrail.static_path
    assert sp("/abs/path", "/base") == os.path.realpath("/abs/path")
    assert sp('"/abs/my path"', "/base") == os.path.realpath("/abs/my path")
    assert sp("'/abs/my path'", "/base") == os.path.realpath("/abs/my path")
    assert sp("~/repo", "/base") == os.path.realpath(os.path.join(HOME, "repo"))
    assert sp("$HOME/repo", "/base") == os.path.realpath(os.path.join(HOME, "repo"))
    assert sp("${HOME}/repo", "/base") == os.path.realpath(os.path.join(HOME, "repo"))
    assert sp("rel/dir", "/base") == os.path.realpath("/base/rel/dir")
    assert sp("", "/base") == os.path.realpath(HOME)  # bare `cd`


def test_static_path_fails_on_dynamic_constructs(guardrail):
    sp = guardrail.static_path
    assert sp("$REPO", "/base") is None
    assert sp("$(pwd)/x", "/base") is None
    assert sp("`pwd`", "/base") is None
    assert sp("-", "/base") is None  # cd - : previous dir, unknowable


# --- resolve_target ----------------------------------------------------------


def test_resolve_target_plain_cd(guardrail):
    t, why = guardrail.resolve_target("cd /other/repo && git merge x", "/session")
    assert why is None and t == os.path.realpath("/other/repo")


def test_resolve_target_quoted_and_tilde_and_home(guardrail):
    for cmd, expect in [
        ('cd "/other/my repo" && git commit -m x', "/other/my repo"),
        ("cd ~/repo && git rebase main", os.path.join(HOME, "repo")),
        ("cd $HOME/repo; git merge x", os.path.join(HOME, "repo")),
        ("pushd /other/repo && git pull", "/other/repo"),
    ]:
        t, why = guardrail.resolve_target(cmd, "/session")
        assert why is None, cmd
        assert t == os.path.realpath(expect), cmd


def test_resolve_target_no_cd_uses_cwd(guardrail):
    t, why = guardrail.resolve_target("git merge x", "/session")
    assert why is None and t == os.path.realpath("/session")


def test_resolve_target_git_c_composes_with_cd(guardrail):
    t, why = guardrail.resolve_target("cd /base && git -C sub merge x", "/session")
    assert why is None and t == os.path.realpath("/base/sub")
    t, why = guardrail.resolve_target("cd /base && git -C /abs merge x", "/session")
    assert why is None and t == os.path.realpath("/abs")


def test_resolve_target_fails_closed_on_variables(guardrail):
    t, why = guardrail.resolve_target("cd $REPO && git merge x", "/session")
    assert t is None and "git -C" in why
    t, why = guardrail.resolve_target("cd $(mktemp -d) && git commit -m x", "/session")
    assert t is None
    t, why = guardrail.resolve_target(
        "cd /a && cd b && git merge x", "/session")  # multiple hops
    assert t is None and "git -C" in why


def test_resolve_target_cd_after_git_is_ignored(guardrail):
    t, why = guardrail.resolve_target("git merge x && cd /elsewhere", "/session")
    assert why is None and t == os.path.realpath("/session")


# --- main() integration -------------------------------------------------------


def fake_git_factory(repos):
    """repos: {root: {"branch": ..., "default": ...}} — answers the three git
    queries the hook makes, keyed by which root contains cwd."""
    def fake_git(args, cwd=None):
        rc = os.path.realpath(cwd or "")
        root = next((r for r in repos if rc == r or rc.startswith(r + os.sep)), None)
        if root is None:
            return None
        if args[:2] == ["rev-parse", "--show-toplevel"]:
            return root
        if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
            return repos[root]["branch"]
        if args == ["symbolic-ref", "refs/remotes/origin/HEAD"]:
            return f"refs/remotes/origin/{repos[root]['default']}"
        return None
    return fake_git


def run_main(guardrail, monkeypatch, tmp_path, command, cwd, repos,
             vaults=(), context="personal", project_dir=None):
    monkeypatch.setattr(guardrail, "STATE", str(tmp_path / "state"))
    monkeypatch.setattr(guardrail, "git", fake_git_factory(repos))
    monkeypatch.setattr(guardrail, "get_vaults", lambda: list(vaults))
    monkeypatch.setattr(guardrail, "get_context", lambda p: context)
    if project_dir:
        monkeypatch.setenv("CLAUDE_PROJECT_DIR", project_dir)
    else:
        monkeypatch.delenv("CLAUDE_PROJECT_DIR", raising=False)
    buf = io.StringIO()
    with redirect_stdout(buf):
        guardrail.main({"tool_name": "Bash", "session_id": "s",
                        "tool_input": {"command": command}, "cwd": cwd})
    out = buf.getvalue().strip()
    return json.loads(out) if out else None


def two_repos(tmp_path):
    session = os.path.realpath(str(tmp_path / "session-repo"))
    other = os.path.realpath(str(tmp_path / "other-repo"))
    os.makedirs(session), os.makedirs(other)
    repos = {session: {"branch": "feature", "default": "main"},
             other: {"branch": "main", "default": "main"}}
    return session, other, repos


def test_cd_bypass_is_blocked(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   f"cd {other} && git merge --ff-only", cwd=session,
                   repos=repos, project_dir=session)
    assert res["hookSpecificOutput"]["permissionDecision"] == "deny"
    assert "ADR-0004" in res["hookSpecificOutput"]["permissionDecisionReason"]


def test_unresolvable_cd_fails_closed(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   "cd $OTHER_REPO && git merge --ff-only", cwd=session,
                   repos=repos, project_dir=session)
    out = res["hookSpecificOutput"]
    assert out["permissionDecision"] == "deny"
    assert "statically" in out["permissionDecisionReason"]
    assert "git -C" in out["permissionDecisionReason"]


def test_non_mutating_command_with_cd_unaffected(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   "cd $OTHER_REPO && git status", cwd=session,
                   repos=repos, project_dir=session)
    assert res is None


def test_cd_into_own_workspace_root_exempt(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   f"cd {session} && git commit -m x", cwd=session,
                   repos=repos, project_dir=session)
    assert res is None


def test_cd_into_vault_exempt(guardrail, monkeypatch, tmp_path):
    session, other, repos = two_repos(tmp_path)
    res = run_main(guardrail, monkeypatch, tmp_path,
                   f"cd {other} && git commit -m 'vault sync'", cwd=session,
                   repos=repos, vaults=[{"name": "PKB", "path": other}],
                   project_dir=session)
    assert res is None
