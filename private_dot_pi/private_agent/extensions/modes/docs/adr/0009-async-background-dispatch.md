# Async dispatch: background tasks with pushed settles

## Status
Accepted (design pass 2026-08; supersedes the "sync-only" posture of ADR 0002
without replacing it — sync remains the default lifecycle).

## Context
Sync v1 (ADR 0002) blocks the orchestrator's turn inside `dispatch_task`
until the worker exits. Fan-out steps (research, review specialists) pay
serial latency, and the user cannot converse with the orchestrator while a
worker runs. FUTURES.md scoped the async pass: task ids, status, parallel
workers, manifest concurrency.

## Decision
1. **Opt-in background**: `dispatch_task` gains `background: true`. Default
   remains synchronous — existing doctrine, briefs, and tests are untouched.
   A background dispatch returns `{ taskId, status: "running" }` immediately.
2. **Pushed settles**: on settle, the extension injects the settle summary
   via `pi.sendMessage({ deliverAs: "steer", triggerTurn: true })` — the
   orchestrator is woken when idle, or sees the settle before its next LLM
   call when mid-turn. No polling loop burns turns.
3. **`dispatch_wait`**: blocks on one/any/all task ids for when the
   orchestrator has nothing useful to do until results land. `dispatch_status`
   (pure poll) is deferred to FUTURES unless push proves noisy.
4. **Manifest concurrency**: all manifest writes remain orchestrator-side in
   one process; an in-process serial write queue plus write-temp+rename makes
   concurrent settles safe. No file locks; a per-entry append log is the
   escalation path only if multi-process orchestration ever lands.
5. **Per-repo serialization**: dispatches targeting the same repo (canonical
   clone or any of its worktrees) queue per-repo; different repos run in
   parallel. This also keeps the created-worktree snapshot diff
   (dispatch.ts) race-free without changing its mechanism.
6. **Concurrency cap**: max 3 in-flight background dispatches (settings
   override `dispatchConcurrency`); dispatch attempts past the cap fail fast
   with a clear message. Footer shows per-role in-flight counts.
7. **Doctrine**: background is sanctioned for research and review fan-out.
   Implement units stay sequential by default; a background implement
   dispatch requires the plan to have declared the units independent
   (disjoint files/worktrees).

## Consequences
- Fresh-worker-per-task and brief self-containment (ADR 0002) are unchanged;
  only the blocking behavior is optional.
- The rework gate (ADR 0004) is unchanged: settles report; the user gates.
- UI: dispatch sidebar already renders multiple entries; the footer gains
  in-flight counts. Kill-from-log moves from FUTURES into this pass's scope.
- Timeout/abort semantics carry over per task; an aborted orchestrator turn
  does not kill background workers — `dispatch_wait` or the settle push
  reattaches them.
