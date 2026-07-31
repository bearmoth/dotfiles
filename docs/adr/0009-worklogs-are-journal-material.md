# Worklogs are journal material: session end queues down, triage fans out

The worklog routine wrote first-person work records into context wikis (`<wiki>/log/YYYY-MM.md`, per wayfinder #14/#16/#23). Two independent failures killed that design on 2026-07-29. First, ownership: a worklog is Phil's account of Phil's time — `personal` by the first-person test — and the Engagement PKB is on a path to squad-shared, where one member's activity log is noise (the entries had also drifted into session narrative, duplicating the Journal's session captures; and the destination was off-schema — the PKB's own CLAUDE.md never sanctioned a root `log/`). Second, mechanics: ADR-0008's ACLs made direct vault writes at session end structurally unreliable from cross-context sessions (reported same day as a blocking eos-issue: an easygo-context session unable to complete the Journal capture obligation). This ADR retires the wiki-bound worklog everywhere and inverts the flow: **session end writes down to a machine-local queue; a triage routine fans out to vaults.** (Supersedes the worklog halves of the wayfinder #14/#16 design and ADR-0008's clause 4 "worklog `log/` writes are plumbing-into-wiki" — there are no wiki worklog writes any more. Engagement PKB `personal/` is deprecated and is never a destination.)

## The principle

- **Worklogs are journal material.** First-person work records never live in a wiki — not the PKB (squad-shared future), not Tech Notes (curated, publishable-in-principle bar). Wikis receive only *knowledge* — "X is true of system Y" — through their own gates.
- **Session end queues down; triage routes up.** The only obligation at session end is one write to a store that is always legal from any context: the eos queue. Vault materialisation happens at triage, in a session whose context makes each write lawful. (This is the knowledge-routing fan-out rule — "secondaries are queued, not inline" — applied to the routines themselves.)

## The queue

`~/.local/state/engineering-os/queue.jsonl` — machine-local, uncommitted, unsynced (**accepted risk**, Phil, 2026-07-29: entries are transient staging, drained on the machine that wrote them). Written via the `eos-queue` CLI, never by hand-rolled JSON. Entry fields:

| field | content |
|---|---|
| `ts` | full ISO-8601 timestamp with offset — supplies the ledger date; makes out-of-order drains safe |
| `machine` | the declared machine id (below) — supplies the ledger filename |
| `session` | session id — idempotent drains, dedupe |
| `attribution` | the standard tuple: context, owner/repo, ticket-ref, branch |
| `kind` | `work-record` \| `knowledge` — the two beasts; routes ledger vs wiki |
| `body` | register pinned per kind: work-record = meaningful outcomes only (decisions, findings, things shipped — never blow-by-blow; narrative belongs to the session capture); knowledge = the finding stated as knowledge, not story |
| `sensitivity` | knowledge only: `org-ok` \| `needs-despec` \| `unsure` — the hook's best guess; triage makes the real call; `unsure` defaults down |

The queue holds no knowledge at rest long-term: it is staging with a drain, not a store (ADR-0007's "eos state is telemetry, not knowledge" boundary is preserved by the drain, and the pulse makes an un-drained queue loudly visible).

## Session end (obligation, Stop hook)

Same significance gate as before; the nudge now instructs:

1. **Queue** one `work-record` entry (plus `knowledge` entries for anything wiki-worthy the session surfaced) via `eos-queue add`.
2. **Session capture** direct to `Journal/captures/sessions/` **only when the session's context is the journal's own** (personal). Cross-context sessions queue only — their `work-record` body carries the summary until triage. This removes the impossible obligation ADR-0008's ACLs exposed.

## Triage fan-out (eos-owned routine)

Drains the local machine's queue (so a machine's entries are always drained where its queue lives — which is what makes the ledger single-writer):

- **work-record** → the Journal ledger: `Journal/log/YYYY-MM-DD <machine>.md` — one note per day per origin machine, sections per drained entry (`## <context> — <ticket> — <title>`), attribution in frontmatter (`tags: [type/worklog]`, `about:` list), `Worklog.base` as the digest view. Per-day-per-machine is the conflict-freedom design: only one machine ever writes a given file, so multi-machine, out-of-order drains cannot collide or misfile — ordering is the Base's concern, not the files'. (Machine suffix, not context: two machines can work the same context the same day. Not per-entry slugs: slugs need judgment; the machine id is deterministic.)
- **knowledge** → Tech Notes and/or Engagement PKB per the knowledge-routing protocol: the PKB path is bounded by its autonomy tiers (append-only + citable source autonomous; new structure briefing-gated); the Tech Notes path runs through de-specification (ADR-0006 — reconstructed, never redacted).
- Triage may condense work-record prose; the ledger is `type/worklog`, not a capture, so this does not violate the captures-are-terminal rule.

**Design direction, not yet granted:** the fan-out is built to eventually run without a human in the loop. The PKB briefing gates and despec's unconditional human checkpoint are relaxed only by their own future ADRs — never silently by this one.

## Declared machine id

`machine.id` is a human-declared kebab-case slug (e.g. `mbp-work`, `metabox`), collected by `promptStringOnce` at `chezmoi init`, carried forward across re-inits like the hand-maintained `eos:` block, and mirrored into the generated registry so `eos-resolve`/`eos-queue` read it. **Never derived from hostname**: factory defaults are non-unique (`MacBook-Pro`, `fedora`), macOS mutates hostnames on DHCP collisions, and case-insensitive APFS vs case-sensitive ext4 makes hostname-cased filenames a sync hazard. A machine without an id fails loudly — entries carry `machine: UNRESOLVED-<hostname>` and the pulse flags it — never a silent fallback (the "no fallback context" ethos). Migrating `isWork` off its hostname allowlist onto the id is follow-up debt ([#26](https://github.com/bearmoth/dotfiles/issues/26)).

## Pulse

- `worklog <ctx>`: newest of (queue entries by attribution context) and (Journal ledger notes) — a fresh dump is not stale just because triage hasn't run.
- `queue`: new threshold-gated line — depth and oldest-entry age of this machine's queue. This is what keeps "dump centrally, triage later" honest.
- `journal`: unchanged.

## Migration

The two existing wiki worklogs (`Engagement PKB/log/2026-07.md`, `Tech Notes/log/2026-07.md`) move wholesale into the Journal as legacy `type/worklog` notes (deduping one verbatim-doubled entry — live evidence of the append-drift this design eliminates), then are deleted from the wikis. Wiki-worthy nuggets found in them ride the new queue as its first cargo. The Journal README gains the `log/` folder and `type/worklog` tag; the CONTEXT.md glossary entries for worklog/session-capture are updated.

## Considered options

- **Keep a wiki worklog with a tightened register** — rejected: fixes the drift, not the ownership; the squad-shared future makes any member-activity log in the PKB wrong regardless of register.
- **Journal `_inbox/` as the queue** — rejected in favour of the central eos queue: Phil wants one dumb, always-legal write at session end and a single fan-out point; per-entry context attribution preserves enough to route at triage, and the unsynced-store risk is accepted. `_inbox/` remains the default-down landing zone for *knowledge* capture generally.
- **Monthly ledger shards (`log/YYYY-MM.md`)** — rejected: multi-machine drains into a shared file are a merge-conflict generator and need date-insertion logic; per-day-per-machine files make collisions structurally impossible.
- **Context suffix on ledger files** — rejected: doesn't guarantee single-writer (two machines, same context, same day).

## Consequences

- Session-end routines are completable from **any** context on **any** machine that has the hook — no vault mounts, no ACL interaction, no cross-context wall. The blocking eos-issue of 2026-07-29 is resolved by construction.
- The PKB never again receives first-person material; its worklog-era `log/` is deleted, and the off-schema-destination eos-issue is resolved.
- The record of a session exists immediately (queue entry, pulse-visible) but materialises in vaults only at triage — accepted, with the `queue` pulse line as the honesty mechanism.
- A lost/wiped machine loses its un-drained queue entries — accepted risk, bounded by triage cadence.
