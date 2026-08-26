# Workstream artifacts are saved by a worker-side, path-confined tool

Planner, researcher, and plan-critique dispatches persist durable outputs
(plans, research notes, critique findings) through a dedicated
`save_artifact` tool injected into the worker, not through general write
access and not by the orchestrator. The worker supplies content only; the
tool writes into a per-dispatch subdirectory of the active workstream's
artifact directory:

```
<workstream>/artifacts/<seq>-<step>-<title-slug>/<name>.md
```

`<seq>` is assigned by the orchestrator-side dispatch machinery at spawn
time, so two dispatches can never share a directory (collision impossible
by construction), ordering is commission order, and every artifact's path
carries its provenance. Within its own directory the tool uses
exclusive-create. Each save also mechanically appends an entry (path, step,
dispatch seq/session, timestamp) to the workstream manifest; "current plan"
is the latest manifest entry of that kind. Nothing is edited in place — a
revision is a new dispatch producing a new artifact directory.

Rejected alternatives:

- **Orchestrator write-on-settle** (extension writes the worker's returned
  report to `plan.md`): the write is transitively triggered by a
  model-invoked tool call, eroding [ADR 0003](./0003-orchestrator-reads-everything-writes-nothing.md)'s
  write-nothing guarantee. The [ADR 0007](./0007-user-invoked-workstream-control-plane.md)
  carve-out does not cover it — that carve-out's justification is a direct
  user invocation, absent here.
- **Fence-widening grant** ("explore-plus-one-path": give the researcher
  the general `write` tool fenced to `<workstream>/plan.md`): breaks
  [ADR 0001](./0001-role-typed-dispatch.md)'s role boundary (researchers
  have no write tools; a profile must not change role permissions) and sets
  a "just this one path" precedent for future fence requests.

The chosen tool keeps both ADRs intact: the orchestrator still writes
nothing, the researcher role still has no `write`/`edit`/`bash`, and the
model on neither side ever chooses a filesystem path — paths are determined
by `{workstream, dispatch seq, step}`. The artifact directory is quarantined
orchestrator state, advisory in content, and deleted at `/workstream done`,
so prompt-injected junk artifacts are contained. The tool is available only
to dispatched workers with an active workstream.

The workstream layout in the v2 spec's earlier illustration
(`plan.md` / `research/*.md` / `findings/*.md` at the top level) is
superseded by the per-dispatch layout above.
