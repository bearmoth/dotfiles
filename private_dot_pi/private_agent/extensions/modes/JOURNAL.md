# Modes extension — rolling journal

Operational log for issues, surprises, and improvement ideas observed while
using this extension. Newest entries first. Rollout points = git history of
this directory in the chezmoi repo (`git log -- private_dot_pi/private_agent/extensions/modes/`).

Entry format:

```
## YYYY-MM-DD — short title
What happened / what was observed. What (if anything) was changed.
```

---

## 2026-02 (2026-08-20 local) — Orchestrate mode v1 shipped
Implemented per ORCHESTRATE-SPEC.md: orchestrate mode, `dispatch_task`,
`--op-mode` process-locked worker modes, reviewer gh pairs, gerund footer,
orchestrating skill. Live-tested end-to-end (implementor dispatch created a
file, result shape correct; explore/orchestrate mutation blocking verified;
dispatch_task absent outside orchestrate). Known gaps:

- Gerund footer not visually verified in an interactive TUI session yet.
- `~/.pi/agent/orchestrator-sessions/` grows unbounded; no cleanup policy.
- Worker session files are found by globbing the pinned `--session-dir` for
  a single `.jsonl`; would break if pi ever writes extra files there.
