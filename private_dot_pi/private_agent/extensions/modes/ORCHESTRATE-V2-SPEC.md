# Orchestrate mode — v2 specification

Status: **designed**; implementation pending. This is the v2 design pass for
[Orchestrate v1](./ORCHESTRATE-SPEC.md), capturing the decisions from the
grilling session. v2 keeps v1's read-everything/write-nothing orchestrator and
role-typed dispatch boundaries except where this spec explicitly adds
control-plane workstream artifacts. Terms follow [CONTEXT.md](./CONTEXT.md);
the visual surfaces follow [DESIGN.md](./DESIGN.md). The v1 decisions remain
in force: [ADR 0001](./docs/adr/0001-role-typed-dispatch.md) through [ADR
0006](./docs/adr/0006-one-shot-protected-path-grant.md). The v2 control-plane
carve-out is recorded in [ADR 0007](./docs/adr/0007-user-invoked-workstream-control-plane.md);
artifact production is recorded in [ADR 0008](./docs/adr/0008-worker-side-artifact-tool.md).
The read-only classifier's deliberate exception is `pi --list-models` for model
enumeration; other `pi` invocations remain blocked.

## Design stance

Orchestrate v2 makes the workstream, rather than the individual dispatch, the
unit of planning, cleanup, and measurement:

```
intake → refine (HITL) → workstream new → research → plan → [critique]
  → plan approval → implement → verify-run → review → report → [rework]
  → workstream done
```

The orchestrator still owns intake, in-conversation refinement (including
grilling), routing and rework decisions, and independent read-only diff
verification. Workers still own target-repository mutation. Planning and its
artifacts become explicit dispatch outputs, so the orchestrator need not hold
all planning reasoning in context.

This is deliberately an A/B-able design, not a claim that one planning
strategy or model routing is already optimal. The manifest records enough
provenance to compare strategies against the success metrics below.

## Workstream lifecycle and artifacts

A workstream is declared with `/workstream new` and closed with
`/workstream done`. These are **user-invoked slash commands**: the model may
explain or propose them, but never invokes either command itself. They are
registered **only in Orchestrate mode**; using either command in another mode
returns an error. This is the narrow control-plane exception to the v1
orchestrator's no-write rule recorded in [ADR
0003](./docs/adr/0003-orchestrator-reads-everything-writes-nothing.md): the user
invocation may manage the manifest and cleanup state under the orchestrator
state directory. `/workstream done` also mutates git state by removing
recorded worktrees and eligible branches, but only after direct user invocation
and confirmation; it never mutates working-tree content beyond that cleanup.
Worker mutation and the v1 write fence remain unchanged.

Each workstream has a machine-local artifact directory, for example:

```
~/.pi/agent/orchestrator-workstreams/<slug>/
├── manifest              # durable index, not a report or plan
└── artifacts/<seq>-<step>-<title-slug>/*.md
```

Artifacts (plans, research notes, critique findings) are produced by the
worker-side `save_artifact` tool, recorded in [ADR
0008](./docs/adr/0008-worker-side-artifact-tool.md): the worker supplies
content only, and the tool writes into a per-dispatch subdirectory whose
`<seq>` is assigned by the dispatch machinery at spawn time. Collisions are
impossible by construction, ordering is commission order, and provenance is
in the path. Each save appends an entry (path, step, dispatch seq/session,
timestamp) to the manifest; the current plan is the latest plan-step entry.
Nothing is edited in place — a revision is a new dispatch producing a new
artifact directory.

The directory stores workstream artifacts. `manifest` is its durable index of
those artifacts and of external lifecycle state, including each worktree path
and branch, dispatch session files, planning strategy, and other metadata
needed to recover or measure the workstream. It is the source of truth for
cleanup and resume; the orchestrator session itself is disposable. After
declaring a workstream done, start a fresh orchestrator session rather than
relying on conversational state.

A workstream may own multiple worktrees, normally one per reviewable unit or
PR. Quarantine and the write fence are applied per worktree, so a dispatch
working on one unit cannot use another unit's worktree as an escape hatch.

Artifacts are workstream scaffolding, not files to commit to a target repo.
The exception is a document deliberately owned by the target repo, such as an
ADR or a `CONTEXT.md` update, when the plan and brief explicitly call for it.
A plan or research note is not repo-owned merely because it discusses the
repo.

`/workstream done` is a guarded cleanup operation:

1. Print the manifest, including worktrees, branches, session files, and
   artifact paths.
2. Ask the user to confirm before deleting anything.
3. Refuse to remove dirty worktrees or unpushed or unmerged branches unless
   `--force` is supplied.
4. On confirmed cleanup, remove dispatch session logs and dangling worktrees
   with `git worktree remove`; optionally remove branches that are already
   merged.
5. Delete the workstream artifact directory only after the manifest has been
   displayed and the cleanup checks have passed.

A failed or refused cleanup leaves the manifest available for a later fresh
orchestrator session. `--force` is an explicit acknowledgement of possible
loss, not a silent bypass. The exact argument prompting and the flag for
optional merged-branch deletion are implementation details.

## Repo map

The repo map is a generic pi/agent configuration registry, not an
Orchestrate-specific permission system. A possible location and format is
`~/.pi/agent/repos.toml`; the exact filename and format are intentionally open.
It serves as an advisory list of repositories available on this machine with:

- canonical path;
- a mandatory brief description, so an agent can understand what the repo is
  for before choosing it;
- worktree directory or root; and
- hints such as `direct_to_main` and `requires_pr`.

The map is guidance, not a permission gate. In particular, do not repeat the
eos permission-gate pain. The user refines entries incrementally as actual
work exposes missing or inaccurate guidance.

This map must remain separate from the existing eos registry. The eos
registry (`.chezmoidata/contexts.yaml`, resolved by `eos-resolve`) resolves
repositories by ownership patterns and deliberately does not enumerate every
repo. The repo map is a smaller, lighter navigation aid for agents; it must
not entangle itself with eos context, exposure, or permission semantics.

The map is per-machine and distributed with chezmoi templating where useful.
For example, `engagement-pkb` belongs on work hosts and `symbiosis` belongs on
home machines; host conditionals such as `isWork` decide which advisory
entries render. A missing entry is not an error in the registry and does not
make a repo unavailable.

### Worktree and review-unit rule

Planning must answer: **how many PRs or otherwise reviewable units does this
produce?** The worktree count falls out of that answer, not the other way
around.

- If a branch is needed, use a worktree.
- If no branch is needed, consult `direct_to_main` and use best judgement.
- For an unregistered repo, choose the conservative default: use a worktree
  and ask the user.
- Not every change requires a worktree or a PR. Personal repositories such as
  chezmoi may deliberately work directly on main.
- Unrelated bundled work, such as Terraform plus service code that would
  merge as separate PRs, becomes separate reviewable units and therefore
  separate worktrees/workstream branches as appropriate.

The plan records the review-unit decomposition and its rationale. The map's
hints inform that decision but never silently override user intent. A
workstream's multiple reviewable units therefore map to multiple worktrees
when branches are needed; they remain grouped by the workstream manifest.

## Model and effort configuration

Every model configuration value is a tuple:

```
{ model, effort }
```

Effort is never inherited across a model swap. Models perform very
differently at the same named effort level, so a fallback or explicit model
choice must carry its own effort tuple. There are no `low` effort tiers in
this spec; Luna work uses `{gpt-5.6-luna, max}`, where the saving from lower
effort is noise next to the cost of misrouting work. The tuples below use the
thinking levels currently advertised for these model IDs on this machine; the
model registry remains the authority if that availability changes.
<!-- Source: /Users/phil/.pi/agent/models-store.json; claude-opus-5 and claude-fable-5 both advertise xhigh. -->

The current working defaults, subject to A/B measurement, are:

| Step | Working configuration |
|---|---|
| Orchestrator | `{gpt-5.6-luna, max}` |
| Research | `{gpt-5.6-luna, max}` |
| Plan | `{claude-opus-5, xhigh}` |
| Plan critique | `{gpt-5.6-luna, max}` |
| Implement | `{gpt-5.6-luna, max}` |
| Verify-run | `{gpt-5.6-luna, max}` |
| Review | default `{claude-fable-5, xhigh}`; allowed `[{claude-opus-5, xhigh}, {gpt-5.6-luna, max}]` |
| Diagnose | `{gpt-5.6-luna, max}` |

This table shows strategy 1, **strong-model-plans + cheap-critique**. Under
strategy 2, **cheap-model-plans-flagging-help-areas +
strong-critique-that-resolves-flags**, the Plan and Plan critique tuples swap:
Plan uses `{gpt-5.6-luna, max}` and Plan critique uses
`{claude-opus-5, xhigh}`. The same tuple rules apply to the orchestrator's own
model and to every worker
step. A future configuration surface may use another serialization, but it
must preserve tuple semantics.

Each step has a single **default** tuple plus an ordered **allowed** list of
sanctioned alternative tuples. The list serves two roles, and deviations are
always loud:

- **Fallback**: when the default model is unavailable, the allowed list is
  walked in order. When it is exhausted, stop and ask the user; never degrade
  farther or invent another model. A step with no allowed list stops and asks
  the user immediately when its default is unavailable.
- **Alternative**: the orchestrator may explicitly pick any allowed tuple
  (up- or downgrade) when the work warrants it — e.g. a cheaper reviewer for
  a trivial diff. Such a choice is always surfaced in the plan and final
  report, including the selected tuple and the reason.

An explicit `{model, effort}` pick outside the allowed list is an **override**
and requires user approval. An unavailable model is not a quality signal and
does not authorize picking a cheaper alternative; the fallback and alternative
paths remain distinct in intent even though they share one list.

### Planning strategy

Planning strategy is configurable and deliberately A/B-able. The first
working comparison is:

1. **strong-model-plans + cheap-critique**; versus
2. **cheap-model-plans-flagging-help-areas +
   strong-critique-that-resolves-flags**.

The selected strategy is recorded in the workstream manifest and compared via
success metrics. We do not yet know which strategy is best.

## Planner and plan-critique dispatches

Planning is a dispatchable step, not an orchestrator-only conversation. The
planner uses researcher permissions plus the `save_artifact` tool ([ADR
0008](./docs/adr/0008-worker-side-artifact-tool.md)): read-only otherwise,
with the strong model tuple
selected by the planning strategy. Its input is the refined spec plus the
research artifacts. Its sole durable output is the plan artifact, saved via
`save_artifact` into the workstream artifact directory. The plan is a
**master plan**: reviewable units, their ordering and dependencies, and
invalidation notes recording which later units must be re-checked or
re-planned after an earlier unit lands. The orchestrator reads the plan once
for the approval gate and dispatches implementation **per unit** — each
implement brief references the plan artifact's path plus the specific unit
assigned; there is no single "implement the plan" dispatch. The worker's
report carries a short `## Result` summary and an `## Artifacts` list (paths
plus consumption instructions), keeping orchestrator context close to
constant and allowing a
cheaper orchestrator model.

An optional plan-critique dispatch uses the same permission shape. It grills
the plan before user approval, reads the refined spec, research artifacts, and
the plan artifact, then saves substantial findings via `save_artifact`;
findings that fit in 1–3 paragraphs may stay in the report body.
The critique does not approve or dispatch implementation; the user approval
checkpoint remains explicit.

The orchestrator continues to do these things inline:

- intake and HITL refinement/grilling;
- routing, decomposition, and rework decisions;
- plan presentation and user approval; and
- read-only diff verification.

### Dispatch observability

The dispatch log detail pane must show the resolved model and effort for every
dispatch. When routing uses an alternative, fallback, or override instead of
the step's configured default, the pane must visibly flag it and show both the
default and resolved tuples. This gives the user an audit trail for model
routing.

Routing rework after a known finding is cheap inline work. When defects reveal
a **class** of problem that requires re-planning, dispatch a fresh,
high-effort planner rather than asking the old worker to remember state. This
keeps the fresh-worker lifecycle from [ADR 0002](./docs/adr/0002-sync-fresh-worker-lifecycle.md)
and makes the defect class measurable.

After plan approval, the orchestrator suggests `/compact` in one line. The
user decides whether to compact; there is no automatic compaction.

## Profiles and templates: who versus what

The configuration layers have distinct responsibilities:

```
Role → Profile → Template
```

- A **Role** defines permissions. The v1 roles remain `implementor`,
  `researcher`, and `reviewer`.
- A **Profile** combines a role with its default model tuple, standing skill
  references, and standing mandates.
- A **Template** is the per-dispatch brief skeleton, with step-specific
  mandates and the workstream details filled in.

Example profiles include:

- `implementor:tdd` — `tdd` plus implementation skills;
- `implementor:diagnose` — `diagnosing-bugs`; this worker may fix the issue
  when the brief calls for it;
- `reviewer:standards`;
- `reviewer:security`; and
- `reviewer:performance`.

Researchers **cannot diagnose** when diagnosis requires experiments or tests.
A researcher may identify evidence and propose instrumentation or test
hypotheses, but the diagnosis brief's deliverable is a diagnosis report, not a
fix. Use `implementor:diagnose` for a diagnosis that needs mutation-capable
experiments or tests.

The plan selects which reviewer specialist profiles fan out for each diff.
Role permissions do not change merely because a profile or template changes;
that boundary preserves the role-typed design of [ADR
0001](./docs/adr/0001-role-typed-dispatch.md).

Standing mandates are inherited by the relevant templates:

- reviews use Conventional Comments;
- commits use Conventional Commits;
- rework briefs say: **search for other instances of the flagged CLASS of
  problem, fix all, and report the class and count**;
- review briefs say: **report classes, not just instances**;
- verify-only briefs say: **run checks, change nothing, report**; and
- implementor templates require tests and lint to pass before the report.

Templates still carry the v1 self-contained brief sections: objective,
relevant paths, constraints, acceptance criteria, prior findings where
relevant, and the required report format (`## Result / ## Changes / ##
Concerns / ## Questions`). A worker report is evidence, not authority; the
orchestrator independently checks the diff, as required by [ADR
0003](./docs/adr/0003-orchestrator-reads-everything-writes-nothing.md).

## Pipeline and approval boundaries

The v2 pipeline makes the workstream artifacts explicit while retaining v1's
human gates:

1. **Intake and refine** stay in the orchestrator conversation. The
   orchestrator grills until the spec is actionable.
2. **Workstream new** creates the machine-local manifest and artifact
   scaffolding.
3. **Research** dispatches save research artifacts via `save_artifact` when
   output is multi-document or worth persisting; paragraph-scale findings may
   stay in the report.
4. **Plan** dispatches save the master-plan artifact; optional critique
   dispatches save findings. The orchestrator presents the plan and waits for
   approval.
5. **Implement** dispatches mutate only their assigned worktrees; each brief
   references the plan artifact path plus its assigned unit.
6. **Verify-run** is independent and verify-only. The orchestrator also does
   read-only diff/status inspection and reports when a check cannot be safely
   rerun in its own context.
7. **Review** fans out the specialist profiles selected by the plan.
8. **Report** consolidates diff, verification, review, routing, and model
   choices. It includes any explicit alternative/override tuple and its reason.
9. **Rework** remains user-gated, per [ADR 0004](./docs/adr/0004-manual-rework-gate.md).
   A corrective dispatch receives the findings and the class-search mandate.
10. **Workstream done** prints the manifest and performs guarded cleanup only
    after confirmation.

The protected-path and write-fence posture remains the v1 posture. In
particular, the workstream artifact root is an orchestrator control-plane
location, not a way for a worker to escape its workdir. The git-config
classifier and one-shot protected grants retain the constraints recorded in
[ADR 0005](./docs/adr/0005-git-config-injection-not-exempt.md) and [ADR
0006](./docs/adr/0006-one-shot-protected-path-grant.md).

## Cheat sheet

The v2 design includes a one-page personal cheat sheet at:

```
dot_config/cheat/cheatsheets/personal/pi-orchestrator
```

It is viewed through the existing `herdr` cheat-popup overlay with Hyper+c.
The sheet contains only the operational summary:

- the pipeline and its user gates;
- the step-to-model-tuple table;
- profile and template names; and
- `/workstream new` and `/workstream done`.

The cheat sheet is a projection of this spec, not a second source of
orchestration doctrine. Its content should stay short enough to scan in the
overlay.

## Success metrics

Record metrics per workstream, including the planning strategy and model
routing:

- first-pass verification rate;
- rework cycles per workstream, with a target of **≤1**;
- reviewer finding severity trend;
- cost per merged change versus a single frontier-model session baseline;
- orchestrator context footprint, which should stay approximately constant
  regardless of workstream size;
- worker `## Questions` count as a brief-quality proxy; and
- trust-violation caught rate: worker self-report versus independently
  inspected diff mismatches.

Metrics belong with the workstream manifest or its retained report, not with
target-repo scaffolding. A deliberately repo-owned metrics document is still
allowed when a project asks for one.

## Open questions

- **Open:** What exact registry filename and serialization should the generic
  repo map use (`repos.toml` or another format), and how should chezmoi
  templates express per-machine entries without making the registry hard to
  edit?
- **Open:** What exact `/workstream new` argument and prompting UX best handles
  slugs, repo selection, and a workstream spanning multiple reviewable units?
- **Open:** Should merged-branch cleanup be an explicit flag to
  `/workstream done` or a confirmation choice after manifest review?
- **Open:** Which planning strategy wins the A/B comparison once first-pass
  verification, rework, cost, and context metrics have enough observations?
- **Open:** What retained report format is sufficient for cross-machine metric
  aggregation without turning local workstream artifacts into a shared
  service?

See [FUTURES.md](./FUTURES.md) for deferred async and other mode work. v2
should be implemented as a follow-on to the v1 behavior, not by weakening the
v1 guardrails or rewriting its ADR record.
