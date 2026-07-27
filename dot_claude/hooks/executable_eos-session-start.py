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

EOS = os.path.expanduser("~/.local/bin/eos-resolve")


def main():
    try:
        data = json.load(sys.stdin)
    except ValueError:
        data = {}
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
    main()
