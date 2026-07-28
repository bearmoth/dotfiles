#!/usr/bin/env python3
"""SessionStart hook (wayfinder #10/#14/#23): inject the engineering-OS
situation block — resolved context, machine mounts, pulse — into every
session's context. All semantics live in eos-resolve; this is a shim.

Fails soft: a broken registry yields a one-line warning, never a dead session.
"""

import json
import os
import subprocess
import sys
import time

EOS = os.path.expanduser("~/.local/bin/eos-resolve")
STATE = os.path.expanduser(os.environ.get("EOS_STATE", "~/.local/state/engineering-os"))


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


def main(data):
    cwd = data.get("cwd") or os.getcwd()
    try:
        r = subprocess.run(
            [EOS, "banner", cwd], capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"## Engineering OS\nBanner unavailable ({e}) — run `chezmoi apply`.")
        return
    if r.stdout.strip():
        print(r.stdout.strip())
    else:
        err = r.stderr.strip().splitlines()
        print(
            "## Engineering OS\nBanner unavailable"
            + (f" ({err[0]})" if err else "")
            + " — run `chezmoi apply` to render the registry."
        )


if __name__ == "__main__":
    session = "unknown"
    try:
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else {}
        session = payload.get("session_id", "unknown")
        main(payload)
    except Exception as e:  # fail soft — a broken banner must not kill the session
        print(f"## Engineering OS\nBanner unavailable ({e}) — run `chezmoi apply`.")
        issue_breadcrumb("eos-session-start", session, str(e))
        sys.exit(0)
