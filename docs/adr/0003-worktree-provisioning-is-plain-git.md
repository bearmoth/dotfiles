# Worktree provisioning is plain git; herdr observes

When an agent needs a worktree in any repo — including a repo other than the one its session started in — it runs plain `git worktree add` (auto-cloning the repo to its canonical path first if no clone exists on the machine). herdr is never the provisioning engine: it discovers worktrees passively, and its `agent start` / `wait` primitives are an *optional second step* used only when the work should be handed to a fresh session rather than done by the current one. (Wayfinder ticket [#13](https://github.com/bearmoth/dotfiles/issues/13).)

The property that makes this safe: herdr keeps no worktree database of its own — its `worktree list` is live discovery over `git worktree list` (verified in the [herdr research](../research/herdr-capabilities.md)). Bypassing herdr for writes can never make it inconsistent. State that is derived, not owned, cannot drift.

## Considered options

- **herdr-first with git fallback** — drive `herdr worktree create` when the socket is live, fall back to plain git otherwise. Rejected: two code paths with identical outcomes is pure surface area, and herdr's create is never *just* a worktree — it force-spawns a workspace/tab/pane (the API schema requires it), a UI side-effect unwanted for mechanical provisioning, with unverified behaviour when the terminal client is detached.
- **herdr as a hard dependency** — no fallback. Rejected for the same reasons, plus it couples a filesystem operation to a running server and makes the skill machine-fragile for zero gain.

## Consequences

- The `worktree-provisioning` skill is dependency-free and behaves identically on every machine, herdr or no herdr.
- herdr stays what it is good at: the human-visible surface, and the hand-off primitive (`agent start` → `wait`) when work moves to a fresh session.
- Worktree placement is always passed explicitly (the machine worktree root convention), so herdr's own `[worktrees] directory` default is irrelevant.
