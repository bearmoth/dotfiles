#!/usr/bin/env python3
"""Stop hook: worklog nudge + session capture (wayfinder #14/#16/#23).

One significance gate, two outputs. At turn-end, if the session did
significant work (files edited / commits made / heavy tool volume) and hasn't
been nudged yet, bounce the agent back once to:
  1. append a worklog entry to the owning context's wiki log/YYYY-MM.md
  2. write a session capture to the Journal captures/sessions/

A trivial session produces neither. Nudges once per session; hard-killed
sessions escape (accepted gap — surfaces as staleness in the pulse).
Significance thresholds are pilot-tunable via EOS_SIG_EDITS / EOS_SIG_TOOLS.
"""

import json
import os
import subprocess
import sys
import time

EOS = os.path.expanduser("~/.local/bin/eos-resolve")
STATE = os.path.expanduser(os.environ.get("EOS_STATE", "~/.local/state/engineering-os"))

SIG_EDITS = int(os.environ.get("EOS_SIG_EDITS", "3"))
SIG_TOOLS = int(os.environ.get("EOS_SIG_TOOLS", "25"))

EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}


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


def significance(transcript_path):
    """Cheap signals from the transcript: (tool_calls, edits, commits)."""
    tools = edits = commits = 0
    try:
        with open(transcript_path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"tool_use"' not in line:
                    continue
                try:
                    rec = json.loads(line)
                except ValueError:
                    continue
                content = (rec.get("message") or {}).get("content") or []
                if not isinstance(content, list):
                    continue
                for block in content:
                    if not isinstance(block, dict) or block.get("type") != "tool_use":
                        continue
                    tools += 1
                    name = block.get("name", "")
                    if name in EDIT_TOOLS:
                        edits += 1
                    elif name == "Bash":
                        cmd = (block.get("input") or {}).get("command", "")
                        if "git commit" in cmd:
                            commits += 1
    except OSError:
        pass
    return tools, edits, commits


def eos_json(args):
    try:
        r = subprocess.run(
            [EOS, *args, "--json"], capture_output=True, text=True, timeout=15
        )
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {}


def main(data):
    if data.get("stop_hook_active"):
        return  # already continuing because of us — let it stop
    session = data.get("session_id", "unknown")

    sdir = os.path.join(STATE, "sessions", session)
    nudge_file = os.path.join(sdir, "nudged")
    if os.path.exists(nudge_file):
        return  # one nudge per session

    tools, edits, commits = significance(data.get("transcript_path", ""))
    if not (edits >= SIG_EDITS or commits >= 1 or tools >= SIG_TOOLS):
        return

    cwd = data.get("cwd") or os.getcwd()
    ctx = eos_json(["context", cwd])
    mounts = eos_json(["mounts"])
    contexts = mounts.get("contexts", {})

    context = ctx.get("context")
    wiki = (contexts.get(context, {}).get("vaults") or {}).get("wiki") if context else None
    journal = None
    for cdef in contexts.values():
        j = (cdef.get("vaults") or {}).get("journal")
        if j and j.get("path"):
            journal = j
            break

    today = time.strftime("%Y-%m-%d")
    month = time.strftime("%Y-%m")
    tasks = []
    if wiki and wiki.get("path"):
        attribution = ""
        if ctx.get("repo"):
            attribution = (
                f" Attribute work as ({context}, {ctx['repo']['slug']}, "
                f"{ctx.get('ticket') or 'no-ticket'}, {ctx.get('branch')}) — never cite filesystem paths."
            )
        tasks.append(
            f"1. WORKLOG: append an entry for today to \"{wiki['path']}/log/{month}.md\" "
            f"(create the file with a `# Worklog {month}` heading if missing). Format: a "
            f"`## {today} — <short title>` heading plus terse bullets covering only work "
            f"owned by the `{context}` context. The entry must pass the 404 test (no "
            f"cross-vault links carrying meaning).{attribution} If an entry for this "
            "session already exists, extend it instead."
        )
    if journal:
        tasks.append(
            f"{len(tasks) + 1}. SESSION CAPTURE: write a summary of this session to "
            f"\"{journal['path']}/captures/sessions/{today}-<short-kebab-slug>.md\" with "
            "frontmatter `tags: [type/capture]`. Cover: what was attempted, what "
            "happened, decisions made, loose ends. This is a terminal record — verbatim-"
            "ish and unpolished is fine. Do NOT write to diary/ (the diary is never "
            "agent-written)."
        )
    if not tasks:
        return  # nowhere to write on this machine

    os.makedirs(sdir, exist_ok=True)
    open(nudge_file, "w").close()
    audit(
        "stop_nudge",
        session,
        {"tools": tools, "edits": edits, "commits": commits, "context": context},
    )
    print(
        json.dumps(
            {
                "decision": "block",
                "reason": (
                    "Engineering-OS routines (this session did significant work — "
                    f"{edits} edits, {commits} commits, {tools} tool calls):\n"
                    + "\n".join(tasks)
                    + "\nThen finish your reply normally. If genuinely nothing "
                    "noteworthy happened, state that in one line instead of writing."
                ),
            }
        )
    )


if __name__ == "__main__":
    session = "unknown"
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        session = payload.get("session_id", "unknown")
        main(payload)
    except Exception as e:  # fail open — never trap the user in a stop loop
        print(f"eos-stop: {e}", file=sys.stderr)
        issue_breadcrumb("eos-stop", session, str(e))
        sys.exit(0)
