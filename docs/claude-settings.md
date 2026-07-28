# Claude Code settings — decisions

`~/.claude/settings.json` is **strict JSON** — no comments, no trailing
commas; one violation and Claude Code silently rejects the entire file
(every setting, every hook goes dark). This sidecar is where the
annotations live instead. Validate after every edit:

```sh
python3 -m json.tool dot_claude/settings.json
```

## Provenance

The candidate list came from Matt Pocock's config (preserved verbatim at
`git show 46f5564^:dot_claude/settings.json`). Each item was auditioned
against Phil's actual usage on 2026-07-28, not adopted wholesale.

## Adopted

| Setting | Why |
|---|---|
| `permissions.deny: AskUserQuestion` | The Q&A widget overlaps terminal output, making it unreadable; Phil's standing preference is plain questions in replies. Bare-name deny removes the tool from context entirely. |
| `permissions.deny: EnterPlanMode, ExitPlanMode` | Plan mode unused; Phil moving off `opusplan`. Gotcha: with ExitPlanMode denied, manually toggling plan mode (shift+tab) has no approval flow — don't. |
| `disableWorkflows: true` | Never used; explicit-opt-in multi-agent orchestration whose tool schema cost ~3K tokens/session dormant. Flip the boolean to restore. |
| `disableArtifact: true` | Never used; ~1.5–2K tokens/session dormant. Flip to restore. |

## Auditioned and rejected

| Candidate | Why not |
|---|---|
| `disableClaudeAiConnectors` | The Engagement PKB ingest machinery (weekly-ingest/triage) runs on claude.ai connectors (Slack, Atlassian, PagerDuty, Calendar); `true` in any scope wins globally, so it can't be re-enabled per-project. Slim instead by disconnecting unused connectors on claude.ai. Correct spelling matters: `disableClaudeConnectors` is silently ignored. |
| `disableBundledSkills` | ~1–1.2K tokens/session for the whole tier, with real automatic-trigger benefit (claude-api, dataviz, update-config). Cheapest thing in context; deny individual skills if one ever misbehaves. |
| deny `SendMessage` | How a session continues a background agent it spawned. |
| deny `ScheduleWakeup`, `CronCreate/Delete/List` | Machinery behind /loop and /schedule — possible future use. |
| deny `ReportFindings` | Renders /code-review findings as typed UI; impact of losing it unexplored. |
| deny `PushNotification`, `RemoteTrigger`, `DesignSync`, `NotebookEdit` | Deferred tools costing ~a line each — denying is tidying for its own sake. |

## Context-weight audit (2026-07-28)

Per-session injected weight, measured/estimated:

- Agent roster (`~/.claude/agents`, 125 vendored example agents): **~7.3K
  tokens** → deleted (recoverable: `git show c463198 -- dot_claude/agents`).
  Deployed copies need one manual `rm -rf ~/.claude/agents` per machine —
  chezmoi does not remove orphaned targets. Check for unmanaged extras first.
- Datadog MCP ×3 (global in `~/.claude.json`): ~5–7K tokens, paid by
  personal-context sessions too. Left alone; context-scoped tool loading is
  fog on the wayfinder map (engineering-OS concern, not a settings hack).
- claude.ai connectors: ~2–3K; prune unused connectors account-side.
- Workflow + Artifact schemas: ~4–5K → the two disable flags above.
- Bundled skills: ~1–1.2K → kept.
