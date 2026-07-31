#!/usr/bin/env python3
"""PreToolUse git guardrail (ADR-0004, wayfinder #13/#23).

Mutating git commands (commit, pull, merge, rebase, branch creation) are
blocked when the target working tree is a *repo's* default-branch checkout
that isn't the session's own workspace root. Local main is a read-only
mirror; work happens on worktrees cut from origin.

Load-bearing carve-outs:
- The session's own workspace root is exempt (a session started in a
  checkout owns it — this dotfiles repo commits on main legitimately).
- Vaults are exempt entirely (vault != repo; commit-on-main is their
  designed write path; their safety regime is ADR-0002/0005).
- A repo resolving to NO context is blocked loudly — a routing gap
  surfacing itself, never a silent pass.

Target resolution: explicit `git -C <path>` wins; else a `cd`/`pushd` that
precedes the mutating git command in a compound command (`cd X && git ...`)
resolves the target to X — the bypass this closes is `cd /other/repo &&
git merge` slipping past as the session cwd. Quoted paths, `~`, and
$HOME/${HOME} resolve statically; anything the hook cannot resolve
statically (other variables, subshells, multiple cd hops) FAILS CLOSED for
mutating commands, with a rephrase hint (`git -C`). Non-mutating commands
are untouched.

Fails soft on internal errors (never bricks Bash), but denials themselves
are deterministic.
"""

import json
import os
import re
import subprocess
import sys
import time

EOS = os.path.expanduser("~/.local/bin/eos-resolve")
STATE = os.path.expanduser(os.environ.get("EOS_STATE", "~/.local/state/engineering-os"))

MUTATING_RE = re.compile(
    r"\bgit\b(?:\s+(?:-[a-zA-Z]\S*|-C\s+\S+|--\S+))*\s+"
    r"(commit|pull|merge|rebase|checkout\s+-b|switch\s+(?:-c|--create)|branch\s+(?!-d|-D|--delete|--list|-l\b|--show-current|-a\b|--all|-r\b|-v)\S)"
)
GIT_C_RE = re.compile(r"\bgit\s+(?:[^|;&]*?)-C\s+(\"[^\"]+\"|'[^']+'|\S+)")
# A cd/pushd step: at command start or after a separator. Path may be quoted,
# empty (bare `cd` -> $HOME), or a bare token.
CD_RE = re.compile(
    r"(?:^|&&|\|\||[;|&\n])\s*(cd|pushd)\b\s*(\"[^\"]*\"|'[^']*'|[^\s;&|]*)"
)


def static_path(raw, base):
    """Statically resolve a shell path token (quote-stripping, ~, $HOME);
    None when it needs shell evaluation (other variables, substitutions)."""
    p = (raw or "").strip()
    if len(p) >= 2 and p[0] == p[-1] and p[0] in "\"'":
        p = p[1:-1]
    if not p:
        return os.path.realpath(os.path.expanduser("~"))  # bare `cd`
    home = os.path.expanduser("~")
    p = p.replace("${HOME}", home).replace("$HOME", home)
    if re.search(r"[$`]", p) or "(" in p or p == "-":
        return None
    p = os.path.expanduser(p)
    if not os.path.isabs(p):
        p = os.path.join(base, p)
    return os.path.realpath(p)


def resolve_target(command, cwd):
    """(target_path, deny_reason) for a command already known to mutate.
    Exactly one of the pair is None. Priority: a cd/pushd before the mutating
    git command rebases the working directory; an explicit `git -C` then wins
    over (or composes with) it. Anything not statically resolvable fails
    closed — deny_reason explains and points at `git -C`."""
    how_to = (
        " Rephrase with an explicit static path — `git -C <absolute-path> ...` "
        "with no shell variables or substitutions — so the guardrail can vet "
        "the target (ADR-0004)."
    )
    mut = MUTATING_RE.search(command)
    mut_pos = mut.start() if mut else len(command)
    base = cwd
    cds = [m for m in CD_RE.finditer(command) if m.start() < mut_pos]
    if len(cds) > 1:
        return None, (
            "Git guardrail (ADR-0004): this mutating git command follows "
            "multiple cd/pushd steps, which the guardrail cannot statically "
            "resolve, so it is blocked (fail closed)." + how_to
        )
    if cds:
        p = static_path(cds[0].group(2), cwd)
        if p is None:
            return None, (
                f"Git guardrail (ADR-0004): this mutating git command follows "
                f"`{cds[0].group(1)} {cds[0].group(2)}`, whose path cannot be "
                "statically resolved (variables/subshells), so it is blocked "
                "(fail closed)." + how_to
            )
        base = p
    m = GIT_C_RE.search(command)
    if m:
        p = static_path(m.group(1), base)
        if p is None:
            return None, (
                f"Git guardrail (ADR-0004): the `git -C {m.group(1)}` path "
                "cannot be statically resolved (variables/subshells), so this "
                "mutating command is blocked (fail closed)." + how_to
            )
        return p, None
    return os.path.realpath(base), None


def audit(event, session_id, detail):
    try:
        os.makedirs(STATE, exist_ok=True)
        with open(os.path.join(STATE, "audit.jsonl"), "a") as f:
            f.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "session": session_id,
                        "event": event,
                        "detail": detail,
                    }
                )
                + "\n"
            )
    except OSError:
        pass


def git(args, cwd=None):
    try:
        r = subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, timeout=10
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def issue_breadcrumb(hook, session, err, severity="friction"):
    """A hook crash is the only eos defect a hook can honestly self-report
    (ADR-0007): fail-open would otherwise swallow it silently. Drop one
    sighting into the same backlog inbox the `/eos-issue` command writes,
    once per session so a persistently-crashing hook nudges without flooding.
    Must never raise — it runs inside the fail-open handler."""
    try:
        sdir = os.path.join(STATE, "sessions", session)
        marker = os.path.join(sdir, f"issue-{hook}")
        if os.path.exists(marker):
            return
        os.makedirs(STATE, exist_ok=True)  # first-writer-creates
        with open(os.path.join(STATE, "eos-issues.jsonl"), "a", encoding="utf-8") as f:
            f.write(
                json.dumps(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                        "source": f"hook:{hook}",
                        "component": f"{hook} hook",
                        "severity": severity,
                        "summary": f"{hook} hook raised and failed open: {err}",
                        "session": session,
                    }
                )
                + "\n"
            )
        os.makedirs(sdir, exist_ok=True)
        open(marker, "w").close()
    except Exception:
        pass


def deny(reason, session, detail):
    audit("guardrail_block", session, detail)
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )


def get_vaults():
    """Registered vaults, as `eos-resolve vaults --json`. Injectable."""
    try:
        return json.loads(
            subprocess.run(
                [EOS, "vaults", "--json"], capture_output=True, text=True, timeout=15
            ).stdout
        )
    except (ValueError, OSError):
        return []


def get_context(path):
    """Owning context of `path` (None if unresolved). Injectable."""
    try:
        r = subprocess.run(
            [EOS, "context", "--json", path], capture_output=True, text=True, timeout=15
        )
        return json.loads(r.stdout).get("context")
    except (ValueError, OSError, subprocess.TimeoutExpired):
        return None


def main(data):
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command", "")
    session = data.get("session_id", "unknown")
    if not MUTATING_RE.search(command):
        return

    # Target working tree: cd/pushd prefix and/or `git -C` win, else hook cwd.
    # Unresolvable targets fail closed (a mutating command must be vettable).
    target, deny_reason = resolve_target(command, data.get("cwd") or os.getcwd())
    if deny_reason:
        deny(deny_reason, session, {"command": command[:200], "reason": "unresolvable-target"})
        return

    # Vaults are exempt entirely.
    for v in get_vaults():
        p = v.get("path")
        if p:
            p = os.path.realpath(p)
            if target == p or target.startswith(p + os.sep):
                return

    repo_root = git(["rev-parse", "--show-toplevel"], cwd=target if os.path.isdir(target) else os.path.dirname(target))
    if not repo_root:
        return  # not a repo; git will fail on its own
    repo_root = os.path.realpath(repo_root)

    # The session's own workspace root is exempt.
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if project_dir:
        own_root = git(["rev-parse", "--show-toplevel"], cwd=project_dir)
        if own_root and os.path.realpath(own_root) == repo_root:
            return

    # A repo resolving to no context is a routing gap — block loudly.
    resolved = get_context(repo_root)
    if not resolved:
        deny(
            f"Git guardrail: {repo_root} resolves to no context — a routing "
            "gap, not a permission to proceed. Add an ownership pattern or "
            "machine root via the registry-maintenance skill, then retry.",
            session,
            {"target": repo_root, "reason": "unresolved"},
        )
        return

    # Only default-branch checkouts are protected.
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root)
    default = None
    head_ref = git(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd=repo_root)
    if head_ref:
        default = head_ref.rsplit("/", 1)[-1]
    if default is None and branch in ("main", "master"):
        default = branch
    if branch and default and branch == default:
        deny(
            f"Git guardrail (ADR-0004): {repo_root} is a default-branch "
            f"checkout ({branch}) outside this session's workspace — local "
            "main is a read-only mirror. Provision a worktree instead: use "
            "the worktree-provisioning skill (cut from origin/"
            f"{default} after a fetch).",
            session,
            {"target": repo_root, "branch": branch},
        )


if __name__ == "__main__":
    session = "unknown"
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        session = payload.get("session_id", "unknown")
        main(payload)
    except Exception as e:  # fail open
        print(f"eos-git-guardrail: {e}", file=sys.stderr)
        issue_breadcrumb("eos-git-guardrail", session, str(e), severity="blocking")
        sys.exit(0)
