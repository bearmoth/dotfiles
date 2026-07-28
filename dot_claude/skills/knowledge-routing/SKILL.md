---
name: knowledge-routing
description: Route knowledge to the right vault (context × role), quick-capture on demand (/capture), drain the journal _inbox (triage), or drain the de-spec queue (/despec). Use whenever writing notes, worklogs, reflections, captures, or any knowledge to an Obsidian vault, or when the user says capture, triage, inbox, despec, or "where does this go".
---

# Knowledge routing

The routing key is **context × role** — a 2×2 today (wayfinder #11). Resolve
destinations with `eos-resolve mounts` / `eos-resolve context <path>`; never
hardcode vault paths.

|            | wiki ("what's true")  | journal ("what happened to me") |
|------------|-----------------------|---------------------------------|
| personal   | Tech Notes            | Journal                         |
| easygo     | Engagement PKB        | *empty by design*               |

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

## Mode: triage (drain `_inbox/`)

User-triggered only. For each `_inbox/` item, oldest first: route it per the
protocol (this is routing applied late — conventions enforced here), move it
into its destination, and delete the inbox copy **only after** the routed
write lands. Never delete or rewrite an item without routing it; never run
unattended. Report count drained + count remaining (feeds `routines-audit`).

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
