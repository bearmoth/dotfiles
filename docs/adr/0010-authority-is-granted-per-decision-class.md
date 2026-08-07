# Authority is granted per decision class, never inferred from capability

Prior ADRs name human gates — ADR-0002's human-gated promotion, ADR-0006's
unconditional de-spec checkpoint — but none defines **authority**: who the
principals are, whose approval *counts*, or how an approval may travel.
Exposure and authority look similar and are orthogonal: ADR-0008 can demand
that an org write be reviewed and still say nothing about review *by whom* —
or whether "Phil approved" may flow through a task prompt into an env var.
That silence got resolved ad hoc three times in the week of 2026-07-31 alone
(wayfinder [#29](https://github.com/bearmoth/dotfiles/issues/29)):

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
future ADRs." This ADR is not those relaxations — it defines what any of them
must satisfy.

## The principle

**Authority is a grant attached to a decision class and held by a principal.
It is never inferred from capability.** An agent that *can* set an env var,
run `rm`, or write to a vault does not thereby hold the authority those acts
represent. Conversely, a grant is only as good as its enforcement: where the
mechanism is honor-system, the ADR says so out loud rather than pretending.

Principals are: **Phil**, **the attended session** (the agent Phil is actively
steering — it holds what he delegates to it turn by turn), and **unattended
agents** (subagents, background tasks, future autonomous triage). Attendance
is about the grant channel — Phil issuing the task and reading the report —
not real-time watching: a session keeps its grants across long turns and
compaction, and no grant flows into a spawned agent implicitly.

Everything outside the three classes below — reads, capture-down writes,
ordinary code work — is just work: the session's existence is grant enough.
(And the diary stays what it always was: no class, no grant, never
agent-written.)

## The three decision classes

### Class 1 — exposure ratchets (human-only, never delegable)

Any decision that moves material outward across an exposure boundary — the
direction where a mistake is unrecoverable: private→org promotion, pushes of
org-exposed vaults, registry ownership/exposure edits, de-spec approvals
(employer material landing in the portable vault — ADR-0006's checkpoint is a
Class 1 instance), and outbound comms that carry content (a Slack send or
tracker comment is the same ratchet outside git). **Only Phil's approval
counts**, granted per act, on the verbatim content (ADR-0002's rule). Agents
prepare and present; the attended session may *relay* a fresh per-act approval
— Phil sees the summary, says yes, the session executes — but never
*originates* one and never forwards the ability to ack onward. A task prompt
that hands a subagent the ack does not relax the gate — it deletes it (the
gate exists *because* agent judgment is not trusted on exposure; an agent
approving another agent is that same judgment wearing two hats).

Code repos stay outside this class (ADR-0008 rule 3: repos are not vaults,
never gated). That is a named, accepted risk, not an oversight: what keeps
exposure-grade content out of repos is the routing rule that knowledge lives
in vaults — on repos, the gate is that there should be nothing to gate.

Enforcement change this ADR mandates: the push-gate ack must stop being
mintable *in advance*. Direction: the gate prints a one-time nonce with its
summary; the push proceeds only when that nonce is supplied back
(`EOS_PUSH_ACK=<nonce>`). That kills the task-prompt delegation observed
above — no summary yet, no nonce to hand over — and forces the summary to
exist before any ack can. Said out loud, per this ADR's own rule: the nonce
does **not** stop an unattended agent from reading it off its own gate output
and echoing it back — on a machine the agent can read, no local secret can.
The residual gate for that flow is attendance itself (the permission prompt
on the push). Until the nonce ships, a static `EOS_PUSH_ACK=1` is the
honor-system stopgap and is acknowledged as such.

### Class 2 — quality judgments (delegable per explicit grant, must leave a record)

Curation calls with no exposure delta: wiki synthesis and appends, `_import`
promotions into Tech Notes, commit sweeps of already-lawful content, routing
calls at triage. **Delegable from Phil to the attended session, and from it
to subagents — per explicit grant, never by precedent.** A grant takes one of
two forms: **per-task** (stated by Phil, or squarely inside what he asked for
this session) or a **written ratified rule** (documented and revocable — the
trusted-stamper mechanism below). Either way the work must leave a reviewable
record: the audit log's `org_write_cross_context` events, push-gate summaries,
agent reports, log.md entries. Veto stays live — anything Class 2 must be
cheap to revert, which is why it rides on git.

This legitimises what already happens instead of pretending it doesn't. What
it forbids is *ambient* delegation: "an agent did it before" is not a grant.

### Class 3 — destruction (artifact-approval pattern)

Bulk deletes, vault retirements, history rewrites, `rm -rf` of anything not
created this session. The Easygo drain pattern becomes the rule: **an agent
produces a deterministic plan-artifact (script + manifest, explicit paths, no
globs); a human approves the artifact; execution follows it mechanically.**
Authority attaches to the reviewed artifact — who executes it no longer
matters, which is the point. One-off small deletions in an attended session
stay ordinary (the permission prompt is the artifact); the pattern is mandatory
once the operation is too large to eyeball at a prompt.

Composite operations decompose: the Easygo drain was a Class 1 registry move,
Class 2 routing calls, and Class 3 deletions — each decision holding its own
grant.

## The trusted-stamper rule (closing ADR-0009's loose end)

A hook's `sensitivity: org-ok` is a **guess, not a stamp**. Today that is fine
because triage is attended — Phil makes the real call. If triage ever runs
unattended, the guess cannot be promoted to authority by the act of automating
it: **an autonomous drain may act only on human-ratified labels** — a stamp
Phil applied, or a written rule he ratified (e.g. "work-records always drain
to the Journal ledger": the routing rule ADR-0009 ratified; the *autonomy* to
drain unattended is exactly what it withheld, and only a future ADR grants).
Everything else queues for the human. Autonomous triage therefore needs no new
gate design — it needs this one sentence enforced.

## Enforcement mechanisms hold the class they gate

The hooks, the push gate, `eos-resolve`, and the registry sources live in an
agent-writable repo — editing them is the cheapest way to launder any class.
So a change that weakens or bypasses an enforcement mechanism carries the
class of the decisions that mechanism gates: gutting the push gate is Class 1
no matter how innocent the diff looks. Strengthening or refactoring under
test stays ordinary work; the class attaches to weakening the guarantee.

## What this changes in practice

- Phil gets *less* hands-on where it is safe: Class 2 delegation is now a
  legitimate, nameable act ("quality is yours this session") instead of an
  ambient drift, so it can be given — and revoked — in one sentence.
- The guarantees get *harder* where it is not: Class 1 stops being
  pre-delegable once the nonce ships; until then the gap is documented here
  rather than discovered live.
- Review-authority questions on issues stop being novel: label an issue's
  merge/close gate with its class. Class 1 → Phil; Class 2 → an agent review
  suffices if the report lands; Class 3 → artifact required.

## Considered options

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
  therefore stop: the attended session relays Phil's ack, or the human pushes.
- ADR-0008's amendment note and ADR-0009's "not yet granted" section both point
  here for what a future relaxation must satisfy.
- The grilling question for any new automation becomes mechanical: *which class
  is each decision it makes, and who holds that grant?*
