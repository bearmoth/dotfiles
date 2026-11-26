#!/usr/bin/env python3
"""PreToolUse git guardrail (ADR-0004, wayfinder #13/#23).

Mutating git commands (commit, pull, merge, rebase, branch creation) are
blocked when the target working tree is a *repo's* default-branch checkout
that isn't the session's own workspace root. Local main is a read-only
mirror; work happens on worktrees cut from origin. The one carve-out on a
mirror is a fast-forward-only sync from origin: `git pull --ff-only` and
`git merge --ff-only <origin/default>` land no local work.

Load-bearing carve-outs:
- The session's own workspace root is exempt (a session started in a
  checkout owns it — this dotfiles repo commits on main legitimately).
- Vaults are exempt entirely (vault != repo; commit-on-main is their
  designed write path; their safety regime is ADR-0002/0005).
- A repo resolving to NO context is blocked loudly — a routing gap
  surfacing itself, never a silent pass.

The command is parsed into simple commands (quotes, heredocs, `$(...)`,
`&&`/`;`/`|` chains, `bash -c`) and only a segment that actually runs git is
inspected, so words inside another program's quoted arguments never match.

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

BRANCH_READONLY_RE = re.compile(
    r"-d|-D|--delete|--list|-l\b|--show-current|-a\b|--all|-r\b|-v"
)
ASSIGN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_-]*$")
REMOTE_NAME_RE = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]*$")
# Words that may precede the real program in a simple command.
KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do", "!", "{", "}",
            "time", "builtin", "coproc"}
# Programs that run another program given later in their argument list.
WRAPPERS = {"command", "exec", "env", "nohup", "nice", "sudo", "doas", "xargs",
            "timeout"}
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
# Flags a fast-forward sync may carry; anything else is treated as mutating
# (git abbreviates long options, so an allowlist is the only safe form).
FF_SAFE_FLAGS = {"--ff-only", "-q", "--quiet", "-v", "--verbose", "--autostash",
                 "--no-autostash", "--no-edit", "--stat", "--no-stat", "-n",
                 "--progress", "--no-progress", "--prune", "--tags", "--no-tags",
                 "--all", "-p", "--verify-signatures", "--no-verify-signatures"}
# git global options that consume the next word.
GIT_OPTS_WITH_ARG = {"-c", "--git-dir", "--work-tree", "--namespace",
                     "--super-prefix", "--config-env"}
# A dynamic word keeps a literal `$` so static_path() refuses to resolve it.
DYNAMIC = "$(...)"


class Invocation(object):
    """One git command found in a shell command string."""

    def __init__(self, sub, args, c_paths, cds):
        self.sub = sub
        self.args = args
        self.c_paths = c_paths  # raw `git -C` words, in order
        self.cds = cds  # raw cd/pushd words that precede it in scope


def _read_heredoc_body(s, i, delim, strip_tabs):
    """(body, index after the terminator line) for a heredoc whose body
    starts at s[i]."""
    n = len(s)
    start = i
    while i < n:
        j = s.find("\n", i)
        line_end = n if j == -1 else j
        line = s[i:line_end]
        if strip_tabs:
            line = line.lstrip("\t")
        if line == delim:
            return s[start:i], (n if j == -1 else j + 1)
        i = n if j == -1 else j + 1
    return s[start:], n


def _skip_backticks(s, i):
    """Index of the backtick closing the one at s[i] (len(s) if unclosed)."""
    n = len(s)
    j = i + 1
    while j < n and s[j] != "`":
        j += 2 if s[j] == "\\" else 1
    return min(j, n)


def _parse(s, i, cds, out, sub):
    """Walk shell text from s[i], appending an Invocation to `out` for every
    simple command that runs git. `cds` is the cd/pushd list of the current
    scope (subshells and substitutions get a copy). Returns the index after
    the closing paren when `sub`, else len(s)."""
    n = len(s)
    words = []
    cur = None
    pending = []  # heredocs whose bodies follow the next newline

    def flush_word():
        nonlocal cur
        if cur is not None:
            words.append("".join(cur))
            cur = None

    def end_segment():
        flush_word()
        if words:
            shell = _handle(list(words), cds, out)
            for p in pending:
                if "shell" not in p:
                    p["shell"] = shell
                    p["cds"] = list(cds)
            del words[:]

    def append(text):
        nonlocal cur
        if cur is None:
            cur = []
        cur.append(text)

    def substitution(j):
        return _parse(s, j, list(cds), out, True)

    def backticks(j):
        end = _skip_backticks(s, j)
        _parse(s[j + 1:end], 0, list(cds), out, False)
        return end + 1

    while i < n:
        c = s[i]
        if c in " \t":
            flush_word()
            i += 1
        elif c == "\n":
            end_segment()
            i += 1
            for p in pending:
                body, i = _read_heredoc_body(s, i, p["delim"], p["strip"])
                if p.get("shell"):
                    _parse(body, 0, p["cds"], out, False)
            del pending[:]
        elif c == "\\":
            if i + 1 < n and s[i + 1] == "\n":
                i += 2
            else:
                if i + 1 < n:
                    append(s[i + 1])
                i += 2
        elif c == "#" and cur is None:
            while i < n and s[i] != "\n":
                i += 1
        elif c in ";|":
            end_segment()
            i += 1
        elif c == "&":
            prev = s[i - 1] if i else ""
            if prev in "<>" or (i + 1 < n and s[i + 1] == ">"):
                append(c)
            else:
                end_segment()
            i += 1
        elif c == "<" and s.startswith("<<", i) and not s.startswith("<<<", i):
            i += 2
            strip = i < n and s[i] == "-"
            if strip:
                i += 1
            while i < n and s[i] in " \t":
                i += 1
            delim = []
            while i < n and s[i] not in " \t\n;|&()<>":
                if s[i] in "\"'":
                    j = s.find(s[i], i + 1)
                    j = n if j == -1 else j
                    delim.append(s[i + 1:j])
                    i = j + 1
                else:
                    delim.append(s[i])
                    i += 1
            pending.append({"delim": "".join(delim), "strip": strip})
        elif c == "(":
            if cur is not None and s.startswith(")", i + 1) and IDENT_RE.match("".join(cur)):
                cur = None  # function definition `name()`
                del words[:]
                i += 2
            else:
                i = substitution(i + 1)
                if cur is not None:
                    append(DYNAMIC)
        elif c == ")":
            end_segment()
            i += 1
            if sub:
                return i
        elif c == "$" and s.startswith("(", i + 1):
            i = substitution(i + 2)
            append(DYNAMIC)
        elif c == "`":
            i = backticks(i)
            append(DYNAMIC)
        elif c == "'":
            j = s.find("'", i + 1)
            j = n if j == -1 else j
            append(s[i + 1:j])
            i = j + 1
        elif c == '"':
            append("")
            i += 1
            while i < n and s[i] != '"':
                if s[i] == "\\" and i + 1 < n:
                    append(s[i + 1])
                    i += 2
                elif s[i] == "$" and s.startswith("(", i + 1):
                    i = substitution(i + 2)
                    append(DYNAMIC)
                elif s[i] == "`":
                    i = backticks(i)
                    append(DYNAMIC)
                else:
                    append(s[i])
                    i += 1
            i += 1
        else:
            append(c)
            i += 1
    end_segment()
    return n


def _handle(words, cds, out):
    """Inspect one simple command. Returns True when it is a shell that may
    read its script from a heredoc."""
    k = 0
    while k < len(words) and (ASSIGN_RE.match(words[k]) or words[k] in KEYWORDS):
        k += 1
    if k >= len(words):
        return False
    prog = os.path.basename(words[k])
    rest = words[k + 1:]
    if prog in WRAPPERS:
        for j, w in enumerate(rest):
            if os.path.basename(w) == "git":
                _record_git(rest[j + 1:], cds, out)
                break
    elif prog in ("cd", "pushd"):
        args = [w for w in rest if not (w.startswith("-") and w != "-")]
        cds.append(args[0] if args else "")
    elif prog == "git":
        _record_git(rest, cds, out)
    elif prog == "eval":
        _parse(" ".join(rest), 0, list(cds), out, False)
    elif prog in SHELLS:
        for j, w in enumerate(rest):
            if re.match(r"-[a-zA-Z]*c[a-zA-Z]*$", w) and j + 1 < len(rest):
                _parse(rest[j + 1], 0, list(cds), out, False)
                return False
        return True
    return False


def _record_git(args, cds, out):
    c_paths = []
    j = 0
    while j < len(args):
        a = args[j]
        if a == "-C":
            c_paths.append(args[j + 1] if j + 1 < len(args) else "")
            j += 2
        elif a in GIT_OPTS_WITH_ARG:
            j += 2
        elif a.startswith("-"):
            j += 1
        else:
            break
    if j < len(args):
        out.append(Invocation(args[j], args[j + 1:], c_paths, list(cds)))


def find_git_invocations(command):
    out = []
    _parse(command, 0, [], out, False)
    return out


def classify(inv):
    """None (not guarded), "mutating", or "ff-sync" (a fast-forward-only
    pull/merge, allowed on a mirror when it only syncs from origin)."""
    sub, args = inv.sub, inv.args
    if sub in ("commit", "rebase"):
        return "mutating"
    if sub == "checkout":
        return "mutating" if args[:1] in (["-b"], ["-B"]) else None
    if sub == "switch":
        creating = ("-c", "-C", "--create", "--force-create")
        return "mutating" if args[:1] and args[0] in creating else None
    if sub == "branch":
        if args and not BRANCH_READONLY_RE.match(args[0]):
            return "mutating"
        return None
    if sub in ("pull", "merge"):
        flags = [a for a in args if a.startswith("-")]
        if "--ff-only" in flags and all(f in FF_SAFE_FLAGS for f in flags):
            return "ff-sync"
        return "mutating"
    return None


def ff_sync_allowed(inv, default):
    """Whether an "ff-sync" invocation only brings origin's work onto the
    mirror: a named remote for pull, a remote-tracking ref for merge."""
    positionals = [a for a in inv.args if not a.startswith("-")]
    if inv.sub == "pull":
        remote = positionals[0] if positionals else None
        return remote is None or (remote != "." and bool(REMOTE_NAME_RE.match(remote)))
    refs = {"origin/%s" % default, "refs/remotes/origin/%s" % default,
            "@{u}", "@{upstream}", "FETCH_HEAD"}
    return len(positionals) == 1 and positionals[0] in refs


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


HOW_TO = (
    " Rephrase with an explicit static path — `git -C <absolute-path> ...` "
    "with no shell variables or substitutions — so the guardrail can vet "
    "the target (ADR-0004)."
)


def resolve_invocation(inv, cwd):
    """(target_path, deny_reason) for one guarded invocation. Exactly one of
    the pair is None. A cd/pushd before the git command rebases the working
    directory; each `git -C` then composes onto it. Anything not statically
    resolvable fails closed — deny_reason explains and points at `git -C`."""
    base = cwd
    if len(inv.cds) > 1:
        return None, (
            "Git guardrail (ADR-0004): this mutating git command follows "
            "multiple cd/pushd steps, which the guardrail cannot statically "
            "resolve, so it is blocked (fail closed)." + HOW_TO
        )
    if inv.cds:
        p = static_path(inv.cds[0], cwd)
        if p is None:
            return None, (
                "Git guardrail (ADR-0004): this mutating git command follows "
                "`cd %s`, whose path cannot be statically resolved "
                "(variables/subshells), so it is blocked (fail closed)."
                % inv.cds[0] + HOW_TO
            )
        base = p
    for raw in inv.c_paths:
        p = static_path(raw, base)
        if p is None:
            return None, (
                "Git guardrail (ADR-0004): the `git -C %s` path cannot be "
                "statically resolved (variables/subshells), so this mutating "
                "command is blocked (fail closed)." % raw + HOW_TO
            )
        base = p
    return os.path.realpath(base), None


def resolve_target(command, cwd):
    """resolve_invocation for the first guarded git command in `command`
    (the session cwd when there is none)."""
    for inv in find_git_invocations(command):
        if classify(inv):
            return resolve_invocation(inv, cwd)
    return os.path.realpath(cwd), None


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


def check(inv, kind, command, cwd, session):
    """Vet one guarded invocation; True when it was denied."""
    # Target working tree: cd/pushd prefix and/or `git -C` win, else hook cwd.
    # Unresolvable targets fail closed (a mutating command must be vettable).
    target, deny_reason = resolve_invocation(inv, cwd)
    if deny_reason:
        deny(deny_reason, session, {"command": command[:200], "reason": "unresolvable-target"})
        return True

    # Vaults are exempt entirely.
    for v in get_vaults():
        p = v.get("path")
        if p:
            p = os.path.realpath(p)
            if target == p or target.startswith(p + os.sep):
                return False

    repo_root = git(["rev-parse", "--show-toplevel"], cwd=target if os.path.isdir(target) else os.path.dirname(target))
    if not repo_root:
        return False  # not a repo; git will fail on its own
    repo_root = os.path.realpath(repo_root)

    # The session's own workspace root is exempt.
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if project_dir:
        own_root = git(["rev-parse", "--show-toplevel"], cwd=project_dir)
        if own_root and os.path.realpath(own_root) == repo_root:
            return False

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
        return True

    # Only default-branch checkouts are protected.
    branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root)
    default = None
    head_ref = git(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd=repo_root)
    if head_ref:
        default = head_ref.rsplit("/", 1)[-1]
    if default is None and branch in ("main", "master"):
        default = branch
    if branch and default and branch == default:
        # A fast-forward-only sync from origin lands no local work.
        if kind == "ff-sync" and ff_sync_allowed(inv, default):
            return False
        deny(
            f"Git guardrail (ADR-0004): {repo_root} is a default-branch "
            f"checkout ({branch}) outside this session's workspace — local "
            "main is a read-only mirror. Only a fast-forward-only sync "
            "(`git pull --ff-only`) may update it. Provision a worktree "
            "for anything else: use the worktree-provisioning skill (cut "
            f"from origin/{default} after a fetch).",
            session,
            {"target": repo_root, "branch": branch},
        )
        return True
    return False


def main(data):
    if data.get("tool_name") != "Bash":
        return
    command = (data.get("tool_input") or {}).get("command", "")
    session = data.get("session_id", "unknown")
    if "git" not in command:
        return
    cwd = data.get("cwd") or os.getcwd()
    for inv in find_git_invocations(command):
        kind = classify(inv)
        if kind and check(inv, kind, command, cwd, session):
            return


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
