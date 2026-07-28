# Engineering OS — invariant core

Knowledge belongs to a **context** (`personal`, `easygo`, …) — the ownership
boundary decided by the **first-person test**: Phil's own thinking and lived
experience is `personal` even when the subject is work; org records that don't
pass through his first person belong to their org. Each context owns at most
one **wiki** (curated, consulted) and one **journal** (raw, first-person) vault;
routing is always context × role, and there is **no fallback context** —
unresolved means say so, never default.

## The injected block

Every session starts with an `## Engineering OS` block (SessionStart hook):
the context this cwd resolved to, this machine's mounts (vault → local path),
the attribution tuple, and the **pulse** (routine freshness; a threshold line
there means something is rotting). Trust it over guesses. If it says
UNRESOLVED, knowledge routing is off — fix the registry before routing.

## Standing directives

- Routing knowledge to a vault, `/capture`, `_inbox` triage, or `/despec` →
  use the **knowledge-routing** skill. When unsure: ask about *whose*,
  default down about *where* (journal, `_inbox`).
- Any work needing a branch/checkout in any repo → use the
  **worktree-provisioning** skill; never mutate a default-branch checkout.
- Registry edits (contexts, vaults, mounts, machines) or `routines-audit` →
  use the **registry-maintenance** skill.
- A defect in engineering-OS *itself* (a hook misfiring, a routine's
  instructions wrong/ambiguous, an UNRESOLVED that shouldn't be, a missing
  scaffold) → `/eos-issue`. These are **system faults, not knowledge**: they go
  to the eos-issues backlog, never a vault; ordinary work still routes normally.
  Drained by `routines-audit` into `docs/eos-issues.md` (ADR-0007).
- The diary is never agent-written. Exposure only ever ratchets up via a
  human gate (taint hook enforces; don't launder through subagents).

## Capture-worthy shapes (offer, don't insist)

- A hard-to-reverse choice between real alternatives → offer an ADR
  (repo `docs/adr/` or context wiki).
- A first-person feeling/lesson about the work → offer a journal reflection.
- Org knowledge with a reusable skeleton → apply the **title test** (strip the
  employer — still a Tech Notes title?) and offer to queue it, phrased as that
  proposed title (`/despec` queue).

Glossary: `CONTEXT.md` in `bearmoth/dotfiles` · Registry:
`~/.config/engineering-os/registry.yaml` · Resolver: `eos-resolve`
