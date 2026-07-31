# Event taxonomy

The kinds of events that produce knowledge-system writes — the ubiquitous
language for routines, capture, and triage (agreed 2026-07-30). One real-world
moment is often several events at once (a session can complete work, surface
discoveries, and leave a feeling); that is what fan-out exists for
(see CONTEXT.md § Fan-out).

| Event kind | Example | Produces | Destination |
|---|---|---|---|
| **Work completed** | shipped a PR, finished an investigation | work-record | Journal ledger (via queue) |
| **Discovery** | how a system actually works, a constraint, a gotcha | knowledge entry | a wiki — triage routes (via queue) |
| **Decision** | hard-to-reverse choice between real alternatives | ADR | repo `docs/adr/` or wiki decisions |
| **Problem observed** | broken workflow, recurring failure | known-issue / open-question | a wiki — triage routes; *a fault in eos itself → eos-issue backlog instead (ADR-0007)* |
| **Incident** | production event with a timeline | incident record | org wiki (service/market pages) |
| **First-person experience** | a feeling or lesson about the work | reflection | Journal (offer only; the diary is never agent-written) |
| **Pattern spotted** | org knowledge passing the title test | despec candidate | despec queue → Tech Notes (ADR-0006) |
| **External record encountered** | a Slack thread / Confluence page worth keeping | staged mirror | org wiki `raw/` (ingest workflows) |

## Tiers

The first two rows are **obligations** — the session-end queue captures both
deterministically (ADR-0009). Every row below is an **offer** (agent proposes,
human decides) or a human-driven workflow (`/capture`, `/despec`,
`/weekly-ingest`). The line between the two is the boundary of automation.

## Routing responsibility

Where the destination says "a wiki", **triage decides**: the entry's context
attribution picks the candidate wiki, its sensitivity sets the as-is ceiling
(`org-ok` | `needs-despec` | `unsure` → default down), and the title test can
add a Tech Notes fan-out on top of an org-wiki write. Events that name the org
wiki are inherently org-events; there is no routing decision to defer.

## Where events originate

Claude sessions (the only origin with automated capture), Slack, meetings,
PagerDuty, PR reviews, and Phil's own head. Non-session origins reach the
system only through a human (`/capture`, `/weekly-ingest`) or an admitted
scraper (see CONTEXT.md § Scraper — admission is earned, one at a time).
