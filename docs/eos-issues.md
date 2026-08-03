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

_Drained 2026-07-31 (routines-audit): 3 sightings — 2 kept, 1 dropped
(resolved out-of-band). ADR-0009's deploy on easygo-laptop resolved 4 of the
existing entries (moved below); the 3 remaining open items are two #29
decisions plus one unclaimed cosmetic, and the new guardrail bypass is the
only blocking item._

_Drained 2026-07-30 (routines-audit): 8 sightings, all kept, none dropped,
none fix-now. Two clusters dominate: the worklog routine (3 items, mid-redesign
since the 2026-07-29 grilling session) and the ADR-0008 cross-context ACL
(2 items, fix direction already decided, ADR pending)._

### 2026-07-31 — Git guardrail blind to `cd` in compound commands: trivial ADR-0004 bypass  (blocking → kept)
- **Component:** git-guardrail hook (ADR-0004 enforcement)
- **Expected:** a mutating git command targeting another repo's default-branch checkout is blocked unless that checkout is the session's own workspace root.
- **Actual:** the hook resolves its target from `git -C <path>` if present, else the session cwd — it never parses `cd` in the command string. `cd /other/repo && git merge` therefore resolves to the *session's* repo, matches the workspace-root exemption, and passes. Observed live 2026-07-31: `cd ~/.local/share/chezmoi && git merge --ff-only` ran unblocked from a session rooted in a different clone. ADR-0004's documented rail fails silently against the most ordinary shell idiom an agent uses.
- **Note:** fix direction — parse leading `cd`/`pushd`, or resolve the target from the shell's effective cwd; consider failing closed when a mutating command contains a `cd` the hook cannot resolve.

### 2026-07-31 — Pulse queue line misdiagnoses pre-id entries as "UNDECLARED machine.id"  (friction → kept)
- **Component:** eos-resolve pulse (queue line, ADR-0009)
- **Expected:** two states distinguished — (a) no `machine.id` in the registry → tell the user to run `chezmoi init`; (b) id declared but queued entries carry an `UNRESOLVED-<hostname>` stamp from before it existed → tell the user to drain, since re-running init cannot rewrite existing entries.
- **Actual:** the line keys off `q_unresolved` from `worklog_ages()`, which scans queue *entries* for an `UNRESOLVED-*` stamp and never checks the registry. With `id: easygo-laptop` declared, entries from 2026-07-29 still printed "pending with UNDECLARED machine.id — set it via chezmoi init"; Phil ran init, saw no change, and asked why it hadn't taken (it had). Recurs by construction on every machine bootstrap — metabox is still uninitialised. Self-clears when the affected entries drain.

### 2026-07-28 — Taint-gate confirmation prompt too uninformative to act on  (blocking → kept)
- **Component:** taint-gate hook (ADR-0005)
- **Expected:** prompt gives Phil everything needed for a five-second approve/reject: which read set the taint, which vault/file the write targets, a pointer to docs/adr/0005 — plus the verbatim text ADR-0002 requires.
- **Actual:** prompt cites "ADR-0005" by number only, names neither the tainting read nor the write target.
- **Note:** superseded by [#29](https://github.com/bearmoth/dotfiles/issues/29) — the taint gate is slated for early retirement post-ADR-0009, so the prompt rewrite is moot. Audit-window evidence (routine-obligated worklog writes tripped the gate 4× in 3 days) commented on #29 as retirement support.

### 2026-07-30 — ADR-0008 ACL asymmetry: foreign-context reads hook-blocked, writes ungated  (friction → kept)
- **Component:** adr-0008-acl-hook
- **Expected:** writes from a foreign context to a private vault gated like reads — or the write-only capture path explicitly documented as intended in ADR-0008/CLAUDE.md.
- **Actual:** from an easygo-context session, `ls`/Read under `~/Documents/Journal/` was hard-blocked citing ADR-0008, but Write to `Journal/captures/sessions/2026-07-30-*.md` succeeded ungated — the agent can create files in a private vault it cannot list (no duplicate-detection, no naming-convention discovery).
- **Note:** raised on [#29](https://github.com/bearmoth/dotfiles/issues/29) (ADR-0008 amendment) as the write-side facet of the private-read downgrade — decide symmetric ask vs. documented write-only capture there.

### 2026-07-30 — No provenance convention for the injected `## Engineering OS` block  (cosmetic → kept)
- **Component:** SessionStart injection
- **Expected:** a lightweight convention (tag/phrase, or a line in the block itself) marking mounts/pulse as static registry facts to re-verify before citing as current.
- **Actual:** the registry-injected vs. verified-this-turn distinction lives entirely in per-agent judgment; 2026-07-30 feedback-session probing showed nothing stops an agent presenting the mount line as a search result.

## Resolved

### 2026-07-31 — ADR-0008 gate prompted on read-only Bash; per-call prompt volume during sanctioned drains  (friction → fixed 2026-07-31)
- **Component:** adr-0008-acl-hook (cross-context write gate)
- **Resolution:** shipped on `eos-workflow-fixes` (merged, deployed 2026-07-31): `bash_command_is_read_only()` lets provably read-only commands through unprompted (doubt keeps the ask), and PostToolUse-derived session grants made cross-context org writes ask once per (session, vault). The volume facet is being superseded again by the #29 push-time gate (org writes allow + audit; exposure gated at push).

### 2026-07-31 — No routine surfaces stale/merged worktrees  (friction → fixed 2026-07-31)
- **Component:** worktree lifecycle (ADR-0003)
- **Resolution:** `eos-resolve health` (same branch) lists merged-into-origin-default + clean worktrees as removable candidates; removal stays user-approved per the cleanup-sweep rule.

### 2026-07-28 — knowledge-routing skill missing the plumbing-write class  (cosmetic → resolved by ADR-0009)
- **Component:** knowledge-routing skill
- **Expected:** skill documents wiki `log/` entries as digestion feedstock (plumbing-into-wiki), not curated wiki content; CONTEXT.md's "curated, wiki-bound" worklog definition contradicted the 2026-07-28 routing-audit decision.
- **Resolution:** overtaken — ADR-0009 retired wiki `log/` entirely, so the plumbing-into-wiki class no longer exists. Verified 2026-07-31: CONTEXT.md now defines worklogs as journal-ledger-bound ("never wiki") and the deployed knowledge-routing skill says the same.

### 2026-07-29 — Worklog writes off-schema for the PKB; register drifts into session narrative  (friction → resolved by ADR-0009)
- **Component:** eos-stop.py worklog routine
- **Expected:** worklog destination sanctioned by the destination vault's conventions, with a pinned register distinct from Journal session captures.
- **Resolution:** the direct-to-wiki worklog write no longer exists — the stop hook queues a work-record and triage materialises it in the Journal ledger (`log/YYYY-MM-DD <machine>.md`), whose register the drain instruction pins ("condense to meaningful outcomes"). Deployed on easygo-laptop 2026-07-31; both wiki `log/` shards swept into the ledger the same day.

### 2026-07-29 — Session-capture obligation impossible from easygo-context sessions  (blocking → resolved by ADR-0009)
- **Component:** eos-stop.py routines × ADR-0008 ACL
- **Expected:** session-end routines completable from any context; defect reporting never gated behind a vault ACL.
- **Resolution:** the session-end obligation now writes down to the machine-local eos queue — no vault write at session end, so no ACL to hit. Deployed and verified on easygo-laptop 2026-07-31 (an easygo PKB session queued its work-record cleanly, correctly stamped). [#28](https://github.com/bearmoth/dotfiles/issues/28) stays open only for the metabox init.

### 2026-07-30 — Worklog nudge conflates "entry exists for today" with "entry exists for this session"  (friction → resolved by ADR-0009)
- **Component:** worklog stop-hook nudge
- **Expected:** nudge matches on session content, not just date, before deciding extend-vs-append.
- **Resolution:** the nudge is gone — the stop hook queues instead of nudging a vault write, and the drain appends one section per queue entry, so the extend-vs-append judgment no longer exists. Old wording verified absent from the deployed hooks 2026-07-31.

### 2026-07-28 — Stop-hook worklog month-file not pre-created  (friction → by-design)
- **Component:** stop hook / worklog routine
- **Expected:** `log/YYYY-MM.md` exists when the worklog nudge fires.
- **Actual:** the first session of each month finds no file; the nudge instructs "create the file … if missing".
- **Resolution:** working as intended. Pre-creating the shard would mean a hook writing content into a vault that may be `org`-exposure (Engagement PKB) — exactly the write the taint gate (ADR-0005) exists to gate. The create-if-missing instruction in the nudge is the correct seam. Motivating report: eos issue #3 — also the inaugural dogfood entry for this backlog.
