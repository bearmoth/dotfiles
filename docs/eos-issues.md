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

_Drained 2026-07-30 (routines-audit): 8 sightings, all kept, none dropped,
none fix-now. Two clusters dominate: the worklog routine (3 items, mid-redesign
since the 2026-07-29 grilling session) and the ADR-0008 cross-context ACL
(2 items, fix direction already decided, ADR pending)._

### 2026-07-28 — Taint-gate confirmation prompt too uninformative to act on  (blocking → kept)
- **Component:** taint-gate hook (ADR-0005)
- **Expected:** prompt gives Phil everything needed for a five-second approve/reject: which read set the taint, which vault/file the write targets, a pointer to docs/adr/0005 — plus the verbatim text ADR-0002 requires.
- **Actual:** prompt cites "ADR-0005" by number only, names neither the tainting read nor the write target.
- **Note:** superseded by [#29](https://github.com/bearmoth/dotfiles/issues/29) — the taint gate is slated for early retirement post-ADR-0009, so the prompt rewrite is moot. Audit-window evidence (routine-obligated worklog writes tripped the gate 4× in 3 days) commented on #29 as retirement support.

### 2026-07-28 — Tech Notes worklog file TCC-denied (EPERM) to the agent process  (friction → kept, possibly stale)
- **Component:** worklog routine / macOS TCC
- **Expected:** stop-hook worklog routine can append to the personal worklog file.
- **Actual:** `Tech Notes/log/2026-07.md` existed but every open attempt (sandboxed + unsandboxed Bash, harness Read) returned EPERM — looks like per-file `com.apple.macl` TCC; a fresh Journal file in the same Documents tree wrote fine.
- **Note:** the offending file was deleted in the 2026-07-29 worklog reset and no personal shard exists yet; re-verify when the next one is created before investing in a fix.

### 2026-07-28 — knowledge-routing skill missing the plumbing-write class  (cosmetic → kept)
- **Component:** knowledge-routing skill
- **Expected:** skill documents that wiki `log/` entries are digestion feedstock (plumbing-into-wiki, mirroring the De-spec Queue's transient-plumbing precedent), not curated wiki content held to the output bar.
- **Actual:** no mention; CONTEXT.md's worklog definition ("curated, wiki-bound") contradicts the 2026-07-28 routing-audit decision.
- **Note:** fix touches skill + CONTEXT.md together; codify the 2026-07-28 decision rather than patching one side.

### 2026-07-29 — Worklog writes off-schema for the PKB; register drifts into session narrative  (friction → kept)
- **Component:** eos-stop.py worklog routine
- **Expected:** worklog destination sanctioned by the destination vault's CLAUDE.md (routing rule 4), with a pinned register: curated, context-owned outcome ledger distinct from Journal session captures.
- **Actual:** PKB CLAUDE.md has no `log/` convention (new structure is briefing-gated there); the hook's "terse bullets" instruction produced first-person narratives duplicating the Journal captures.
- **Note:** part of the worklog-redesign thread (2026-07-29 grilling session; both vaults' `log/` shards were reset that day).

### 2026-07-29 — Session-capture obligation impossible from easygo-context sessions  (blocking → kept)
- **Component:** eos-stop.py routines × ADR-0008 ACL
- **Expected:** session-end routines completable from any context; defect reporting never gated behind a vault ACL.
- **Actual:** Stop hook demands a Journal (personal, private) capture that the cross-context ACL correctly denies; the eos-issue path was reportedly gated too from that session (needs verification — the store is `~/.local/state`, not a vault, so the gate may be misclassifying the Bash write). Every significant easygo session hits this.
- **Note:** already graduated — the fix is ADR-0009 (worklog-queue-redesign branch, implemented + tested); deployment tracked in [#28](https://github.com/bearmoth/dotfiles/issues/28). Close this entry when #28 lands.

### 2026-07-30 — ADR-0008 ACL asymmetry: foreign-context reads hook-blocked, writes ungated  (friction → kept)
- **Component:** adr-0008-acl-hook
- **Expected:** writes from a foreign context to a private vault gated like reads — or the write-only capture path explicitly documented as intended in ADR-0008/CLAUDE.md.
- **Actual:** from an easygo-context session, `ls`/Read under `~/Documents/Journal/` was hard-blocked citing ADR-0008, but Write to `Journal/captures/sessions/2026-07-30-*.md` succeeded ungated — the agent can create files in a private vault it cannot list (no duplicate-detection, no naming-convention discovery).
- **Note:** raised on [#29](https://github.com/bearmoth/dotfiles/issues/29) (ADR-0008 amendment) as the write-side facet of the private-read downgrade — decide symmetric ask vs. documented write-only capture there.

### 2026-07-30 — Worklog nudge conflates "entry exists for today" with "entry exists for this session"  (friction → kept)
- **Component:** worklog stop-hook nudge
- **Expected:** nudge says to match on topic/session content, not just date, before deciding extend-vs-append.
- **Actual:** "extend it if an entry for this session already exists" met a same-day entry from an unrelated earlier session (navi/kubectl); the agent had to judgment-call appending a second `##` heading.
- **Note:** wording fix; fold into the worklog redesign.

### 2026-07-30 — No provenance convention for the injected `## Engineering OS` block  (cosmetic → kept)
- **Component:** SessionStart injection
- **Expected:** a lightweight convention (tag/phrase, or a line in the block itself) marking mounts/pulse as static registry facts to re-verify before citing as current.
- **Actual:** the registry-injected vs. verified-this-turn distinction lives entirely in per-agent judgment; 2026-07-30 feedback-session probing showed nothing stops an agent presenting the mount line as a search result.

## Resolved

### 2026-07-28 — Stop-hook worklog month-file not pre-created  (friction → by-design)
- **Component:** stop hook / worklog routine
- **Expected:** `log/YYYY-MM.md` exists when the worklog nudge fires.
- **Actual:** the first session of each month finds no file; the nudge instructs "create the file … if missing".
- **Resolution:** working as intended. Pre-creating the shard would mean a hook writing content into a vault that may be `org`-exposure (Engagement PKB) — exactly the write the taint gate (ADR-0005) exists to gate. The create-if-missing instruction in the nudge is the correct seam. Motivating report: eos issue #3 — also the inaugural dogfood entry for this backlog.
