# Session-level taint gates org-exposure writes

The source-visibility rule ([ADR-0002](0002-exposure-is-a-one-way-ratchet.md)) gets one deterministic mechanism: the first read of private-exposure material (journal, DM mirrors, reflections) sets a **taint flag for the whole session**. From that moment, any autonomous write targeting an org-exposed vault is blocked and converted into a human-gated proposal — the agent presents the exact text in full, and Phil approves or rejects. Enforcement is a hook watching reads and writes, never an instruction the model may or may not follow. (Wayfinder ticket [#14](https://github.com/bearmoth/dotfiles/issues/14).)

Taint is deliberately crude: it records that private material *entered the session*, never which claims derive from it. That crudeness is the point — the agent only tracks provenance, which is mechanical, and never judges nuance, which ADR-0002 forbids.

Two hard edges:

- **No laundering.** The agent must never shed taint by delegating the org-vault write to a fresh-context subagent: the tainted parent composes the subagent's prompt, so the provenance travels with the text. The only exits are Phil's eyes on the verbatim text, or a genuinely fresh derivation from org-visible sources.
- **One approval, not nagging.** The gate converts a blocked write into a single proposal interaction. Collisions are rare by construction — sessions that read private material overwhelmingly write to private destinations (journal, Tech Notes), which taint never gates.

## Considered options

- **Per-claim provenance** (track which statements derive from private sources; auto-write the clean ones). Rejected: deciding which claims are "clean" is exactly the nuance-judging the exposure model exists to keep away from the agent. Revisit only if the pilot's gate-trip counter shows frequent false positives — with data, not on a hunch.
- **Prompt-layer instruction only** (CLAUDE.md tells the agent the rule). Rejected: the cross-repo research ([#6](https://github.com/bearmoth/dotfiles/issues/6)) established that context primitives are probabilistic; a safety rule that decays silently is not a safety rule.

## Consequences

- One journal glance mid-session downgrades that session's org-vault writes to human-gated for its remaining lifetime; starting a fresh session is the legitimate reset.
- The audit counts gate trips during the pilot, so any move to finer granularity is evidence-backed.
- Reads stay unrestricted everywhere — the boundary is autonomous *writes up* in exposure, nothing else.
