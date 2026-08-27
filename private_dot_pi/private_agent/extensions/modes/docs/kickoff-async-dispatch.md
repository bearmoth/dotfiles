# Kickoff: implement async background dispatch (ADR 0009)

Implement ADR 0009 (async background dispatch) in the modes extension at
`~/.pi/agent/extensions/modes/`. Files are chezmoi-managed: after edits,
`chezmoi re-add` the changed files before committing in
`~/.local/share/chezmoi` (Conventional Commits).

## Read first (in order)
1. `docs/adr/0009-async-background-dispatch.md` — the accepted design; it is
   authoritative. Do not deviate without asking.
2. `docs/adr/0002-sync-fresh-worker-lifecycle.md` — sync stays the default.
3. `dispatch.ts` — current sync lifecycle, DispatchHooks, worktree snapshot.
4. `workstream.ts` — manifest RMW writes that need the serial write queue.
5. `dispatch-log.ts` / `dispatch-panel.ts` / `footer.ts` — UI surfaces.
6. `docs/extensions.md` in the pi package (`pi.sendMessage` deliverAs/
   triggerTurn semantics) — for the settle push.

## Units (implement and commit separately, in this order)
1. **Manifest write queue**: in-process serial queue + write-temp+rename in
   `workstream.ts` for all manifest writes. Pure refactor; existing tests
   must pass unchanged. Add a concurrent-writes test.
2. **Background task registry**: `background: true` param on dispatch_task;
   returns `{ taskId, status: "running" }` immediately; registry tracks
   in-flight tasks (id, role/profile, workdir, repo key, start time, promise).
   Cap 3 in-flight (settings `dispatchConcurrency` override); over-cap
   dispatches fail fast. Per-repo serialization: same-repo dispatches queue
   FIFO (repo key = canonical clone path via `git rev-parse --git-common-dir`).
   Worktree snapshot diff runs inside the per-repo queue slot.
3. **Settle push**: on background settle, inject the same settle summary the
   sync path returns via `pi.sendMessage({ deliverAs: "steer",
   triggerTurn: true })`, tagged with the taskId. All settle-time hooks
   (metrics, artifacts, worktrees, session dirs) fire exactly as in sync.
4. **dispatch_wait tool**: params `{ taskIds?: string[], mode: "any"|"all" }`
   (omitted taskIds = all in-flight); blocks and returns settled results in
   the sync result shape. Aborting the orchestrator turn does not kill
   background workers.
5. **UI**: footer shows in-flight background count; dispatch sidebar entries
   for background tasks show running state (existing spinner plumbing).
6. **Doctrine**: update the `orchestrating` skill — background sanctioned for
   research/review fan-out; implement units stay sequential unless the plan
   declares them independent. Update dispatch_task tool description.

## Constraints
- Sync path behavior byte-identical when `background` is absent.
- Workers get no new permissions; the write fence and role model are
  untouched.
- Timeout/abort per task carries over from the sync path.
- Keep pure logic in dependency-free helpers (`dispatch-helpers.ts` pattern)
  so `node --experimental-strip-types --test *.test.ts` covers it; dispatch.ts
  itself is not loadable by the test runner.

## Acceptance
- All existing tests pass; new units have tests (queue serialization,
  registry cap, per-repo FIFO, wait any/all, settle-push payload shape).
- `node --experimental-strip-types --check` clean on all touched files.
- ADR 0009 status updated to "implemented"; FUTURES entry updated.
