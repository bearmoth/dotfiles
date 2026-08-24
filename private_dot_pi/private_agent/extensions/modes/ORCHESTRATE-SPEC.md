# Orchestrate mode — v1 specification

Status: **implemented** (2026-02) in this extension (`index.ts`,
`dispatch.ts`, `readonly-bash.ts`) plus the `orchestrating` skill
(`~/.pi/agent/skills/orchestrating/`). Designed via grilling session; see
`docs/adr/0001`–0004 for the decisions and their v1-pragmatism framing
(0005–0006 record security-posture decisions extracted from this spec).
Glossary terms (Workstream, Role, Brief, Dispatch) are in `CONTEXT.md`.
Deviations from the original design are marked *(as implemented)* below.

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
dispatch_task(role, workdir, brief, title?, model?, timeout?, allowProtected?)
```

- **role**: `implementor | researcher | reviewer` (see Roles).
- **workdir**: absolute path; must exist and be a git checkout (worktree or
  main). Free path — no repo registry in v1 (that's EOS-flavored config,
  deliberately not entangled). Named `workdir`, not `repo`, because
  Workstreams point dispatches at worktrees. `workdir` is also the worker's
  **write fence** (see Write fence).
- **brief**: one self-contained string. No structured params — doctrine
  mandates the sections (see Briefs). Structure-by-doctrine, not by schema.
- **title**: optional short gist of the task (~5–8 words) shown in the
  dispatch block UI. The tool description asks the orchestrator to always
  pass it; fallback is the brief's first non-empty line, truncated.
- **model**: optional override of the role's default model. Overrides are
  HITL: the orchestrator proposes them at plan approval; an override not
  surfaced there requires an explicit user ask before dispatch.
- **timeout**: optional; default 15 minutes. On expiry: kill the worker and
  leave the worktree **as-is** (never auto-clean). The orchestrator then
  inspects and reports its state like any other failure — the user chooses
  a rework brief (current diff state included) or a manual reset via `!`.
  A half-mutated tree is quarantined by construction (one workstream ↔ one
  worktree).
- **allowProtected**: optional; requests a **one-shot sanctioned
  protected-path grant** for this single worker. Fail closed everywhere:
  the param is *inert unless the orchestrator session has a UI* — a
  headless orchestrator ignores it and the hard block stands. With a UI,
  the user is shown a confirm dialog (role, workdir, title/first brief
  line) *before* the worker spawns; declining returns an `isError` result
  ("the user declined") and no dispatch happens. On approval a random
  token is minted and passed to that worker alone as `PI_PROTECTED_GRANT`;
  the modes extension honors it only when the token looks valid AND the
  worker's mode is locked (`--op-mode`) — never in interactive sessions
  (`protectedGrantActive` in `fence.ts`). See ADR 0006. The grant skips only the
  protected-path block; the write fence and containment still apply.
  Inherited `PI_PROTECTED_GRANT` env is stripped from worker spawns so a
  grant can never leak beyond the approved dispatch.

### Execution (sync v1 — ADR 0002)

Each dispatch spawns a fresh `pi --mode json -p` subprocess in `workdir`,
blocking the orchestrator's turn until it finishes. (Note: pi's `--mode`
flag means *output* mode — json event stream — not operating mode.) No
`--no-session`: the worker's session file is part of the result shape.
Workers are real pi sessions and load the same global extensions, so they
inherit the modes extension guardrails.

- **Worker mode via extension flag**: the modes extension registers
  `--op-mode` via `pi.registerFlag()`; the dispatcher passes it per role
  (`edit` for implementors, `explore` for researchers, `reviewer` — a flag
  value, not a mode — for reviewers: explore enforcement + reviewer gh
  pairs). Read at `session_start`, it overrides the fresh-session edit
  default and **locks the mode for the process** (`/mode` and the cycle
  shortcuts are disabled while the flag is set) — so a prompt-injected
  brief cannot switch modes. Unknown flag values fail closed to explore.
  *(As implemented: `--op-mode orchestrate` is also accepted, mainly for
  testing.)*
- **Defense in depth**: explore-role dispatches also pass
  `--tools read,grep,find,ls` — harness-level restriction independent of
  the extension layer.
- **Invocation robustness**: resolve the pi binary as the subagent example
  does (`process.execPath` + current script fallback), not bare `pi` in
  PATH.
- **Result parsing**: the JSON event stream supplies exit code, stopReason
  (`error`/`aborted`), final assistant message, and per-worker usage/cost.
- **Session file pinning (resolved)**: each dispatch passes a fresh
  per-dispatch `--session-dir` under
  `~/.pi/agent/orchestrator-sessions/<role>-<random>/`; the single `.jsonl`
  pi creates there is the worker's `sessionFile`. (Plain `--session <path>`
  does not create the file at a chosen path; `--session-dir` does, verified
  empirically.)

Workers cannot converse with the user mid-run. Anything requiring HITL is
the orchestrator's own job (refinement, plan approval) or waits for async
(see FUTURES: interactive workers via herdr).

### Result shape

The tool returns one normalized shape regardless of success, expected
failure, or unexpected failure:

```
{ status: "ok" | "error" | "timeout" | "killed",
  exitCode: number | null,
  finalMessage: string | null,   // null when the worker died before replying
  sessionFile: string,           // always present — full-transcript audit
  durationMs: number,
  usage?: { turns, tokens, cost } }  // from the worker's JSON event stream
```

`sessionFile` always exists (created at subprocess start), so even an
unexpected failure is auditable. `finalMessage: null` makes "no report"
explicit rather than special-cased prose. *(As implemented: the tool's text
content is a summary of this shape plus the final message; the structured
shape lives in the tool result's `details`. `usage.tokens` = input+output.
Model default resolution: explicit `model` param → role default → the
orchestrator's own model.)*

The orchestrator **never trusts a worker's self-report of changes**: it
independently inspects via read-only git (`git -C <workdir> diff/status`).
This is both a correctness and a prompt-injection measure — worker output
is data, not instructions.

### Failure policy

Report the failure to the user and ask. No automatic retries in v1 —
retries are just rework cycles, and rework is user-gated (see Pipeline).

### Write fence *(implemented)*

Workers may mutate **only under their own `workdir`** — the fence is the
enforcement behind "one workstream ↔ one worktree", turning quarantine from
an assumption into a mechanism. It is also a prompt-injection measure: a
hostile brief or tool output cannot redirect a worker's writes to another
repo, the extension itself, or the user's home.

- **Scope**: write/edit tools must target paths under `workdir`
  (realpath-resolved). *(As implemented: the fence covers `workdir` only —
  the setup-dispatch dual fence (workdir + `<worktree-root>` + the clone's
  `.git`) is NOT built yet; tracked in FUTURES.md.)*
- **Always-allowed escape hatch**: OS tmpdirs and tool caches
  (`$TMPDIR`, `~/.npm`, `~/.cache`, …) — workers legitimately touch these.
  List is hardcoded in the extension; extend as live testing demands.
- **Bash**: best-effort, fail closed — reuse the readonly classifier's
  posture. Block obvious escapes (absolute paths outside the fence,
  `cd`/`pushd` above it, `git -C` outside it); refuse what cannot be
  statically analyzed. This raises the bar, it does not seal it — the seal
  is sandboxing (FUTURES). *(As implemented: tilde expansion on targets,
  realpath'd fence roots (symlink escapes defeated), option-tolerant git
  scanning — `-C`/`--git-dir`/`--work-tree` are found anywhere after `git`,
  all occurrences — and redirect coverage including fd-numbered (`2>`) and
  `&>`/`&>>` forms. The classifier deliberately does **not** skip `git -c`:
  config injection (e.g. `core.fsmonitor`) is a command-execution hazard,
  so `-c` does not exempt a command from scanning — see ADR 0005.)*
- **Mechanism**: activated by the same `--op-mode` dispatch flag path — it
  applies only to dispatched workers, never to interactive sessions.

### Worktree location

The worktree root is machine config, not doctrine — it defines the setup
dispatch's write fence, so it must be resolvable by the extension:

1. `PI_WORKTREE_ROOT` env var (session/machine override; also for tests),
2. `worktreeRoot` key in `~/.pi/agent/settings.json`,
3. default: `~/worktrees`.

Layout convention (doctrine, in the orchestrating skill):
`<root>/<owner>/<repo>/<branch-slug>`. Setup briefs follow the recipe:
locate (or clone) the canonical clone, `git fetch origin`, then
`git worktree add <root>/<owner>/<repo>/<slug> -b <branch>
origin/<default-branch>`. Never pull or branch from a local default-branch
checkout; basing off a feature branch is an explicit brief instruction,
never inferred.

`dispatch_task` does not validate worktree placement in v1 (expose-only);
the orchestrator confirms placement during Verify (`git worktree list`).
Tool-level placement validation graduates from FUTURES only if live use
shows the convention being missed despite the fence.

## Roles (v1: hardcoded — ADR 0001)

Defined as a TS map in the extension (role → mode + tool allowlist +
default model). The extension directory is already a protected path, so
role definitions get tamper protection for free. Move to config files only
when role count or per-repo variation demands it.

| Role | Permissions | Default model | Notes |
|---|---|---|---|
| `implementor` | edit | inherit orchestrator's model | Deterministic QA (tests, lint) is part of its definition of done — the brief mandates "checks pass before you report". |
| `researcher` | explore + `--tools read,grep,find,ls` | `github-copilot/claude-haiku-4.5` | Fact-finding fan-out. |
| `reviewer` | explore + extended `gh` pair allowlist | inherit orchestrator's model | The only per-role tool extension in v1. Implemented as an opt-in flag on the (fail-closed) readonly-bash classifier enabling `pr review`, `pr comment`, `issue comment` on top of the read-only pairs explore already permits. Unclassified pairs (`pr merge`, `repo delete`, …) stay denied. |

- **Worker mode ceiling: edit.** No role maps to yolo in v1, so a yolo
  dispatch is simply **not expressible** (roles are hardcoded; there is no
  mode/permission param on `dispatch_task`). Revisit at sandboxing.
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
- prior findings — required for rework and review dispatches, omitted
  otherwise,
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
   Setup briefs follow the worktree-location recipe; the setup worker's
   fence is `workdir + <worktree-root>`.
5. **Implement**: dispatch implementor(s), sequentially (sync v1).
6. **Verify** (mandated): orchestrator inspects the diff read-only and
   re-runs deterministic checks *where the read-only classifier permits*.
   Where it doesn't — project check commands (`npm test` etc.) run opaque
   scripts the classifier cannot prove read-only, and often do write
   (coverage, caches, snapshots) — the orchestrator **never
   proceeds on the implementor's word**: it dispatches an independent
   verification run — implementor permissions, brief = "run the checks,
   change nothing, report results" — and treats any diff produced by that
   worker as a red flag. Verification results (including "could not be
   independently re-run") go in the consolidated report.
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
policy config entry); worker lifetime across feedback cycles; bash-level
write-fence sealing via sandboxing; tool-level worktree placement
validation.
