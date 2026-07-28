---
description: Log a defect in Engineering-OS itself to the eos-issues backlog (not a vault)
---

Capture a defect in the **engineering-OS system itself** — a hook misfiring or
blocking wrongly, a routine whose instructions are wrong or ambiguous, a
directory that resolves to UNRESOLVED when it shouldn't, a vault/context that
routes incorrectly, a missing scaffold (e.g. a month worklog file that doesn't
exist yet), or any friction in the worklog/capture/triage/despec routines.

This is a **system fault, not knowledge** — do NOT route it through
knowledge-routing, `/capture`, or any vault. It goes to the backlog inbox by
running (bootstraps its own store; safe from any cwd):

```
eos-issue log --component "<hook/routine/skill>" \
              --severity blocking|friction|cosmetic \
              --summary "<one line: what happened>" \
              [--expected "<what should have happened>"] \
              [--actual "<what actually happened>"]
```

Severity: **blocking** (wedged real work), **friction** (annoying, worked
around), **cosmetic** (wrong but harmless). Fill `--expected`/`--actual` when
the gap isn't obvious from the summary. Infer the fields from the description
below; ask only if severity or component is genuinely unclear. Log it and
continue — never derail the current task for this.

The inbox is drained by the **registry-maintenance** `routines-audit` into
`docs/eos-issues.md`; the pulse surfaces it once it ages (blocking items,
immediately). Planned fixes graduate to a wayfinder gh issue by hand — never
auto-filed.

$ARGUMENTS
