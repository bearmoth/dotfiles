#!/usr/bin/env python3
"""PreToolUse taint gate (ADR-0005, wayfinder #11/#14/#23).

The source-visibility rule, mechanically: the first read of private-exposure
material taints the session; from then on any autonomous write targeting an
org-exposed vault is downgraded to a human-gated approval (permissionDecision
"ask" — the permission prompt shows the exact proposed content, which IS the
promotion gate). Reads stay unrestricted everywhere.

Deliberately crude (per the ADR): taint records that private material entered
the session, never which claims derive from it. No laundering: delegating the
write to a subagent doesn't shed taint — the tainted parent composed the
prompt (the subagent's own writes hit this gate too, in its own session, only
if IT reads private material; the human gate on the parent is the backstop).

Fails soft: any internal error allows the call (a crashed guardrail must not
brick every tool), logging to stderr.
"""

import json
import os
import re
import subprocess
import sys
import time

EOS = os.path.expanduser("~/.local/bin/eos-resolve")
STATE = os.path.expanduser("~/.local/state/engineering-os")

READ_TOOLS = {"Read", "Grep", "Glob"}
WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
# Bash write indicators — a command mentioning an org vault path is only
# gated when it plausibly writes (mentioning it in `cat`/`rg` stays free).
BASH_WRITE_RE = re.compile(
    r"(>|>>|\btee\b|\bmv\b|\bcp\b|\brsync\b|\bsed\s+-i|\btouch\b|\bmkdir\b|\brm\b|\bgit\s+(commit|push|mv|rm)\b)"
)


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


def vault_paths():
    r = subprocess.run(
        [EOS, "vaults", "--json"], capture_output=True, text=True, timeout=15
    )
    if r.returncode != 0:
        return [], []
    private, org = [], []
    for v in json.loads(r.stdout):
        p = v.get("path")
        if not p:
            continue
        (private if v["exposure"] == "private" else org).append(os.path.realpath(p))
    return private, org


def touched_paths(tool, ti):
    paths = []
    for key in ("file_path", "path", "notebook_path"):
        if ti.get(key):
            paths.append(ti[key])
    if tool == "Grep" and ti.get("path") is None:
        paths.append(os.getcwd())
    return [os.path.realpath(os.path.expanduser(p)) for p in paths]


def mentions(command, root):
    home = os.path.expanduser("~")
    forms = {root, root.replace(home, "~")}
    return any(f in command for f in forms)


def under(path, roots):
    return any(path == r or path.startswith(r + os.sep) for r in roots)


def main():
    data = json.load(sys.stdin)
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    session = data.get("session_id", "unknown")

    private, org = vault_paths()
    if not private and not org:
        return

    sdir = os.path.join(STATE, "sessions", session)
    taint_file = os.path.join(sdir, "tainted")
    tainted = os.path.exists(taint_file)

    command = ti.get("command", "") if tool == "Bash" else ""
    paths = touched_paths(tool, ti)

    # 1. Private material entering the session sets the taint flag.
    touches_private = any(under(p, private) for p in paths) or (
        command and any(mentions(command, r) for r in private)
    )
    if touches_private and not tainted:
        os.makedirs(sdir, exist_ok=True)
        open(taint_file, "w").close()
        audit("taint_set", session, {"tool": tool})
        tainted = True

    # 2. Tainted org-exposed writes are human-gated (ask), never autonomous.
    org_write = (tool in WRITE_TOOLS and any(under(p, org) for p in paths)) or (
        tool == "Bash"
        and any(mentions(command, r) for r in org)
        and BASH_WRITE_RE.search(command)
    )
    if tainted and org_write:
        audit("gate_trip", session, {"tool": tool, "paths": paths})
        print(
            json.dumps(
                {
                    "hookSpecificOutput": {
                        "hookEventName": "PreToolUse",
                        "permissionDecision": "ask",
                        "permissionDecisionReason": (
                            "Taint gate (ADR-0005): this session has read "
                            "private-exposure material, so writes to an "
                            "org-exposed vault need Phil's eyes on the exact "
                            "text. Approve to proceed, or reject and derive "
                            "the content afresh from org-visible sources."
                        ),
                    }
                }
            )
        )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # fail open, never brick tool calls
        print(f"eos-taint-gate: {e}", file=sys.stderr)
        sys.exit(0)
