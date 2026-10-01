# Research: session-history taxonomy (task shapes, skills, models, cost fields)

Issue: [bearmoth/dotfiles#49](https://github.com/bearmoth/dotfiles/issues/49) (child of map issue #44)
Snapshot taken 2026-10-01. Every figure below is an aggregate. No prompt is quoted, and
work-context sessions appear only as counts.

## Verdict

- 129 sessions fall into 12 task types plus other. The top three are design-planning (23), quick-question (20) and feature-build (13). Classifier agreement is 47 of 52 on hand labels, an optimistic estimate.
- The model fires infrastructure skills on its own: worktree-provisioning, knowledge-routing and superpowers. Ceremony skills (wayfinder, grill-*, handoff, teach) are user-only by frontmatter, so Phil has to type them.
- Misses, meaning Phil invoked a skill right after a plain reply, are about zero (2). Non-use is the real problem: 27 of 38 Claude skills and 15 of 27 pi skills never ran, and 29 of those 42 are user-only.
- Model choice is manual and happens before the task: 17 of 18 `/model` commands ran at zero context. Mid-task switches are rare, and effort is `high` in about 90% of sessions, quick questions included.
- Model, tokens, effort and an estimated cost per request already exist in both harnesses. Claude's `cost-state` includes subagent and side-call spend, and wall-clock duration is unusable (§5).

## Method

**Parsed (read-only, scripts under `/tmp`):**

| Source | Unit | Count | Date range |
|---|---|---|---|
| Claude Code `~/.claude/projects/<dir>/<uuid>.jsonl` | user session | 54 | 2026-08-31 → 2026-09-30 |
| Claude Code `…/<uuid>/subagents/agent-*.jsonl` + `.meta.json` | dispatched subagent | 62 transcripts (61 `Agent` calls) | same |
| pi `~/.pi/agent/sessions/<dir>/*.jsonl` | user session | 75 | 2026-08-17 → 2026-09-23 |
| pi `~/.pi/agent/orchestrator-sessions/<role>-<id>/*.jsonl` | dispatched worker | 198 (134 implementor, 36 researcher, 29 reviewer) | 2026-08-27 → 2026-09-04 |
| pi `dispatch_task` tool calls inside user sessions | dispatch request | 291 | 2026-08-20 → 2026-09-04 |
| `~/.pi/agent/orchestrator-workstreams/*/manifest`, `orchestrator-reports/` | workstream metadata | 7 manifests, 2 reports | inspected only for shape |

**Context resolution.** For each session I took the `cwd` from the session itself: the first
entry with a `cwd` in Claude, or the `session` header in pi. I did not decode the dashed
directory name, because the dash encoding is lossy. Each distinct cwd was resolved once with
`eos-resolve --json context`. Results fell into three buckets, and unresolved sessions were not
folded into any context:

| | personal | easygo | unresolved | total |
|---|---|---|---|---|
| Claude sessions | 8 | 41 | 5 | 54 |
| pi sessions | 44 | 21 | 10 | 75 |
| pi workers | 4 | 194 | 0 | 198 |

I treated easygo and unresolved sessions as no-excerpt. A deterministic classifier labelled
them in-script and printed counts only, so I never read their prompt text, AI titles or
summaries. I read personal-session prompts (truncated) only to design the taxonomy and to
hand-label a validation set.

**Exclusions.** I excluded the controller session that launched this research, and its
subagent transcripts, so the research run doesn't inflate the research and orchestration counts.

**Deduplication.**
- Claude writes one entry per content block, so I deduplicated assistant entries on
  `message.id` before counting requests or summing tokens.
- I dropped `<synthetic>` and API-error entries (4).
- Skill-expansion messages (`isMeta: true`), tool results, compact summaries and
  local-command echoes were not counted as user prompts.
- In pi, the first `model_change` and `thinking_level_change` before the first assistant
  message count as the initial setting, not as a switch.

**Classifier.** The first real user prompt, plus a few structural signals, maps a session to
one type. The signals are: the first non-built-in skill invoked, the edit count, the dispatch
count, orchestrate mode, and which skills the model loaded.

I hand-labelled the 52 personal sessions. The classifier agrees on 47 of them (90%). Because
the rules were tuned on this same set, read 90% as an upper bound. Agreement on the work
sessions is unmeasured and probably lower.

## 1. Task-type taxonomy

The table counts first-prompt classification per session. Columns are personal / easygo /
unresolved.

| Type | Claude p/e/u | pi p/e/u | Total | Sessions with any skill | Median cost (est.) | Median requests |
|---|---|---|---|---|---|---|
| design-planning | 0 / 13 / 1 | 5 / 2 / 2 | **23** | 18 | $8.20 | 44 |
| quick-question | 0 / 10 / 1 | 4 / 4 / 1 | **20** | 3 | $1.16 | 13.5 |
| feature-build | 0 / 2 / 0 | 10 / 1 / 0 | **13** | 7 | $4.16 | 41 |
| debug | 1 / 1 / 0 | 6 / 2 / 0 | **10** | 4 | $2.13 | 21 |
| research-reading | 0 / 4 / 2 | 0 / 2 / 1 | **9** | 4 | $10.32 | 42 |
| orchestration | 0 / 0 / 0 | 2 / 6 / 1 | **9** | 9 | $15.40 | 80 |
| knowledge-capture | 5 / 0 / 0 | 2 / 0 / 1 | **8** | 5 | $4.54 | 29.5 |
| harness-test | 0 / 0 / 0 | 8 / 0 / 0 | **8** | 3 | $0.01 | 5.5 |
| small-edit | 0 / 3 / 0 | 3 / 1 / 0 | **7** | 2 | $0.91 | 18 |
| session-archaeology | 2 / 1 / 0 | 2 / 0 / 0 | **5** | 1 | $0.17 | 8 |
| review | 0 / 1 / 0 | 2 / 0 / 0 | **3** | 3 | $8.09 | 37 |
| ops-investigation | 0 / 2 / 0 | 0 / 0 / 0 | **2** | 2 | $10.33 | 42.5 |
| other / unclear | 0 / 4 / 1 | 0 / 3 / 4 | **12** | 0 | $0.11 | 3.5 |
| **Total** | 8 / 41 / 5 | 44 / 21 / 10 | **129** | | | |

All cost figures are estimates; see §5. Claude cost comes from `cost-state`, pi cost from
`usage.cost`, and the two are not comparable one-to-one.

Patterns in the data:
- Work happens mostly in Claude (41 of 54 sessions).
- Personal work in pi was mostly building the harness itself: modes, the orchestrator, and
  the UI. That work peaked in late August.
- Personal Claude use is dominated by vault and knowledge work run from the journal vault.
- The work-context design-planning count is driven by `/wayfinder` and `/grill-me` openers.
- Across all 936 user prompts (377 Claude, 559 pi), not just first prompts, quick questions
  are the most common classifiable shape (140). About 60% of all prompts are follow-ups
  ("yes", corrections, pasted output) that fall into other.

### Inclusion criteria (System One classification rules)

The rules below run in the same order as the validated classifier, and the first match wins.
A model following this order should reproduce the counts above.

0. **Skill opener.** If the session opens with a skill, the skill decides the type:
   grill, wayfinder or domain-model → design-planning; code-review → review;
   diagnose → debug; capture or despec → knowledge-capture; research → research-reading;
   setup → small-edit.
1. **feature-build (explicit).** The prompt opens with "implement", "build me/a" or
   "scaffold". New behaviour, usually from a spec, kickoff doc, ticket or numbered pass, and
   it will take several edits.
2. **harness-test.** A deliberate probe of the agent harness itself: a smoke test, a cheap
   dispatch test, a permission probe, or "can you respond".
3. **session-archaeology.** Phil wants a previous session found, recovered or identified,
   for example "which harness was I using here?" or "recover the closed window".
4. **ops-investigation.** A live-system investigation: alerts, incidents, production
   behaviour, on-call tooling.
5. **knowledge-capture.** Phil wants something written to, or organised in, a vault:
   meeting prep, a self-reflection, a note about a person or event, diary organisation, a
   worklog.
6. **debug.** Something that used to work, or should work, is broken, erroring or flaky, and
   the cause is unknown. Signals: an error is pasted, "used to work", "fails", "found an
   issue".
7. **review.** Phil wants judgement on an existing artefact: a PR, a diff, a spec, smoke-test
   output, or review comments. The output is findings, not changes.
8. **orchestration.** Orchestrate mode with five or more dispatches: a multi-step job
   delegated to workers.
9. **research-reading.** Phil wants understanding gathered from code, docs or the web: a deep
   dive, "how does X work", or reading a document. The output is an explanation or notes,
   not code.
10. **design-planning.** Phil wants to decide, plan, scope or stress-test something before
    building it. Signals: "think about", "plan", "design", "strategy", "restructure".
11. **quick-question.** A single factual or how-to question about tools, configuration or the
    harness. One answer, no edits expected.
12. **small-edit.** One bounded change or chore where the outcome is already clear: commit,
    run or apply a command, tweak a render, rename, bump.
13. **feature-build (implicit).** "Implement", "build" or "add a feature" appears later in the
    prompt.
14. **Structural fallback** (no keyword hit). Pick the type from what the session did:
    - debugging skill loaded → debug
    - grilling, brainstorming or domain-modeling loaded → design-planning
    - research loaded → research-reading
    - 5 or more edits → feature-build
    - knowledge-routing loaded plus an edit → knowledge-capture
15. **other/unclear.** Nothing matches, the prompt is empty, or the opener is a bare
    follow-up. The router should ask, or keep the session's current model.

## 2. Skill table

Definitions:
- **Model-fired** means a Claude `Skill` tool call, or a pi assistant `read` of a `SKILL.md`.
  Model-fired calls split three ways: *chained* (another skill was already loaded in the same
  user turn), *named* (the user prompt named the skill or said "skill"), and *autonomous*
  (neither).
- **User-invoked** means a Claude `<command-name>` entry that isn't a built-in, or a pi
  `<skill name=…>` expansion in user text.
- Counts are calls, followed by the number of distinct sessions.

The "Model-invocable?" column shows "no" where `disable-model-invocation: true` is set in the
skill's frontmatter. Those skills can only be started by hand.

| Skill | Harness | Model-invocable? | User-invoked | Model: autonomous | Model: chained | Model: named | Note |
|---|---|---|---|---|---|---|---|
| wayfinder | Claude | no | 9 / 9 | 0 | 0 | 0 | typed by hand |
| grill-me | Claude / pi | no | 4 / 4, 2 / 2 | 0 | 0 | 0 | wrapper that chains into grilling |
| grill-with-docs | pi | no | 3 / 3 | 0 | 0 | 0 | always at session start |
| grilling | Claude | yes | 0 | 2 | 12 | 0 | 12 of 14 chained from a user slash |
| grilling | pi | yes | 0 | 1 | 3 | 1 | |
| domain-modeling | Claude / pi | yes | 0 | 0 / 2 | 9 / 2 | 0 | chained from grilling or wayfinder |
| worktree-provisioning | Claude / pi | yes | 0 | 7 / 0 | 0 | 0 / 1 | clean autonomous firing |
| knowledge-routing | Claude | yes | 0 | 4 | 1 | 1 | personal vault sessions |
| superpowers:systematic-debugging | Claude | yes | 0 | 3 | 0 | 0 | |
| superpowers:writing-plans / subagent-driven-dev / receiving-code-review | Claude | yes | 0 | 2 each | 0 | 0 | |
| superpowers:test-driven-development | Claude | yes | 0 | 1 | 1 | 0 | |
| superpowers:brainstorming | Claude | yes | 0 | 1 | 0 | 0 | |
| research | Claude | yes | 0 | 1 (+1 in a subagent) | 1 | 0 | |
| claude-in-chrome | Claude | yes | 0 | 2 | 0 | 0 | |
| obsidian:defuddle | Claude | yes | 0 | 0 | 1 | 0 | |
| code-review | Claude | yes | 1 / 1 | 0 | 0 | 0 | 23 further reads by pi reviewer workers |
| handoff, teach, setup-matt-pocock-skills | Claude | no | 1 each | 0 | 0 | 0 | |
| orchestrating | pi | yes | 0 | 17 | 2 | 4 | **mode-forced**: orchestrate mode tells the model to follow it |
| tdd | pi | yes | 0 | 3 | 0 | 0 | 93 further reads by workers (`implementor:tdd` profile) |
| diagnosing-bugs | pi | yes | 1 / 1 | 1 | 0 | 0 | |
| codebase-design, writing-for-agents | pi | yes | 0 | 1 each | 0 | 0 | worker reads: 14 codebase-design |

Pi workers also read resolving-merge-conflicts (4) and research (10). Those reads come from
dispatch profiles, not from Phil or the parent model.

**Never used** in the window:
- **pi** (15 of 27):
  - user-only (12): ask-matt, handoff, implement, improve-codebase-architecture,
    setup-matt-pocock-skills, teach, to-questionnaire, to-spec, to-tickets, triage,
    wait-what, wayfinder
  - model-invocable (3): prototype, setup-pre-commit, wizard
- **Claude user skills** (27 of the 38 in `~/.claude/skills/`):
  - user-only (17): claude-handoff, edit-article, grill-with-docs, implement,
    improve-codebase-architecture, loop-me, roast-me, to-questionnaire, to-spec, to-tickets,
    triage, ubiquitous-language, wizard, writing-beats, writing-fragments,
    writing-great-skills, writing-shape
  - model-invocable (10): codebase-design, design-an-interface, diagnosing-bugs, gh-stack,
    git-guardrails-claude-code, prototype, registry-maintenance, request-refactor-plan,
    scaffold-exercises, tdd. `diagnosing-bugs` and `tdd` did fire in pi but never in Claude,
    where the superpowers equivalents won.
- **Claude commands:** `/capture`, `/despec`, `/eos-issue`. All three have zero invocations.
- **Plugin skills:** most never fired. That includes the obsidian skills other than
  defuddle, and every superpowers skill not listed in the table above.

**The miss signal.** I counted a miss when the user's next message invokes a non-built-in
skill and the assistant turn just before it contained no skill call.
- **Claude:** 2 misses, `/handoff` and `/wayfinder`, both in work-context sessions.
- **pi:** 0. All 6 user skill invocations happened before the first assistant reply.
- **Plain-text "use the X skill" requests after a reply:** none. The 9 mid-session pi
  mentions of "skill" were talk *about* skills, not requests to use one.

There is one anecdotal cross-harness miss, in a personal session. A terminal-overlay
regression was first taken to pi with a user-invoked diagnosing-bugs skill. Nine days later
it was retried in Claude, where systematic-debugging fired by itself.

Reading: skills rarely fail to fire when needed. They are never reached for at all. 29 of
the 42 never-used skills are user-only, so each one depends on Phil remembering it exists.
The 13 model-invocable ones never matched a task. Their descriptions either missed or lost
to an overlapping skill (diagnosing-bugs vs systematic-debugging, tdd vs
test-driven-development).

## 3. Model and effort distribution

### Claude Code (54 sessions, 2,168 deduplicated requests)

- **Main-session models, by request:** claude-fable-5-1 1,657 (76%), claude-opus-5 229,
  claude-sonnet-5 164, claude-opus-5-5 83, claude-fable-5 35.
- **Main-session models, by session:** fable-5-1 35, opus-5 7, sonnet-5 6, opus-5-5 2,
  fable-5 1, mixed 1, none 2.
- **Effort, by session:** `high` 42, `xhigh` 8, `medium` 2, none 2. By request: high 1,680,
  xhigh 405, medium 83. `perTurnEffort` is null on 772 requests, meaning the session default
  applied.
- **Advisor.** An `advisorModel` was present in 16 sessions: opus-5 in 11 and opus-5-5 in 5.
- **`/model`.** 18 invocations across 17 sessions (31%). 17 ran at zero context, so they
  picked the model before the task started. 1 ran mid-session at about 98k context tokens.
  Targets: sonnet 6, opus 5, fable 3, picker without an argument 4.
- **Other mid-session changes.** Only 1 session used more than one main model. `/effort`
  ran twice.
- **Compactions:** 9, all manual. Pre-compaction context ranged from about 195k to about
  465k tokens.
- **Permission mode:** auto in 42 sessions.
- **Subagent dispatches: 61.** The resolved model comes from each subagent's own transcript:

| Requested (`subagent_type`, `model`) | Count | Resolved model |
|---|---|---|
| general-purpose, sonnet | 31 | claude-sonnet-5 |
| general-purpose, unset | 13 | claude-fable-5-1 (inherits) |
| Explore, unset | 9 | opus-5 4, sonnet-5 3, opus-5-5 2 |
| general-purpose, haiku | 4 | claude-haiku-4-5 |
| general-purpose, opus | 4 | claude-opus-5 |

Subagent effort was `high` on 51 subagent requests and `xhigh` on 5.

### pi (75 sessions, 2,994 requests; every request went through the `github-copilot` provider)

- **Initial model per session:** claude-fable-5 54, claude-sonnet-5 10, gpt-5.6-luna 4,
  gpt-6-astra 2, claude-fable-5.1 2, and 1 each of haiku-4.5, opus-5 and gpt-5.4.
- **Initial thinking level:** `high` 73, `max` 1, `medium` 1.
- **Requests by model:** claude-fable-5 2,425 (81%), opus-5 197, gpt-6-astra 121,
  gpt-5.6-luna 120, sonnet-5 90.
- **Mid-session model switches:** 8 across 7 sessions.
  - 4 happened at under 5k tokens: switching to a cheap model for dispatch tests.
  - The rest happened at about 59k, 67k, 123k and 516k tokens. The 516k switch was to
    fable, late in a long session.
- **Mid-session thinking changes:** 10 across 4 sessions. One session accounts for 6 of
  them, stepping through minimal → low → medium → high → xhigh → high at the same context.
  That looks like keyboard cycling rather than six decisions. Real effort changes are
  therefore about 4.
- **Modes, by sessions entered:** orchestrate 22, explore 20, yolo 20, edit 19.
- **Compactions:** 8.
- **Dispatches.** There were 291 `dispatch_task` calls. 249 left `model` unset and used the
  profile default. Where a model was requested, it was gpt-5.6-luna (34), plus 8 one-off
  requests: fable-5 (2), two haiku spellings, a "cheap" alias, a mistyped luna alias,
  gpt-4o-mini and opus-4.8. The aliases suggest Phil was guessing at model names. Profiles: `implementor:tdd` 77,
  `reviewer:standards` 21, `planner` 16, `reviewer:security` 8, `implementor:diagnose` 3,
  `plan-critique` 3, unset 162.
- **Resolved worker model and thinking level** (198 worker sessions):
  - implementor: gpt-5.6-luna at max 114, gpt-5.6-luna at low 18
  - researcher: gpt-5.6-luna at max 28, opus-5 at xhigh 7
  - reviewer: claude-fable-5 at xhigh 28

  In practice that is "strong planner/reviewer, cheap implementor". 194 of the 198 workers
  ran in work context.

### Dominant model and effort by task type

For each session, the most-used main model and the main effort setting are counted against
its classified task type. "c" is Claude and "p" is pi.

| Type | Models (sessions) | Effort / thinking (sessions) |
|---|---|---|
| design-planning | c:fable 13, c:opus 1, p:fable 9 | high 23 |
| quick-question | c:fable 8, c:sonnet 2, c:opus 1, p:fable 8, p:gpt 1 | high 17, medium 2, xhigh 1 |
| feature-build | c:fable 1, p:fable 11, unknown 1 | high 12 |
| debug | c:fable 1, c:opus 1, p:fable 6, p:opus 1, p:astra 1 | high 9, xhigh 1 |
| research-reading | c:fable 5, c:opus 1, p:fable 3 | high 7, xhigh 2 |
| orchestration | p:fable 8, p:luna 1 | high 8, max 1 |
| knowledge-capture | c:fable 3, c:opus 2, p:fable 2, p:astra 1 | high 6, medium 1, xhigh 1 |
| harness-test | p:sonnet 4, p:luna 3, p:fable 1 | high 8 |
| small-edit | c:opus 1, c:fable 1, c:sonnet 1, p:sonnet 3, p:fable 1 | high 6, xhigh 1 |
| session-archaeology | c:sonnet 2, c:fable 1, p:fable 1, p:sonnet 1 | high 4, xhigh 1 |

Reading: only harness tests and some small edits were routed down to a cheaper model by
hand. Quick questions ran on the flagship model at `high` in 16 of 20 sessions. That is the
clearest saving available to a router.

## 4. Skill gap list

These are recurring shapes with 3 or more occurrences that no skill or command covers in
practice.

| Shape (count) | What exists | Gap |
|---|---|---|
| **Pre-task model/effort choice** (17 `/model` commands at zero context, plus 4 cheap-model switches in pi) | none | The System One router's core job. Today it is a manual `/model` step before the first prompt. |
| **Quick question** (20 sessions, 140 prompts across all sessions) | none, and none needed | A routing gap rather than a skill gap. 16 of 20 ran on fable at `high`, with a median of about 13 requests. They are cheap-model candidates. |
| **Harness smoke test / probe** (8) | none | A `/smoke`-style command: a fixed cheap dispatch, a permission probe, and a report. |
| **Session archaeology** (5, across both harnesses) | none | A "find or recover a past session across Claude and pi" skill. Today it is ad hoc grep. |
| **Feature build from a spec or numbered pass** (13; 10 were personal pi sessions on harness passes) | `implement`, `to-spec` and `to-tickets` are installed in both harnesses but are user-only and have never been used | A recall gap: the model *cannot* reach these skills. Either make the router offer them as Choices for feature-build (it can suggest a slash command), or retire them. |
| **Debug** (10) | diagnosing-bugs, superpowers:systematic-debugging | Coverage gap. A skill was present in only 4 of 10 debug sessions. Two overlapping skills compete in Claude. |
| **Knowledge capture: meeting prep, self-reflection, notes about people** (8) | knowledge-routing (routing only), `/capture` (0 uses) | No skill gathers inputs and drafts the note. Routing fires, but the "prep" half is improvised every time. |

## 5. Baseline fields

| Field | Claude Code | pi | Reliability |
|---|---|---|---|
| Model per request | `message.model` on assistant entries | `message.model` + `provider` | Good. Claude needs dedup by `message.id`. |
| Effort / thinking | `effort`, `perTurnEffort` per request | `thinking_level_change` entries | Good. Pi needs the before/after-first-reply rule. |
| Tokens per request | `message.usage`: input, cache_read, cache_creation (with a 5m/1h split), output, `output_tokens_details.thinking_tokens` | `usage`: input, output, cacheRead, cacheWrite, reasoning | Good after dedup. Pi via Copilot reports large uncached `input` (30.5M vs 205M cacheRead), so cache accounting may be partial on that provider. |
| Cost USD | `cost-state` entries: `totalCostUSD` and `modelUsage[model].costUSD` (cumulative snapshot; use the last one per session) | `usage.cost.total` per request | **Estimates.** Claude: present in 52 of 54 sessions. It is cumulative and never decreased across 35 multi-entry sessions, so the last value per session is safe. It **includes subagent spend and side calls** the transcript doesn't show (advisor, title and classifier calls): in 14 sessions with subagents, its output tokens were 1.2 to 4.4× main plus subagent transcript tokens. Pi: computed from a list-price table, but Copilot bills per premium request, so the USD figure is notional. |
| Duration | `cost-state.totalDuration` (wall clock), `totalAPIDuration`, `totalToolDuration`; `system/turn_duration` per turn | timestamps only | Wall clock is unreliable: sessions stay open or are resumed for days (Claude max about 356h, pi about 103h). Use API duration (Claude), or the sum of turn durations or active time from timestamp gaps. |
| Subagent / worker cost | subagent transcripts with their own `usage`; `.meta.json` with requested `model` and `agentType` | worker session files with their own `usage` | Good, but they must be joined to the parent manually: the Claude parent directory, and pi `dispatch_task` → worker by time and role. |
| Lines changed | `cost-state.totalLinesAdded/Removed` | — | Claude only. |
| Context | cwd → `eos-resolve` | cwd → `eos-resolve` | Good, with an unresolved bucket (15 of 129 sessions). |

Window totals:
- **Claude:** about $646 by `cost-state` (estimate, subagents and side calls included). Main-session tokens: 265M cache-read,
  13M cache-write, 2.8M output. Subagent tokens: 89M cache-read, 0.1M output.
- **pi user sessions:** about $666 notional (personal $258, work $396, unresolved $13).
- **pi workers:** about $103 notional.

**Proposed per-session record.** One JSONL line per session, written at session end or
compiled by a nightly sweep:

```json
{
  "harness": "claude|pi",
  "session_id": "…",
  "parent_session_id": null,
  "role": "user|subagent|worker:implementor|…",
  "context": "personal|easygo|unresolved",
  "started_at": "ISO8601", "ended_at": "ISO8601",
  "active_minutes": 0, "api_seconds": 0,
  "task_type": "design-planning|…|other",
  "task_type_source": "router|classifier|hand",
  "router_choice": {"model": "…", "effort": "…", "skill": "…"},
  "models": {"<model>": {"requests": 0, "input": 0, "cache_read": 0, "cache_write": 0,
                          "output": 0, "thinking": 0, "cost_usd_est": 0.0}},
  "initial_model": "…", "initial_effort": "…",
  "switches": [{"kind": "model|effort", "to": "…", "ctx_tokens": 0, "turn": 0}],
  "skills": [{"name": "…", "by": "user|model-autonomous|model-chained|mode-forced|profile"}],
  "dispatches": [{"requested_model": null, "resolved_model": "…", "effort": "…",
                  "profile": "…", "child_session_id": "…"}],
  "compactions": [{"trigger": "manual|auto", "pre_tokens": 0}],
  "cost_usd_est": 0.0, "cost_basis": "claude-cost-state|pi-list-price|copilot-premium-requests",
  "user_prompts": 0, "edits": 0, "lines_added": 0, "lines_removed": 0
}
```

The parent's `cost_usd_est` from Claude `cost-state` already includes its subagents. Rows with
`role: subagent` should carry tokens only, or be flagged `included_in_parent: true`, so
totals don't double-count. Pi parents do not include worker cost, so worker rows should be
summed separately.

The record holds no prompt text, so work-context rows can sit in a personal baseline without
exposure. `task_type` should come from the router once it exists. Until then it comes from
the classifier, and `task_type_source` records which.

## 6. Caveats

- **Retention window, not a sample.** `cleanupPeriodDays` is unset in
  `~/.claude/settings.json`, so Claude Code's default pruning of about 30 days applies. The
  Claude data is exactly the last 30 days (08-31 → 09-30), and older use is gone. The pi data
  (08-17 → 09-23) has no pruning, but pi was in use mainly during August.
- **The two harnesses cover different months and different work.** Pi is dominated by
  building the harness itself. Comparing harnesses mostly compares eras.
- **Small n.** 129 sessions in total, with only 8 personal Claude sessions. Per-type medians
  rest on 2 to 23 sessions.
- **Classifier error.** Agreement of 90% on the dev set is an optimistic bound. Work sessions
  were classified blind, and first-prompt typing ignores sessions that change shape midway.
  Several design sessions became builds, and one review became an orchestration.
- **The miss signal is narrow.** It catches only explicit invocations. It can't show skills
  Phil *would* have wanted, or work done well enough without a skill.
- **Not visible in transcripts:** what Phil billed or paid (subscription vs. Copilot premium
  requests), time actually at the keyboard, sessions in other tools, the reason behind a
  `/model` choice, and pruned Claude history before 08-31. Pi dispatches before 08-27 have no
  worker files.
- **Unresolved bucket.** 15 sessions have home, tmp or parent-directory cwds and are reported
  separately rather than guessed. Some are probably work sessions.

## Sources

- Claude Code transcript format: entry types and fields (`type`, `message.usage`, `effort`,
  `perTurnEffort`, `cost-state`, `system/compact_boundary`, `system/local_command`,
  `<command-name>`, `isMeta`, `subagents/*.meta.json`) were inspected directly in
  `~/.claude/projects/*/*.jsonl` (CLI versions 2.1.27x–2.1.285).
- pi session format v3: `session`, `model_change`, `thinking_level_change`, `message` (roles
  user, assistant, toolResult), `custom` `mode-state`, `custom_message` mode contexts,
  `compaction`, and the `dispatch_task` tool-call arguments. Inspected directly in
  `~/.pi/agent/sessions/` and `~/.pi/agent/orchestrator-sessions/`.
- `eos-resolve --json context <cwd>` (the engineering-OS resolver) for context resolution.
- Installed skill inventories: `~/.claude/skills/`, `~/.claude/commands/` and
  `~/.pi/agent/skills/`.
