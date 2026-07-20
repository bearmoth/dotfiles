# Exposure is a one-way ratchet crossed only by human-gated promotion

Routing carries no per-note sensitivity classification. Instead each vault declares a single registry fact — `exposure: org | private` — and two rules do all the safety work: capture routes **down** (when unsure, the most private eligible destination — in practice the journal — never an org-exposed vault), and exposure increases only through **promotion** governed by the **source-visibility rule**: an agent may write to an org-exposed vault autonomously only when every claim is citable to a source already visible at that exposure; the moment any input came from private-exposure material (DM mirror, journal, reflection), the write is human-gated and the agent presents the exact proposed text in full — never a summary. (Wayfinder ticket [#11](https://github.com/bearmoth/dotfiles/issues/11).)

The design deliberately does not trust agent nuance. The motivating scenario: a useful DM that also contains unjustified blame of a colleague. The agent is never asked to detect the poison — it only has to know *where the material came from*, which is mechanical. The nuance call is made by the only trusted party, on the verbatim text.

## Considered options

- **Per-note sensitivity classification** (the Engagement PKB's three-tier `public`/`private-shareable`/`private-sensitive` vocabulary, promoted to OS level) — would have made sensitivity a routing input stamped on every artifact. Accepting this meant a classification judgment at every capture, agent nuance in the loop at exactly the wrong moment, and a middle tier ("whitelisted-shareable") that only means anything inside one vault's ingestion machinery. Rejected: sensitivity became a constraint satisfied by construction instead — capture always lands private, so nothing needs classifying at capture time. The three-tier scheme stays PKB-internal.
- **Autonomous journal→wiki promotion with agent-judged redaction** — would have kept the wiki current without interrupting Phil. Accepting this meant trusting an agent to reliably distinguish "useful insight" from "interpersonal poison" in mixed private material. Rejected: promotion is rare enough that human review of verbatim text is cheap, and the failure mode (private content in an org-readable repo) is unrecoverable.

## Consequences

- Capture is unthinking and safe by construction; no capture path ever requires a sensitivity judgment from agent or human.
- The mechanical half (agent touching an org-exposed vault after reading private material → block, require confirmation) is hook-enforceable — the enforcement design belongs to the routines ticket (#14), which now has a fixed policy to encode.
- The residual risk is named and accepted: Phil rubber-stamping a promotion without reading it. The design's job ends at putting the exact text in front of him.
