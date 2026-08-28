---
name: worktree-provisioning
description: Provision a git worktree for any piece of work in any repo — including repos other than the session's own — instead of branching on or mutating an existing checkout. Use when starting feature/ticket work, when work targets another repo, when a clone is missing, when the git guardrail denies a command, or for worktree cleanup sweeps.
---

# Worktree provisioning

Provisioning is **plain git** (ADR-0003); herdr only observes. Machine
conventions come from `eos-resolve mounts`: clone root and worktree root.
Worktree layout is universal: `<worktree-root>/<owner>/<repo>/<slug>`.
Clone layout is per-machine: use the repo's canonical path when one is known
(e.g. from the repo map); otherwise default new clones to
`<clone-root>/<owner>/<repo>`. Context derives from the owner segment via
ownership patterns, never from directory names.

## Provision

1. **Locate the clone.** Expected at the repo's canonical path for this
   machine (prefer a repo-map entry when present; otherwise use
   `<clone-root>/<owner>/<repo>`). Existing strays elsewhere under a machine
   root are legal (discovery-only). If no clone exists anywhere on the
   machine, **auto-clone to that canonical spot** — never fail with "clone it
   yourself", never guess a location.
2. **Branch name embeds the ticket ref** when one exists: `ABC-123-desc` /
   `dotfiles-13-desc` (a repo's own convention wins where one exists). Slug =
   branch with `/` → `-`. Ticket↔worktree mapping is derived by parsing,
   never stored.
3. **Cut from origin, freshly fetched** (ADR-0004):

   ```sh
   git -C <clone> fetch origin
   git -C <clone> worktree add <worktree-root>/<owner>/<repo>/<slug> \
       -b <branch> origin/<default-branch>
   ```

   Local main is a **read-only mirror** — its staleness is by design; never
   `git pull` a checkout to "freshen" it. Basing off a feature branch is an
   explicit `--base <ref>` override the caller must state, never inferred.
4. **Hand-off (optional).** Work moving to a fresh session may use
   `herdr agent start` / `herdr agent wait` (`--cwd <worktree>`); herdr
   discovers worktrees passively — never drive provisioning through it.

## Attribution

Durable notes/worklogs cite the tuple **(context, owner/repo, ticket-ref,
branch)** — never filesystem paths: a note must survive deletion of every
worktree it was written from.

## Guardrail (enforced by hook, ADR-0004)

Mutating git (commit/pull/merge/rebase/branch-create) is blocked on a repo's
default-branch checkout that isn't the session's own workspace root. Vaults
are exempt (vault ≠ repo — commit-on-main is their designed write path).
An unresolvable repo is blocked loudly: fix the registry
(registry-maintenance), don't work around it.

## Cleanup sweep (user-triggered only)

No autonomous deletion, no TTL. When asked to sweep: list evidence-backed
candidates — branch merged into origin default, upstream gone, stale-and-
dirty — for **batch approval**. Remove via `git worktree remove` (never
`rm -rf`), then `git worktree prune` in each affected clone.
