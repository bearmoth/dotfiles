# Workstream lifecycle commands are a user-invoked control-plane carve-out

`/workstream new` and `/workstream done` are slash commands available only in
Orchestrate mode, and only the user invokes them. The model may explain or
propose either command, but it never calls them. `new` manages the
machine-local workstream manifest and artifact scaffolding; `done` displays
that manifest and, after user confirmation, performs guarded cleanup of the
recorded artifacts, dispatch logs, worktrees, and eligible branches.

Why: these lifecycle operations need to manage orchestrator-owned state and
clean up resources, but preserving the orchestrator's read-everything,
write-nothing guarantee keeps its independent verification trustworthy. The
user-invoked command is an authority carve-out, not general write access for
the orchestrator or its workers: neither command mutates a target repository,
and worker mutation remains constrained by its role, worktree, and write
fence as defined by [ADR 0003](./0003-orchestrator-reads-everything-writes-nothing.md).

The commands are not available as model-callable tools or as a generic
cross-mode escape hatch. Revisit if lifecycle automation needs a different
authority boundary or if guarded cleanup cannot remain inspectable and
user-confirmed.
