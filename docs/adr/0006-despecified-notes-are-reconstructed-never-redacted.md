# De-specified notes are reconstructed, never redacted

When a work artifact is de-specified into the personal wiki, the agent **reconstructs from understanding**: it reads the source, closes it, and writes the Tech Notes entry as if teaching the pattern fresh. The source informs the note; it never templates it. Working from a stripped copy of the source is forbidden — even with every name removed, a redacted RFC is still recognisably *that RFC*, and a note that could only exist because of the employer fails the portability bar in spirit no matter how clean its surface. (Wayfinder ticket [#15](https://github.com/bearmoth/dotfiles/issues/15).)

Reconstruction is deliberately lossy. That is acceptable: the queue entry keeps a pointer to the source, so while the context is live the detail remains one hop away; after the context ends, only what genuinely generalised was ever worth keeping.

One hard edge:

- **The human checkpoint is unconditional.** Every landing — however trivially safe it looks — is presented as the complete proposed text in-chat and approved by Phil (leak check + worth check). The moment the agent may judge a candidate "obviously safe" and skip the gate, it is performing exactly the nuance-judging the exposure model ([ADR-0002](0002-exposure-is-a-one-way-ratchet.md)) exists to keep away from agents. The gate's value is that it is mechanical.

## Considered options

- **Paraphrase-and-strip** (transform the source text directly). Rejected: cheaper and more faithful, but the output inherits the confidential document's structure and depth — document-shape is itself an employer specific, and it shifts more IP-judgment weight onto the checkpoint.
- **Conditional checkpoint** (skip review for trivially safe candidates). Rejected: reintroduces agent nuance-judging; trivial candidates cost seconds to approve, a wrong "obviously safe" costs an IP argument.

## Consequences

- The checkpoint reviews a genuinely new artifact for leaked specifics rather than diffing a redaction — easier, not harder.
- Fidelity loss is bounded by the live source pointer in the queue's `Drained` log; deep detail is retrievable until the context ends.
- The pipeline is structurally incapable of smuggling employer document-shape into the portable vault.
