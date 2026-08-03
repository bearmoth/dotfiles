#!/usr/bin/env python3
"""PreToolUse vault-governance gate (ADR-0008 as amended by #29, supersedes
ADR-0005; wayfinder #11/#14/#23/#25).

Governance is stateless read/write ACLs over context x privacy (ADR-0008),
computed by pure functions (read_decision / write_decision / evaluate):

- Reads of a `private: true` vault are same-context-only: cross-context reads
  are hard-denied; non-private reads are unrestricted.
- Writes to an `exposure: org` vault are never write-time-gated on context
  (#29: gating moved to decision points). A cross-context org write is
  allowed and audit-logged (`org_write_cross_context`: vault, session
  context, file) so routines-audit still sees the flow; exposure itself is
  gated at push time by eos-push-gate in the vault's own pre-push hook.
  Writes into personal-exposed vaults (incl. write-down into a private
  vault) always pass.
- Bash commands touching an org vault are audited only when they could
  write: a command provably read-only (bash_command_is_read_only) passes
  free and skips the taint path — reads of non-private org vaults are
  unrestricted by ADR-0008.
- Code repos are never vaults — only registered vault roots are gated.

Session taint is a transitional backstop for the one surviving
private-read-then-org-write path (the draining Easygo vault, retired by #25).
It is set only by an actual same-context read from a `private: true` vault;
writes-down never taint (fixing ADR-0005's directionality bug). A tainted
session still ASKS on any org write — taint is about private content already
in-context, which push-time review cannot catch. The marker records the
tainting read so the gate prompt is self-sufficient. No laundering:
delegating the write to a subagent doesn't shed taint.

Fails soft: any internal error allows the call (a crashed guardrail must not
brick every tool), logging to stderr.
"""

import json
import os
import re
import shlex
import subprocess
import sys
import time

EOS = os.path.expanduser("~/.local/bin/eos-resolve")
STATE = os.path.expanduser(os.environ.get("EOS_STATE", "~/.local/state/engineering-os"))

READ_TOOLS = {"Read", "Grep", "Glob"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


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


# ---------------------------------------------------- injectable I/O -------
# The hook's two facts about the world each come from one eos-resolve call;
# isolating them here lets tests drive main() over a fixture world with no
# subprocess/registry coupling.


def get_vaults():
    """All registered vaults with context/exposure/private/path. Injectable."""
    r = subprocess.run(
        [EOS, "vaults", "--json"], capture_output=True, text=True, timeout=15
    )
    if r.returncode != 0:
        return []
    try:
        return json.loads(r.stdout)
    except ValueError:
        return []


def get_session_context(cwd):
    """Owning context of the session cwd (None if unresolved). Injectable."""
    r = subprocess.run(
        [EOS, "context", "--json", cwd], capture_output=True, text=True, timeout=15
    )
    try:
        return json.loads(r.stdout).get("context")
    except ValueError:
        return None


def read_targets(tool, ti, cwd):
    if tool not in READ_TOOLS:
        return []
    paths = [ti[k] for k in ("file_path", "path", "notebook_path") if ti.get(k)]
    if tool == "Grep" and ti.get("path") is None:
        paths.append(cwd)
    return [os.path.realpath(os.path.expanduser(p)) for p in paths]


def write_targets(tool, ti):
    if tool not in WRITE_TOOLS:
        return []
    paths = [ti[k] for k in ("file_path", "path", "notebook_path") if ti.get(k)]
    return [os.path.realpath(os.path.expanduser(p)) for p in paths]


def under(path, roots):
    return any(path == r or path.startswith(r + os.sep) for r in roots)


# ------------------------------------------------------- pure decisions ----
# Governance is stateless read/write ACLs over context x privacy (ADR-0008).
# These functions take a fully-resolved world and never do I/O, so the whole
# deny/ask/taint matrix is unit-testable.


def is_org(vault):
    return vault.get("exposure") == "org"


def is_private(vault):
    return bool(vault.get("private"))


def vault_for_path(path, vaults):
    """The registered vault whose root contains `path`, or None."""
    for v in vaults:
        root = v.get("path")
        if root and under(path, [os.path.realpath(root)]):
            return v
    return None


def read_decision(vault, session_context):
    """Rule 1 (ADR-0008): a private vault is readable only from its own
    context. Cross-context private read -> deny; same-context -> allow+taint;
    non-private -> allow (never taints). Unresolved session context matches no
    vault, so private reads there deny (conservative, no fallback context)."""
    if is_private(vault):
        return "taint" if vault.get("context") == session_context else "deny"
    return "allow"


def write_decision(vault, session_context, tainted):
    """Rule 2 (ADR-0008 as amended by #29) + taint backstop. Only org-exposed
    vaults are watched: a tainted session asks on ANY org write (the
    surviving private-read->org-write path — private content already
    in-context, which push review can't catch); a clean cross-context org
    write is "allow-cross-context" (allowed, audit-logged; exposure is gated
    at push time by eos-push-gate); same-context clean -> allow. Writes into
    personal-exposed vaults (incl. write-down into a private vault) always
    pass this hook."""
    if is_org(vault):
        if tainted:
            return "ask"
        if vault.get("context") != session_context:
            return "allow-cross-context"
        return "allow"
    return "allow"


# ------------------------------------------- read-only Bash classification --
# Reads of non-private org vaults are unrestricted (ADR-0008), so a Bash
# command that provably cannot write must not trip the org-write gate. The
# classification is deliberately conservative: a command is read-only ONLY if
# it contains no write-capable construct (redirection, substitution, in-place
# editors, interpreters, ...) AND every pipeline segment's leading command is
# on a small allow-list. Anything doubtful classifies as not-read-only, which
# keeps the current behaviour (ask).

READONLY_LEADERS = {
    "ls", "cat", "head", "tail", "grep", "rg", "find", "wc", "awk", "sed",
    "jq", "stat", "file", "du", "sort", "uniq", "cut", "tr", "echo",
}
GIT_READONLY_SUBCMDS = {"status", "log", "diff", "show", "ls-files"}
# find actions that mutate or execute; presence anywhere disqualifies.
_FIND_WRITE_ACTIONS = {"-delete", "-exec", "-execdir", "-ok", "-okdir",
                       "-fprint", "-fprintf", "-fls"}
# Raw-string write hints: any redirection (incl. awk/sed internal `> "f"`),
# command/process substitution, or backticks. `<` is rejected too — input
# redirection is harmless but process substitution is not, and doubt asks.
_WRITE_HINT_RE = re.compile(r"[<>`]|\$\(")


def _git_segment_is_read_only(toks):
    """`git`, skipping -C <path> / pager flags, must reach an allow-listed
    read-only subcommand. Any other flag or subcommand -> not read-only."""
    i = 1
    while i < len(toks):
        t = toks[i]
        if t == "-C":
            i += 2
            continue
        if t in ("--no-pager", "-P", "-p", "--paginate"):
            i += 1
            continue
        if t.startswith("-"):
            return False
        return t in GIT_READONLY_SUBCMDS
    return False  # bare `git` (or trailing -C): no subcommand seen


def bash_command_is_read_only(command):
    """True only when `command` provably cannot write: no write-capable
    construct anywhere, and every pipeline segment leads with an allow-listed
    read-only command. Every failure mode (unknown leader, env-var prefix,
    unparsable quoting, subshell, xargs, interpreter, ...) returns False —
    when in ANY doubt, the caller keeps the ask."""
    if not command or _WRITE_HINT_RE.search(command):
        return False
    for seg in re.split(r"&&|\|\||[;|&\n]", command):
        seg = seg.strip()
        if not seg:
            continue
        try:
            toks = shlex.split(seg)
        except ValueError:
            return False
        if not toks:
            continue
        head = os.path.basename(toks[0])
        if head == "git":
            if not _git_segment_is_read_only(toks):
                return False
        elif head in READONLY_LEADERS:
            if head == "sed" and any(t.startswith("-i") for t in toks[1:]):
                return False  # in-place edit
            if head == "find" and any(t in _FIND_WRITE_ACTIONS for t in toks[1:]):
                return False
        else:
            return False
    return True


# Redirection (`>`/`>>`/`tee`, optionally with flags) immediately before a
# path makes that path a write destination.
_REDIR_BEFORE = re.compile(r"(>>?|\btee\b)\s*(?:-\S+\s+)*$")
# cp/mv/rsync/install anywhere earlier => a trailing path arg is a destination.
_COPY_CMD = re.compile(r"\b(cp|mv|rsync|install)\b")


def _path_forms(root):
    home = os.path.expanduser("~")
    return {root, root.replace(home, "~")}


def mention_is_write_dest_only(command, root):
    """True iff EVERY occurrence of the vault path in `command` is a write
    destination (target of >/>>/tee, or the trailing arg of cp/mv/rsync/
    install). Any read-position or ambiguous occurrence -> False, so the
    caller taints. Crude, in the safe direction (ADR-0008)."""
    seen = False
    for form in _path_forms(root):
        start = 0
        while True:
            i = command.find(form, start)
            if i < 0:
                break
            seen = True
            before = command[:i]
            after = command[i + len(form):]
            # The vault path is a whole token (root + trailing subpath); consume
            # the rest of it before deciding what follows.
            tok_rest = re.match(r"[^\s|;&<>]*", after).group(0)
            after_token = after[len(tok_rest):]
            terminal = after_token.strip() == "" or after_token.lstrip().startswith(("|", ";", "&", ">"))
            redir = bool(_REDIR_BEFORE.search(before))
            copy_dest = bool(_COPY_CMD.search(before)) and terminal and ">" not in after_token
            if not (redir or copy_dest):
                return False
            start = i + len(form)
    return seen  # True only if >=1 mention existed and all were destinations


def bash_reads_private(command, private_roots):
    """A private vault path mentioned in any non-write-destination position
    means the session read it (conservative: ambiguous counts as a read)."""
    for root in private_roots:
        if any(f in command for f in _path_forms(root)) and not mention_is_write_dest_only(command, root):
            return True
    return False


# ---------------------------------------------- taint marker + prompt ------
# The marker stops being an empty file: it records the tainting read so the
# gate prompt can be built from state (ADR-0008). Old empty markers from live
# sessions read as "tainted, provenance unknown".


def write_taint_marker(path, tool, detail):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "tool": tool, "detail": detail},
            f,
        )


def read_taint_marker(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return {"provenance": "unknown"}
    if not raw.strip():
        return {"provenance": "unknown"}  # legacy empty-file marker
    try:
        return json.loads(raw)
    except ValueError:
        return {"provenance": "unknown"}


def gate_prompt(taint_info, target_desc):
    """Self-sufficient ask reason built from state (ADR-0005/0008). Keeps all
    four elements: the tainting read, the write target, and what Approve /
    Reject each do."""
    if taint_info.get("provenance") == "unknown":
        source = "private material (provenance unknown — tainted in an earlier session)"
    else:
        source = f"{taint_info.get('detail', 'private material')} at {taint_info.get('ts', 'an earlier point')}"
    return (
        "Taint gate (ADR-0005/0008, docs/adr/): this session read private "
        f"material — {source} — so this write to org-visible {target_desc} needs "
        "your review. Approve = this one write proceeds exactly as shown. "
        "Reject = it's blocked; re-derive the content from org-visible sources "
        "and continue."
    )


def _deny_reason(vault):
    return (
        f"Cross-context read blocked (ADR-0008): {vault.get('name', 'this vault')} "
        f"is a private vault owned by the '{vault.get('context')}' context and "
        "this session is elsewhere. It is not readable here — ask Phil to paste "
        "in anything you need from it."
    )


def _target_desc(vault, path):
    root = vault.get("path")
    rel = os.path.relpath(path, os.path.realpath(root)) if root else os.path.basename(path)
    return f"{vault.get('name', 'vault')}/{rel}"


def evaluate(tool, ti, command, vaults, session_context, tainted, cwd):
    """Pure decision over a fixed world. Priority: deny > ask > taint > allow.
    Returns {deny, ask_target, taint, taint_detail, cross_writes}.
    `ask_target` is the org write target description (set only when the
    session is tainted); main() builds the prompt from it. `cross_writes`
    lists clean cross-context org writes as (vault, path) — allowed, but
    main() audit-logs each so routines-audit still sees the flow (#29)."""
    result = {"deny": None, "ask_target": None, "taint": False,
              "taint_detail": None, "cross_writes": []}

    def gate_write(v, path_for_desc):
        d = write_decision(v, session_context, tainted)
        if d == "ask":
            result["ask_target"] = _target_desc(v, path_for_desc)
        elif d == "allow-cross-context":
            result["cross_writes"].append((v, path_for_desc))

    # --- structured reads: deny cross-context private, taint same-context ---
    for p in read_targets(tool, ti, cwd):
        v = vault_for_path(p, vaults)
        if not v:
            continue
        d = read_decision(v, session_context)
        if d == "deny":
            result["deny"] = _deny_reason(v)
            return result
        if d == "taint":
            result["taint"] = True
            result["taint_detail"] = p

    # --- structured writes: gate org writes per the ACL ---
    for p in write_targets(tool, ti):
        v = vault_for_path(p, vaults)
        if not v:
            continue
        gate_write(v, p)

    # --- Bash: reads (deny/taint) then possible org writes (ask) ---
    if tool == "Bash" and command:
        for v in vaults:
            root = v.get("path")
            if not (root and is_private(v)):
                continue
            root = os.path.realpath(root)
            mentioned = any(f in command for f in _path_forms(root))
            if mentioned and not mention_is_write_dest_only(command, root):
                # a read (or ambiguous) mention of a private vault
                if v.get("context") != session_context:
                    result["deny"] = _deny_reason(v)
                    return result
                result["taint"] = True
                result["taint_detail"] = root
        # A provably read-only command never trips the org-write gate
        # (ADR-0008: non-private org reads are unrestricted). Anything not
        # provably read-only is treated as a possible write — doubt asks.
        if not bash_command_is_read_only(command):
            for v in vaults:
                root = v.get("path")
                if not (root and is_org(v)):
                    continue
                root = os.path.realpath(root)
                if any(f in command for f in _path_forms(root)):
                    gate_write(v, root)

    return result


def _emit(decision, reason):
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }}))


def main(data):
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    session = data.get("session_id", "unknown")
    cwd = data.get("cwd") or os.getcwd()

    vaults = get_vaults()
    if not vaults:
        return
    session_context = get_session_context(cwd)

    sdir = os.path.join(STATE, "sessions", session)
    taint_file = os.path.join(sdir, "tainted")
    taint_info = read_taint_marker(taint_file)
    tainted = taint_info is not None

    command = ti.get("command", "") if tool == "Bash" else ""
    verdict = evaluate(tool, ti, command, vaults, session_context, tainted, cwd)

    # 1. Hard deny (cross-context private read) — highest priority.
    if verdict["deny"]:
        audit("read_deny", session, {"tool": tool, "detail": verdict["taint_detail"]})
        _emit("deny", verdict["deny"])
        return

    # 2. Set the enriched taint marker on an allowed same-context private read.
    if verdict["taint"] and not tainted:
        write_taint_marker(taint_file, tool, verdict["taint_detail"])
        audit("taint_set", session, {"tool": tool, "path": verdict["taint_detail"]})
        taint_info = read_taint_marker(taint_file)
        tainted = True

    # 3. Taint backstop: an org write from a tainted session still asks —
    #    private content already in-context is the one thing push-time review
    #    cannot catch.
    if verdict["ask_target"]:
        audit("gate_trip", session, {
            "tool": tool,
            "target": verdict["ask_target"],
            "command": (command[:200] if command else None),
        })
        _emit("ask", gate_prompt(taint_info or {"provenance": "unknown"}, verdict["ask_target"]))
        return

    # 4. Clean cross-context org writes are allowed (#29: gating moved to
    #    push time, eos-push-gate) but audit-logged so routines-audit still
    #    sees the flow. No emit: the write proceeds through the normal
    #    permission flow.
    for v, path in verdict["cross_writes"]:
        audit("org_write_cross_context", session, {
            "tool": tool,
            "vault": v.get("name"),
            "vault_context": v.get("context"),
            "session_context": session_context,
            "file": path,
            "command": (command[:200] if command else None),
        })


if __name__ == "__main__":
    session = "unknown"
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        session = payload.get("session_id", "unknown")
        main(payload)
    except Exception as e:  # fail open, never brick tool calls
        print(f"eos-taint-gate: {e}", file=sys.stderr)
        issue_breadcrumb("eos-taint-gate", session, str(e), severity="blocking")
        sys.exit(0)
