# Auto verify+review, manual re-implementation gate

After an implementor finishes, the orchestrator's read-only verification
and a reviewer dispatch happen **automatically** (cheap, read-only, always
valuable). But dispatching a *corrective implementor* requires user
approval: the orchestrator proposes the rework brief and waits.

Why: auto-re-implementation is where loops burn money and can thrash
(implementor and reviewer disagreeing indefinitely with no human arbiter),
and v1 has no loop-limit machinery. One human checkpoint per mutation
cycle is the pragmatic cut.

**v1 pragmatism**: "auto-loop with max-iterations N" is recorded in
FUTURES.md for the async pass. Same reasoning caps workers at edit mode,
with yolo dispatches requiring per-dispatch confirmation until sandboxing.
