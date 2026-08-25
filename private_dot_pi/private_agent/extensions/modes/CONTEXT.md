# Modes

Operating-mode guardrails for pi sessions: what the model may read, mutate,
and delegate, enforced independently of model instructions.

## Language

**Mode**:
A session-wide operating posture (Explore, Edit, Yolo, Orchestrate) that
fixes which tools and commands are permitted. Enforced, not advisory. Profile
is reserved for dispatch configuration, not a session posture.
_Avoid_: profile when naming a session posture, level

**Orchestrator**:
The agent in Orchestrate mode: reads everything, writes nothing, delegates
all mutation via dispatches.
_Avoid_: lead, manager

**Role**:
A worker archetype (implementor, researcher, reviewer) bundling a
permission set and tool allowlist.
_Avoid_: agent type, persona

**Profile**:
A dispatch configuration combining a Role with a default model tuple, standing
skill references, and standing mandates. A Profile does not replace the
session-wide Mode.
_Avoid_: mode, persona

**Template**:
The per-dispatch Brief skeleton, with step-specific mandates and workstream
details filled in.
_Avoid_: boilerplate, skeleton

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
One body of work — one ticket/request → one or more worktrees, normally one
per reviewable unit or PR → many dispatches. A workstream may own multiple
worktrees; quarantine and the write fence are per-worktree.
The unit above a dispatch and below the project.
_Avoid_: engagement, work item, assignment

**Worker**:
A dispatched child pi session running one brief in one workdir under one
role's permissions.
_Avoid_: subagent (reserve for the general pi concept)

**Dispatch log**:
The per-session record of every dispatch (role, title, status, timing,
report), rebuilt from session history on resume. Feeds all dispatch UI
surfaces.
_Avoid_: task list, history

**Sidebar**:
The toggleable pane listing the dispatch log. "Split" presentation reflows
the transcript (fullscreen); "overlay" floats above it.

**Detail pane**:
The pane showing one dispatch's full report, opened from the sidebar.

**Widget strip**:
The one-line dispatch summary above the editor in Orchestrate mode.

**Rework gate**:
The mandatory user approval between a review's findings and dispatching a
corrective implementor.
