# Orchestrator reads everything, writes nothing, delegates all mutation

Orchestrate mode uses Explore's read-only enforcement plus exactly one new
capability: `dispatch_task`. It gains no write access anywhere — not even
for plan artifacts (the first implementor brief writes those) or worktree
setup (a dispatched implementor does it). The user retains manual mutation
via the `!` bash prefix.

Why: the mutation monopoly stays with workers, whose scope is fixed by
role; the orchestrator's value is independent read-only verification of
worker output, which only works if it *cannot* have made the changes
itself. Cross-repo reads were already unrestricted, so "reads everything"
costs nothing new.

Consequence worth noting: this session *can* cause writes remotely while
being locally read-only — hence the distinct footer color rather than
reusing Explore's.
