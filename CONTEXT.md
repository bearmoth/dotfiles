# Context

Ubiquitous language for the context-aware engineering OS (wayfinder map [#3](https://github.com/bearmoth/dotfiles/issues/3)).

## Glossary

### Context

The ownership/trust boundary a piece of knowledge belongs to — the party whose knowledge it is (`personal`, `easygo`, a future workplace). Every repo, vault, and reflection belongs to exactly one context. A context is intrinsic to the artifact, **not** to its location: personal artifacts may live on a workplace machine without changing context. Ownership follows the **first-person test**, never subject matter: an artifact is personal-owned when it is Phil's own thinking or a record of his direct lived experience (reflections, diary, sessions he drove, conversations he participated in — including DM mirrors), even when the subject is a workplace. Records of a context's activity that don't pass through Phil's first person (team meeting transcripts, incident timelines, org docs) belong to that context. There is no fallback context: `personal` is not special, and an artifact that resolves to no context is a routing gap to surface, never a silent default. Contrast with: *machine*, *mount* (where an artifact exists), "work/personal mode" (a context is not a mode you switch into), subject matter (what an artifact is *about* does not decide who owns it).

### Vault

An Obsidian vault owned by a context — a destination knowledge is routed *to*. Backed by a git repo (it has a remote and clones), but modelled as its own entity type, never as a kind of repo: vaults are never worktreed, and carry vault-specific facts (Obsidian vault name, knowledge role). Contrast with: *repo* (a code workspace you provision worktrees from, never a routing destination).

### Role

The kind of knowledge home a vault is, from a controlled vocabulary of two: **`wiki`** — the context's curated knowledge, consumed by lookup ("what's true"): Engagement PKB for `easygo`, Tech Notes for `personal`; **`journal`** — raw first-person capture, written in the moment ("what happened to me"): diary, reflections, raw sessions, DM mirrors. The test is *curated-to-be-consulted vs raw-first-person*, never *timeless vs dated*: knowledge about events (incident timelines, decision logs, "person A shipped X on date Y", project status) is wiki material. A raw first-person stream belongs to a person, not an org, so in practice only `personal` has a journal vault — a context's empty (context, role) cell is a fact, not a gap. At most one vault per (context, role), so "the `easygo` wiki" resolves deterministically and routing policy is written against roles, never vault names. Portability is *not* a role — it derives from the owning context (`personal` never ends). De-specification is a transformation on a routing flow, not a vault property. A vault may be roleless (present but ineligible as a routing destination).

### Exposure

Who can read a vault, declared as one registry fact per vault: **`org`** — the owning context's organisation can see it (e.g. Engagement PKB, hosted in the work org's GitHub) — or **`private`** — Phil only (Tech Notes, the journal). Exposure is a property of the *vault*, never a classification stamped per note: routing asks "would this content be comfortable at this vault's exposure?", and when unsure routes *down* to the most private eligible destination, never up. Contrast with: *sensitivity classification* (the Engagement PKB's internal three-tier ingestion vocabulary, which stays vault-internal machinery).

### Promotion

The deliberate act of moving knowledge *up* in exposure — in practice journal → wiki. Exposure increases only through promotion, and promotion is governed by the **source-visibility rule**: an agent may write to an org-exposed vault autonomously only when every claim is citable to a source already visible at that exposure; the moment any input came from private-exposure material (DM mirror, journal, reflection), the write is human-gated and the agent must present the exact proposed text in full. Capture is therefore unthinking and safe; exposure is a one-way ratchet crossed only with Phil's eyes on the verbatim text. Contrast with: *routing* (choosing where new knowledge lands; promotion moves knowledge that already landed).

### Cross-vault reference

A pointer from a note in one vault to a note in another. Always an **exception, never a feature**: intra-vault linking is dense and encouraged (each vault enforces its own edges), but a cross-vault reference is a courtesy pointer that carries convenience, never knowledge — the note must pass the **404 test** (still make sense if every cross-vault URL in it went dead), because contexts end and take their vaults with them. Points only toward equal-or-broader exposure (private → org allowed as a URL; org → private never — that leak is what *promotion* is for). A de-specified note carries no backlink to its work-context source: the link itself is an employer specific. Contrast with: *wikilink* (intra-vault, load-bearing, integrity-checked).

### Machine

A physical computer that mounts one or more contexts. Machines are never enumerated centrally: each machine self-describes in its local chezmoi config (which contexts it mounts, local paths). Onboarding a machine touches only that machine. Contrast with: *context* (a machine is where contexts are present, never an owner of knowledge).

### Repo

A code repository owned by a context — a workspace agents work *in*, and the thing worktrees are provisioned from. Never a routing destination for knowledge. Repos are not enumerated in the registry: a clone resolves to its context via *ownership patterns*, with explicit per-repo exceptions only where a repo breaks its org's pattern. Contrast with: *vault*.

### Worktree

An ephemeral working copy provisioned from a repo for one piece of work. Never registry data: existing worktrees are enumerated live from git/herdr via the repo's clone; a worktree inherits its context from the repo it was cut from. The registry holds only the per-machine worktree root convention. Contrast with: *repo* (durable, resolvable via the registry).

### Mount

The presence of a context on a machine, declared in that machine's local chezmoi data. A mount declares the context's local facts: `vaults` (role → local path; an undeclared vault is not present on this machine) and `roots` (directory prefixes serving as both path rules and clone-discovery roots). Machines also declare one machine-level worktree root. Contrast with: *context* (what is mounted, machine-independent).

### Root layer

The substrate every Claude session stands on before any work happens: a small static invariant core (what the contexts model *is*, always loaded) plus a dynamically injected situation block (which context this session resolved to, which mounts this machine has). On-demand capabilities sit above it; deterministic enforcement sits below it. A session in an unresolved location still has a root layer — it says so explicitly, never defaulting. Contrast with: *registry* (the data the root layer resolves against, not the loading of it).

### Ownership pattern

A remote pattern a context declares over the repos it owns — org-level (e.g. `github.com/bearmoth/*` → `personal`). The primary means of resolving a clone to its context. Contrast with: *path rule*.

### Path rule

A machine-local mapping from a filesystem path prefix to a context (e.g. `~/dev/personal/*` → `personal`). Covers clones with no remote (sandboxes, scratch dirs). Machine-local because disk layout is per-machine. Contrast with: *ownership pattern* (shared, remote-based).
