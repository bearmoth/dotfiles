# Sync dispatch with fresh workers per task

Each dispatch is a blocking `pi -p` subprocess; workers cannot stay alive
awaiting feedback. Rework therefore means a **new** worker whose brief
includes the previous findings — no persistent worker state.

**v1 pragmatism, not a long-term position**: async orchestration (task ids,
status polling, parallel workers, interactive workers via herdr) is the
known long-term shape, but it brings its own UX design pass and would have
gated Orchestrate on the still-undesigned subagent-dispatch work. Fresh
workers are also more reproducible: everything the worker knows is in the
brief.

Revisit trigger: the async dispatch design pass — now designed, see
[ADR 0009](./0009-async-background-dispatch.md). Sync remains the default
lifecycle; background dispatch is opt-in.
