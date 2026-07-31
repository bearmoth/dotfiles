---
name: knowledge-routing
description: Route knowledge to the right vault (context × role), quick-capture on demand (/capture), drain the journal _inbox and the session-end eos queue (triage), or drain the de-spec queue (/despec). Use whenever writing notes, worklogs, reflections, captures, or any knowledge to an Obsidian vault, or when the user says capture, triage, inbox, queue, despec, or "where does this go".
---

# Knowledge routing

The routing key is **context × role** — a 2×2 today (wayfinder #11). Resolve
destinations with `eos-resolve mounts` / `eos-resolve context <path>`; never
hardcode vault paths.

|            | wiki ("what's true")  | journal ("what happened to me") |
|------------|-----------------------|---------------------------------|
| personal   | Tech Notes            | Journal                         |
| easygo     | Engagement PKB        | *empty by design*               |

**Worklogs are journal material (ADR-0009).** A first-person work record never
routes to a wiki — any context's worklog lands in the Journal ledger
(`log/YYYY-MM-DD <machine>.md`), reaching it via the eos queue drain below.
Wikis receive only *knowledge*, through their own gates.

## Routing protocol

1. **Owning context — the first-person test.** Phil's own thinking or lived
   experience (reflections, diary, sessions he drove, DM mirrors) is
   `personal` even when the subject is work; org records not passing through
   his first person belong to their org. **Ownership doubt → ask** (with a
   recommendation attached).
2. **Role — curated vs raw.** Curated-to-be-consulted → wiki; raw
   first-person → journal. Knowledge *about events* (incident timelines,
   "A shipped X on date Y") is wiki material. **Role doubt → journal;
   exposure doubt → default down.** One line: *ask about whose, default
   downward about where.*
3. **Empty (context, role) cell** → surface the gap with a proposed
   resolution; never silently reroute.
4. **Before writing, read the destination vault's root entrypoint**
   (CLAUDE.md/AGENTS.md) and file per its conventions — intra-vault taxonomy
   is the destination's business. A vault without a readable entrypoint is
   not a valid destination. Roleless vaults (e.g. the draining Easygo vault)
   are never destinations.

**Fan-out**: exactly one primary write (always first); secondaries are
*different artifacts* with a declared transformation, **queued, not inline**
(de-spec below is the flagship). No cross-repo atomicity: a failed secondary
degrades to a surfaced follow-up, never blocks the primary.

**Cross-vault links** are courtesy pointers only: point at equal-or-broader
exposure (personal→org as URL; org→personal never), and every note must pass
the **404 test** — still makes sense if every cross-vault URL dies.

**Journal subject rules** (#12): topical notes may carry `about: [easygo]`
frontmatter naming their subject; dated notes inherit the era default. The
diary is **never agent-written**.

**Not a routing destination — eos defects.** A fault in engineering-OS itself
(a misfiring hook, an ambiguous routine, a wrong UNRESOLVED, a missing
scaffold) is a *system fault, not knowledge*. It never lands in a vault or
`_inbox` — capture it with `/eos-issue` (ADR-0007) and carry on.

## Mode: capture (`/capture`)

Guaranteed quick-capture — never left to auto-trigger. Route per the protocol
above; when at all unsure, land it in the Journal `_inbox/` with
`tags: [type/capture]` — zero friction, conventions are enforced at triage,
not here. `/capture` may route lines Phil dictates (including diary-bound
dictation — he authored the words). If the content is org knowledge with a
reusable skeleton, apply the **title test** and offer to queue it for
de-specification (see below).

## Mode: triage (drain `_inbox/` and the eos queue)

User-triggered only. Two queues, same session:

**The eos queue** (`eos-queue list` — this machine's session-end entries,
ADR-0009). This is the fan-out routine. For each entry, oldest first:

- `work-record` → the Journal ledger: `log/YYYY-MM-DD <machine>.md` (date and
  machine from the *entry*, never from today or this host — that's what makes
  drains out-of-order-safe and the ledger single-writer). Create the note with
  `tags: [type/worklog]` and an `about:` list naming every context in the
  file; append a `## <context> — <ticket> — <title>` section per entry.
  Condense to meaningful outcomes while writing — the ledger is `type/worklog`,
  not a capture, so tightening prose here is allowed.
- `knowledge` → route per the protocol: easygo + `org-ok` → Engagement PKB
  under its autonomy tiers (append-only with a citable source may be applied;
  new structure stays briefing-gated); `needs-despec` → the de-spec queue;
  `unsure` → Journal `_inbox/` (default down).
- Mark an entry drained **only after** the routed write lands:
  `eos-queue drain --done <id>...`. Other machines drain their own queues.

**`_inbox/`**: for each item, oldest first, route it per the protocol (this is
routing applied late — conventions enforced here), move it into its
destination, and delete the inbox copy **only after** the routed write lands.
Never delete or rewrite an item without routing it; never run unattended.

Report counts drained + remaining for both queues (feeds `routines-audit`).

## Mode: despec (`/despec` — drain the de-spec queue)

Queue: `WIP/De-spec Queue.md` in Tech Notes (entries: title, source pointer,
date, why — transient plumbing, exempt from the output bar; a `## Drained`
section logs outcomes). Flagging into the queue is exposure-downward and
never taint-gated. Drain one candidate per invocation, oldest first
(docs/de-specification.md in bearmoth/dotfiles has the full workflow):

1. Read the source note; **close it**; teach the pattern fresh from
   understanding — never paraphrase-and-strip (ADR-0006).
2. Output bar: **fully generalised, publishable in principle**. Provenance
   colour OK ("learned this at a betting company"); employer-product-as-
   subject fails — if the title could only exist because of the employer, it
   doesn't belong. Strip: employer/product/client names as subject, people,
   internal URLs/repos/tickets, non-public numbers, org internals. **No
   backlink to the work source.**
3. **Unconditional human checkpoint**: present the complete proposed note
   in-chat. Approve → file per Tech Notes conventions + log under `Drained`;
   revise in-session; drop → log, never re-offer.
