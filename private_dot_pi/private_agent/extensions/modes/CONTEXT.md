# Modes

Operating-mode guardrails for pi sessions: what the model may read, mutate,
and delegate, enforced independently of model instructions.

## Language

**Mode**:
A session-wide operating posture (Explore, Edit, Yolo, Orchestrate) that
fixes which tools and commands are permitted. Enforced, not advisory.
_Avoid_: profile, level

**Orchestrator**:
The agent in Orchestrate mode: reads everything, writes nothing, delegates
all mutation via dispatches.
_Avoid_: lead, manager

**Role**:
A worker archetype (implementor, researcher, reviewer) bundling a
permission profile, tool allowlist, and default model.
_Avoid_: agent type, persona

**Dispatch**:
One synchronous worker invocation: a role, pointed at a workdir, given a
brief. Fresh worker each time; no state survives between dispatches.
_Avoid_: task (overloaded), job

**Brief**:
The single self-contained string a dispatch receives: objective, paths,
constraints, acceptance criteria, prior findings, required report format.
Everything the worker knows.
_Avoid_: prompt, spec

**Workstream**:
One body of work — one ticket/request → one worktree → many dispatches.
The unit above a dispatch and below the project.
_Avoid_: engagement, work item, assignment

**Worker**:
A dispatched child pi session running one brief in one workdir under one
role's permissions.
_Avoid_: subagent (reserve for the general pi concept)

**Rework gate**:
The mandatory user approval between a review's findings and dispatching a
corrective implementor.
