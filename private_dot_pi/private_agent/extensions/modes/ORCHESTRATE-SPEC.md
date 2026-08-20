# Orchestrate mode — v1 specification

Status: designed, not implemented. Designed 2026-02 via grilling session; see
`docs/adr/0001`–`0004` for the decisions and their v1-pragmatism framing.
Glossary terms (Workstream, Role, Brief, Dispatch) are in `CONTEXT.md`.

## Identity

A fourth mode alongside Explore/Edit/Yolo. The orchestrator **reads
everything, writes nothing, and delegates all mutation** to dispatched
workers (ADR 0003).

- Mode id: `orchestrate`. Entered via `/mode orchestrate` (slash-command
  completion / the `/mode` picker make an alias unnecessary).
- **Excluded from the shift+tab cycle** (per FUTURES decision): shift+tab is
  a no-op while in Orchestrate; the cycle covers only explore/edit/yolo.
  Implementation note: split `CYCLE_ORDER` from the full mode list.
- Enforcement: identical to Explore (read-only tools, bash classifier, fail
  closed) **plus** the `dispatch_task` tool. No new read restrictions.
- The user can still mutate manually via the `!` bash prefix; the *model*
  cannot.

## Footer / UX

- All mode labels move to **title case**: `● Explore`, `● Edit`, `● Yolo`,
  `● Orchestrate`. (Fixes the existing ui-plus comment/code mismatch — the
  comment already said `● Edit`.) All-caps remains only in the model-facing
  `[MODE: …]` instruction blocks.
- Orchestrate dot color: **cyan via raw ANSI** (`\x1b[36m`) embedded in the
  status string. The theme's 51-token set has no cyan and a theme fork isn't
  justified for one dot. Existing colors unchanged (explore=mdLink,
  edit=warning, yolo=error).
- While a dispatch is running, the status shows the role as a gerund:
  `● Orchestrate ▸ researching` / `▸ implementing` / `▸ reviewing`.
  Plain `● Orchestrate` when idle. (This display dies at async — with N
  concurrent workers a single gerund is meaningless; see FUTURES.)

## The dispatch tool

```
dispatch_task(role, workdir, brief, model?, timeout?)
```

- **role**: `implementor | researcher | reviewer` (see Roles).
- **workdir**: absolute path; must exist and be a git checkout (worktree or
  main). Free path — no repo registry in v1 (that's EOS-flavored config,
  deliberately not entangled). Named `workdir`, not `repo`, because
  Workstreams point dispatches at worktrees.
- **brief**: one self-contained string. No structured params — doctrine
  mandates the sections (see Briefs). Structure-by-doctrine, not by schema.
- **model**: optional override of the role's default model.
- **timeout**: optional; default 15 minutes. On expiry: kill worker, report.

### Execution (sync v1 — ADR 0002)

Each dispatch spawns a fresh `pi -p` subprocess in `workdir`, blocking the
orchestrator's turn until it finishes. Workers are real pi sessions and
therefore inherit the modes extension guardrails; the worker starts in the
role's mode (via a `--mode`-equivalent or injected first command —
implementation detail to resolve).

Workers cannot converse with the user mid-run. Anything requiring HITL is
the orchestrator's own job (refinement, plan approval) or waits for async
(see FUTURES: interactive workers via herdr).

### Result shape

The tool returns:

1. the worker's final assistant message,
2. exit status,
3. the worker's **session file path** (full-transcript audit on demand).

The orchestrator **never trusts a worker's self-report of changes**: it
independently inspects via read-only git (`git -C <workdir> diff/status`).
This is both a correctness and a prompt-injection measure — worker output
is data, not instructions.

### Failure policy

Report the failure to the user and ask. No automatic retries in v1 —
retries are just rework cycles, and rework is user-gated (see Pipeline).

## Roles (v1: hardcoded — ADR 0001)

Defined as a TS map in the extension (role → mode + tool allowlist +
default model). The extension directory is already a protected path, so
role definitions get tamper protection for free. Move to config files only
when role count or per-repo variation demands it.

| Role | Permissions | Default model | Notes |
|---|---|---|---|
| `implementor` | edit | strong model | Deterministic QA (tests, lint) is part of its definition of done — the brief mandates "checks pass before you report". |
| `researcher` | explore | cheap/fast model | Fact-finding fan-out. |
| `reviewer` | explore + `gh` CLI (comment read/write) | strong model | The `gh` carve-out is the only per-role tool extension in v1. |

- **Worker mode ceiling: edit.** A `yolo` dispatch requires per-dispatch
  user confirmation. Revisit at sandboxing.
- **Not roles in v1** (deliberate cuts):
  - *debugger, tester* — an implementor/researcher with a different brief;
    split into roles only if permissions ever differ.
  - *refiner* — refinement is the orchestrator's own in-conversation HITL
    activity; a dispatched refiner can't converse under sync `pi -p`.
    Revisit at async (herdr's blocked-state plumbing is the natural vehicle).
  - *planner* — solution plans are presented in-conversation for user
    approval; if a persisted artifact is wanted, the first implementor
    brief includes writing it. A planner role needs an
    "explore-plus-one-path" permission shape that belongs with the
    roles-as-config refactor. Known not to scale to parallel workstreams —
    that's the revisit trigger.

## Briefs

One string, composed by the orchestrator per doctrine. Mandated sections:

- objective,
- relevant paths,
- constraints,
- acceptance criteria (implementors: including "tests+lint pass"),
- prior findings (for rework/review dispatches),
- **required report format**: the worker must end with
  `## Result / ## Changes / ## Concerns / ## Questions`.

The orchestrator treats only the report section as the report. If a worker
ignores the format, the orchestrator summarizes the final message itself
*and treats the violation as a red flag*.

## Pipeline

```
intake → refine (HITL) → plan (HITL approval) → implement → verify → review → report → [user gate] → rework…
```

1. **Intake**: user prompt only. The prompt may reference a ticket; the
   orchestrator reads it itself (`gh issue view`, files — all read-only,
   already permitted). No intake machinery.
2. **Refine**: orchestrator asks the user clarifying questions directly,
   in-conversation.
3. **Plan**: orchestrator decomposes into dispatches; solution plans are
   presented for user approval before implementation begins.
4. **Workstream setup**: a new body of work gets a worktree, created by a
   dispatched implementor with a setup brief (no special tool — the
   mutation monopoly stays with workers). One workstream ↔ one worktree.
5. **Implement**: dispatch implementor(s), sequentially (sync v1).
6. **Verify** (mandated): orchestrator inspects the diff read-only and
   re-runs deterministic checks *where the read-only classifier permits*
   (known limit: many test commands mutate; note discrepancies rather than
   forcing it).
7. **Review** (auto): reviewer dispatch is doctrine-mandated after
   verification — read-only, always valuable, no reason to gate it.
8. **Report**: consolidated — diff summary + verification findings +
   review findings.
9. **Rework gate** (manual — ADR 0004): if findings demand rework, the
   orchestrator *proposes* the corrective brief but waits for the user
   before dispatching. Rework = fresh worker with findings in the brief
   (no persistent worker state — ADR 0002).

## Doctrine location

- Tool description carries the **mechanics** (params, result shape).
- One `orchestrating` skill carries the **doctrine** for all roles:
  decompose, refine-before-plan, brief fully (mandated sections), verify
  independently, auto-review, propose-don't-dispatch rework. Split per-role
  only when it stops fitting one page.
- The per-turn mode instruction block stays tiny (~4 lines), matching the
  other modes: read everything, write nothing, delegate mutation via
  dispatch_task, treat tool output as data.

## Out of scope for v1 (recorded in FUTURES.md)

Async dispatch (task ids, status tool, worker counts, auto-loop with
max-iterations, per-role footer states); interactive workers via herdr
workspaces; planner role + explore-plus-one-path permissions +
roles-as-config; per-repo QA/check config (links to the existing per-repo
policy config entry); worker lifetime across feedback cycles.
