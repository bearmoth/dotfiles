# Role-typed dispatch instead of free-form mode parameter

Workers are dispatched as **roles** (implementor / researcher / reviewer),
each bundling a permission profile, tool allowlist, and default model —
rather than `dispatch_task(repo, task, mode)` where the orchestrator picks
an arbitrary mode. Scope becomes a property of *what kind of worker* it is,
not a per-call negotiation, and per-role tool carve-outs (reviewer's `gh`
access) become expressible at all.

**v1 pragmatism**: roles are hardcoded in the extension (three of them; a
config layer isn't justified and the protected extension path gives tamper
protection for free). Revisit trigger: role count growth, per-repo
variation, or the planner role's "explore-plus-one-path" permission shape —
any of which motivates roles-as-config.

Considered and cut: debugger/tester (briefs, not permission profiles),
refiner (needs mid-run HITL, impossible under sync `pi -p`), planner
(needs a new permission shape).
