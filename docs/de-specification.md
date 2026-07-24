# De-specification workflow

How a valuable work artifact (an RFC, an incident workflow, a design decision) becomes a portable entry in the personal wiki (Tech Notes). Decided in wayfinder ticket [#15](https://github.com/bearmoth/dotfiles/issues/15); the reconstruction rule has its own ADR ([ADR-0006](adr/0006-despecified-notes-are-reconstructed-never-redacted.md)).

De-specification is the flagship **derived secondary** in fan-out routing: a *new* artifact derived from an org-exposed source, landing exposure-**downward** in a private vault. The taint gate never applies — the human checkpoint here exists for IP judgment, not exposure.

## The output bar

A de-specified note is a **fully generalised pattern — publishable in principle**.

- **Passes:** the pattern, the forces, the decision rationale, the technique. Provenance colour is fine ("learned this scaling Postgres at a betting company").
- **Fails:** a note whose subject *is* the employer's product — if the title could only exist because of that workplace, it doesn't belong. A stripped document that is still recognisably the original RFC also fails (see ADR-0006).

Strip list: employer/product/client names *as subject*, people's names, internal URLs / repo paths / ticket refs, non-public numbers (scale, incidents, anything financial), org-internal structure.

Existing employer-subject content in Tech Notes (`Tools/Moon/`) predates this bar and is **migration debt**, owned by the vault migration plan ([#18](https://github.com/bearmoth/dotfiles/issues/18)).

## Trigger: the title test

Strip the employer from the artifact in your head — **is there still a Tech Notes title worth writing?** If what remains teaches something (a pattern, technique, war story) with the specifics gone, it qualifies; if what remains is "we did the obvious thing," it doesn't.

The agent applies this at capture as the offer-tier routine from routines v1, and the offer is phrased **as the proposed title** ("this could become *Designing Risk Controls for Leveraged Products*") — judging the title is judging the candidate. Explicit flagging on request is always guaranteed. Offer acceptance is counted by the routines audit; the test tightens only on evidence.

## The queue

Candidates queue in **`WIP/De-spec Queue.md` in Tech Notes** (destination-side). Flagging is a private-vault write — exposure-downward — so it is **never taint-gated**: cheap from any session, which is the point.

Each entry: proposed title, source pointer, flag date, one-line why. Entries are transient plumbing, exempt from the output bar (they may name employer sources — the vault is private). A **`Drained`** section at the bottom of the file logs outcomes (date, drained/dropped, resulting note title) as the audit trail.

## The drain

**User-triggered only** — `/despec`, a drain mode of the `knowledge-routing` skill. No scheduling, no background machinery. Default: one candidate per invocation (each ends in a real rewrite plus review, not a batch chore).

The SessionStart pulse line is **threshold-gated and silent by default**: nothing when the queue is empty or fresh; one line only when any entry is older than **14 days** (pilot-tunable), e.g. `de-spec queue: 4, oldest 23d — /despec to drain`. The visible negative is a *rotting* queue, not a non-empty one.

## The pipeline

1. **Read** the source via the queue entry's pointer (reads are unrestricted).
2. **Reconstruct from understanding** ([ADR-0006](adr/0006-despecified-notes-are-reconstructed-never-redacted.md)): read the source, close it, write the note as if teaching the pattern fresh. The source informs, never templates.
3. **File per the destination's conventions** — Tech Notes' own CLAUDE.md governs naming, tags, and folder notes. **No backlink** to the work source: the link itself is an employer specific.
4. **Checkpoint**, then write.

## The checkpoint

**Unconditional.** No "obviously safe" bypass, ever — the moment the agent judges one candidate safe to skip, it is doing the nuance-judging the exposure model forbids. Trivial candidates cost seconds; a wrong "obviously safe" costs an IP argument.

Mechanics reuse the promotion gate's shape: the agent presents the **complete proposed note in-chat** — full text, path, tags; never a summary, never "wrote it, check later." Phil judges two things: **leak** (anything still smell like inside knowledge?) and **worth** (did the title test hold up?).

- **Approve** → write the note, move the queue entry to `Drained`.
- **Revise** → redraft in-session from feedback.
- **Drop** → entry moves to `Drained` marked dropped, never re-offers.

The asymmetry is the design: **flagging is zero-ceremony, landing is always eyes-on.**
