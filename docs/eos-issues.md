# Engineering-OS issues backlog

Defects in the **engineering-OS system itself** — hooks, routines, the
registry, the resolver, the skills — noticed during normal work. These are
system faults, **not knowledge**: they never route to a vault (ADR-0007).

**Capture** (the inbox): `/eos-issue`, or a hook's own crash breadcrumb, appends
a raw sighting to `~/.local/state/engineering-os/eos-issues.jsonl` — always
writable from any cwd, offline, no vault routing.

**Drain** (this file): the registry-maintenance `routines-audit` reads the
inbox, triages each sighting (fix-now / keep / drop), appends kept ones here,
and clears the inbox. The pulse surfaces an un-drained inbox once it ages
(blocking items immediately).

**Graduation:** an item big enough to *plan* becomes a wayfinder gh issue in
`bearmoth/dotfiles`, filed **by hand** — the backlog is raw sightings, not
scheduled work, and the two are deliberately not conflated (ADR-0007).

Entry shape: `### YYYY-MM-DD — <title>  (<severity> → <disposition>)` then
Component / Expected / Actual / Resolution bullets.

## Open

_(none — drained clean)_

## Resolved

### 2026-07-28 — Stop-hook worklog month-file not pre-created  (friction → by-design)
- **Component:** stop hook / worklog routine
- **Expected:** `log/YYYY-MM.md` exists when the worklog nudge fires.
- **Actual:** the first session of each month finds no file; the nudge instructs "create the file … if missing".
- **Resolution:** working as intended. Pre-creating the shard would mean a hook writing content into a vault that may be `org`-exposure (Engagement PKB) — exactly the write the taint gate (ADR-0005) exists to gate. The create-if-missing instruction in the nudge is the correct seam. Motivating report: eos issue #3 — also the inaugural dogfood entry for this backlog.
