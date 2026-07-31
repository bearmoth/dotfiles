#!/usr/bin/env python3
"""Stop hook: queue nudge + session capture (ADR-0009, wayfinder #14/#16/#23).

One significance gate, two outputs. At turn-end, if the session did
significant work (files edited / commits made / heavy tool volume) and hasn't
been nudged yet, bounce the agent back once to:
  1. queue a work-record entry (plus any knowledge entries) via `eos-queue` —
     never a direct vault write; the triage fan-out materialises vaults later
  2. write a session capture to the Journal captures/sessions/ — but only
     when the session's own context is the journal's context; cross-context
     sessions queue only (ADR-0008 ACLs make the direct write unlawful)

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
    journal = journal_ctx = None
    for cname, cdef in contexts.items():
        j = (cdef.get("vaults") or {}).get("journal")
        if j and j.get("path"):
            journal, journal_ctx = j, cname
            break

    today = time.strftime("%Y-%m-%d")
    repo = ctx.get("repo") or {}
    attr_flags = f"--context {context or 'UNRESOLVED'} --session {session}"
    if repo.get("slug"):
        attr_flags += f" --repo \"{repo['slug']}\""
    if ctx.get("ticket"):
        attr_flags += f" --ticket {ctx['ticket']}"
    if ctx.get("branch"):
        attr_flags += f" --branch \"{ctx['branch']}\""

    # Queue, never a direct vault write (ADR-0009): always legal from any
    # context on any machine, drained by the triage fan-out.
    tasks = [
        "1. QUEUE (work record): run\n"
        f"   eos-queue add --kind work-record {attr_flags} \\\n"
        "     --title \"<short title>\" --body \"<terse bullets>\"\n"
        "   Body register: meaningful outcomes only — decisions, findings, things "
        "shipped — never a step-by-step narrative (that belongs in the session "
        "capture). Must pass the 404 test (no cross-vault links carrying meaning); "
        "never cite filesystem paths.\n"
        "2. QUEUE (knowledge, if any): for each thing this session learned that is "
        "knowledge about a system rather than a record of you — a discovered "
        "constraint, a confirmed behaviour, a gotcha — run\n"
        f"   eos-queue add --kind knowledge {attr_flags} \\\n"
        "     --sensitivity org-ok|needs-despec|unsure --title \"<the claim>\" --body \"<the finding, stated as knowledge>\"\n"
        "   When unsure about sensitivity, omit the flag (defaults down to unsure). "
        "Skip this step if the session surfaced nothing wiki-worthy."
    ]
    if journal and context == journal_ctx:
        tasks.append(
            "3. SESSION CAPTURE: write a summary of this session to "
            f"\"{journal['path']}/captures/sessions/{today}-<short-kebab-slug>.md\" with "
            "frontmatter `tags: [type/capture]`. Cover: what was attempted, what "
            "happened, decisions made, loose ends. This is a terminal record — verbatim-"
            "ish and unpolished is fine. Do NOT write to diary/ (the diary is never "
            "agent-written)."
        )

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
                    + "\nPerform these routines SILENTLY: no narration, no echoing "
                    "of entry bodies or file contents into the reply. End with one "
                    "summary line (e.g. \"routines: 1 work-record, 2 knowledge "
                    "queued\"), then finish your reply normally. If genuinely "
                    "nothing noteworthy happened, state that in one line instead."
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
