# Context

Ubiquitous language for the context-aware engineering OS (wayfinder map [#3](https://github.com/bearmoth/dotfiles/issues/3)).

## Glossary

### Context

The ownership/trust boundary a piece of knowledge belongs to — the party whose knowledge it is (`personal`, `easygo`, a future workplace). Every repo, vault, and reflection belongs to exactly one context. A context is intrinsic to the artifact, **not** to its location: personal artifacts may live on a workplace machine without changing context. There is no fallback context: `personal` is not special, and an artifact that resolves to no context is a routing gap to surface, never a silent default. Contrast with: *machine*, *mount* (where an artifact exists), "work/personal mode" (a context is not a mode you switch into).

### Vault

An Obsidian vault owned by a context — a destination knowledge is routed *to*. Backed by a git repo (it has a remote and clones), but modelled as its own entity type, never as a kind of repo: vaults are never worktreed, and carry vault-specific facts (Obsidian vault name, knowledge role). Contrast with: *repo* (a code workspace you provision worktrees from, never a routing destination).

### Role

The kind of knowledge home a vault is, from a controlled vocabulary of two: **`wiki`** — the context's curated reference knowledge ("what's true"): Engagement PKB for `easygo`, Tech Notes for `personal`; **`journal`** — raw chronological capture ("what happened"): diary, reflections, raw sessions. At most one vault per (context, role), so "the `easygo` wiki" resolves deterministically and routing policy is written against roles, never vault names. Portability is *not* a role — it derives from the owning context (`personal` never ends). De-specification is a transformation on a routing flow, not a vault property. A vault may be roleless (present but ineligible as a routing destination).

### Machine

A physical computer that mounts one or more contexts. Machines are never enumerated centrally: each machine self-describes in its local chezmoi config (which contexts it mounts, local paths). Onboarding a machine touches only that machine. Contrast with: *context* (a machine is where contexts are present, never an owner of knowledge).

### Repo

A code repository owned by a context — a workspace agents work *in*, and the thing worktrees are provisioned from. Never a routing destination for knowledge. Repos are not enumerated in the registry: a clone resolves to its context via *ownership patterns*, with explicit per-repo exceptions only where a repo breaks its org's pattern. Contrast with: *vault*.

### Worktree

An ephemeral working copy provisioned from a repo for one piece of work. Never registry data: existing worktrees are enumerated live from git/herdr via the repo's clone; a worktree inherits its context from the repo it was cut from. The registry holds only the per-machine worktree root convention. Contrast with: *repo* (durable, resolvable via the registry).

### Mount

The presence of a context on a machine, declared in that machine's local chezmoi data. A mount declares the context's local facts: `vaults` (role → local path; an undeclared vault is not present on this machine) and `roots` (directory prefixes serving as both path rules and clone-discovery roots). Machines also declare one machine-level worktree root. Contrast with: *context* (what is mounted, machine-independent).

### Ownership pattern

A remote pattern a context declares over the repos it owns — org-level (e.g. `github.com/bearmoth/*` → `personal`). The primary means of resolving a clone to its context. Contrast with: *path rule*.

### Path rule

A machine-local mapping from a filesystem path prefix to a context (e.g. `~/dev/personal/*` → `personal`). Covers clones with no remote (sandboxes, scratch dirs). Machine-local because disk layout is per-machine. Contrast with: *ownership pattern* (shared, remote-based).
