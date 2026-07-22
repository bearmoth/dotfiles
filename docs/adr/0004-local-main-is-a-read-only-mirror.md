# Local main is a read-only mirror; worktrees are cut from origin

New worktrees base off `origin/<default-branch>` after a `git fetch` — never off the local default-branch checkout. Local main is a read-only mirror whose staleness is irrelevant, because freshness is a property of the *fetch* (which no working copy owns), not of any checkout. Basing off a feature branch is an explicit override the caller must state, never a default an agent infers. (Wayfinder ticket [#13](https://github.com/bearmoth/dotfiles/issues/13).)

This is deliberately the opposite of "keep local main fresh". That goal is the trap: it invites `git pull` on checkouts that are in use — the exact disturbance the worktree workflow exists to eliminate (agents branching on, pulling into, or committing to whatever checkout of a repo happens to be open, often master).

Enforcement is one deterministic git-guardrails hook rule: mutating git commands (`commit`, `pull`, `merge`, `rebase`, branch creation) are blocked when the target working tree is a **repo's** default-branch checkout that is *not* the session's own workspace root. The carve-outs are load-bearing:

- **The session's own workspace root is exempt** — a session started in a checkout owns it (this dotfiles repo commits on `main` legitimately).
- **Vaults are exempt entirely** — vault ≠ repo; vaults are never worktreed, and commit-on-main in the vault checkout is their designed write path. Their safety regime is routing/exposure ([ADR-0002](0002-exposure-is-a-one-way-ratchet.md)), not worktree isolation.
- **Unresolvable working trees are blocked loudly** — a repo that resolves to no context is a routing gap surfacing itself, never a silent pass.

## Considered options

- **Keep local main fresh; base worktrees off it** — the intuitive model. Rejected: it makes every provision depend on the state of a checkout something else may be using, and the "freshening" operations are precisely the destructive ones.
- **Per-repo criticality tiers** (relax the rule for low-stakes repos). Rejected structurally: tiers would require per-repo registry data, and the registry deliberately never enumerates repos. The uniform rule costs seconds (cut a worktree); the exemptions above already cover the legitimate cases.

## Consequences

- Provisioning is always current and never touches a checkout in use; local main drifting stale is by design, not neglect.
- The hook denial message points at the `worktree-provisioning` skill — enforcement teaches the correct path at the moment of failure.
- Stacked-branch workflows remain possible but explicit (`--base <ref>` stated by the caller).
