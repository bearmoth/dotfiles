# Authority is granted per decision class, never inferred from capability

Every prior ADR governs **exposure** — who may read or write what (ADR-0002's
ratchet, ADR-0005's taint, ADR-0008's ACLs). None governs **authority** — whose
approval *counts*. The two look similar and are orthogonal: ADR-0008 can demand
that an org write be reviewed and still say nothing about review *by whom*. That
silence got resolved ad hoc three times in the week of 2026-07-31 alone:

- The push gate's `EOS_PUSH_ACK=1` was set by a subagent because its task prompt
  said to — Phil's approval flowed through a coordinating agent into an env var.
  Right outcome, honor-system chain: an agent that skipped the
  surface-the-summary step would have passed identically.
- "Assuming the content is good quality, I'm happy to commit" delegated quality
  judgment to an agent for a sweep of ~30 wiki pages. Reasonable and efficient —
  and recorded nowhere with any standing.
- The Easygo drain found the right shape by accident: the executing agent was
  sandbox-blocked, so it emitted a reviewable script + manifest; the artifact
  was checked; execution followed it mechanically. Approval attached to the
  **artifact**, not to whoever ran it.

The same gap is ADR-0009's declared loose end from the other side: triage's
human checkpoint and the PKB briefing gates are "relaxed only by their own
future ADRs." This is that ADR — it defines what a relaxation would even mean.

## The principle

**Authority is a grant attached to a decision class and held by a principal.
It is never inferred from capability.** An agent that *can* set an env var,
run `rm`, or write to a vault does not thereby hold the authority those acts
represent. Conversely, a grant is only as good as its enforcement: where the
mechanism is honor-system, the ADR says so out loud rather than pretending.

Principals are: **Phil**, **the attended session** (the agent Phil is actively
steering — it holds what he delegates to it turn by turn), and **unattended
agents** (subagents, background tasks, future autonomous triage).

## The three decision classes

### Class 1 — exposure ratchets (human-only, never delegable)

Anything that widens who can see something: private→org promotion, pushes to
team-shared repos, registry ownership/exposure edits, de-spec approvals
(ADR-0006's checkpoint is a Class 1 instance). **Only Phil's approval counts.**
Agents prepare and present; they never hold the ack. Delegating a Class 1
approval to an agent does not relax the gate — it deletes it (the gate exists
*because* agent judgment is not trusted on exposure; an agent approving another
agent is that same judgment wearing two hats).

Enforcement change this ADR mandates: the push-gate ack must become something
an agent cannot mint. Direction: the gate prints a one-time nonce with its
summary; the push proceeds only when that nonce is supplied back
(`EOS_PUSH_ACK=<nonce>`), forcing the summary through a human-visible channel.
A static `EOS_PUSH_ACK=1` is the honor-system stopgap and is acknowledged as
such until the nonce ships.

### Class 2 — quality judgments (delegable per task, must leave a record)

Curation calls with no exposure delta: wiki synthesis and appends, `_import`
promotions into Tech Notes, commit sweeps of already-lawful content, routing
calls at triage. **Delegable from Phil to the attended session, and from it to
subagents — per task, not standingly.** The grant is legitimate when (a) the
task was stated by Phil or falls squarely inside what he asked for this
session, and (b) the work leaves a reviewable record: the audit log's
`org_write_cross_context` events, push-gate summaries, agent reports, log.md
entries. Veto stays live — anything Class 2 must be cheap to revert, which is
why it rides on git.

This legitimises what already happens instead of pretending it doesn't. What it
forbids is *ambient* delegation: "an agent did it before" is not a grant.

### Class 3 — destruction (artifact-approval pattern)

Bulk deletes, vault retirements, history rewrites, `rm -rf` of anything not
created this session. The Easygo drain pattern becomes the rule: **an agent
produces a deterministic plan-artifact (script + manifest, explicit paths, no
globs); a human approves the artifact; execution follows it mechanically.**
Authority attaches to the reviewed artifact — who executes it no longer
matters, which is the point. One-off small deletions in an attended session
stay ordinary (the permission prompt is the artifact); the pattern is mandatory
once the operation is too large to eyeball at a prompt.

## The trusted-stamper rule (closing ADR-0009's loose end)

A hook's `sensitivity: org-ok` is a **guess, not a stamp**. Today that is fine
because triage is attended — Phil makes the real call. If triage ever runs
unattended, the guess cannot be promoted to authority by the act of automating
it: **an autonomous drain may act only on human-ratified labels** — a stamp
Phil applied, or a written rule he ratified (e.g. "work-records to the Journal
ledger are always org-irrelevant; drain freely" — which ADR-0009 already
effectively grants). Everything else queues for the human. Autonomous triage
therefore needs no new gate design — it needs this one sentence enforced.

## What this changes in practice

- Phil gets *less* hands-on where it is safe: Class 2 delegation is now a
  legitimate, nameable act ("quality is yours this session") instead of an
  ambient drift, so it can be given — and revoked — in one sentence.
- The guarantees get *harder* where it is not: Class 1 stops being
  honor-system once the nonce ships; until then the gap is documented here
  rather than discovered live.
- Review-authority questions on issues stop being novel: label an issue's
  merge/close gate with its class. Class 1 → Phil; Class 2 → an agent review
  suffices if the report lands; Class 3 → artifact required.

## Rejected alternatives

- **Labels-only, no ADR** — answers "who reviews this issue" but is silent on
  env-var acks, delegated sweeps, and artifact approval, which is where the
  actual incidents lived. Labels are this ADR's *application*, not a substitute.
- **Per-claim provenance / capability tokens** — modelling every delegated act
  with cryptographic rigor. Rejected for the same reason ADR-0005 rejected
  per-claim taint: it demands nuance-judging machinery the system deliberately
  refuses; three coarse classes cover every incident observed.
- **Prohibiting delegation outright** — dishonest (it already happens, usefully)
  and directly against the north star: the system should stay out of the way.

## Consequences

- The push gate grows the nonce handshake (tracked as its own change; until it
  lands, Class 1 enforcement is by convention and this ADR says so).
- Agent task prompts that hand over `EOS_PUSH_ACK` are Class 1 delegations and
  therefore stop: the coordinating session pushes, or the human does.
- ADR-0008's amendment note and ADR-0009's "not yet granted" section both point
  here for what a future relaxation must satisfy.
- The grilling question for any new automation becomes mechanical: *which class
  is each decision it makes, and who holds that grant?*
