# Measuring per-session spend: Claude Code (Max) and pi (GitHub Copilot)

Research for [bearmoth/dotfiles#50](https://github.com/bearmoth/dotfiles/issues/50) (child of map [#44](https://github.com/bearmoth/dotfiles/issues/44)).
Verified against official docs at `https://code.claude.com/docs` and `https://docs.github.com` on **2026-10-01**.

## Verdict

Both harnesses can produce one arithmetic-grade record per session, but **neither harness's own dollar figure is the billing truth** — both are client-computed, list-price *estimates*. The real ledger for each is a native, non-dollar unit:

- **Claude Code (Max subscription):** the real unit is `rate_limits.five_hour`/`seven_day` **`used_percentage`** (account-wide, shared across devices/sessions, resets at `resets_at`). `cost.total_cost_usd` is explicitly documented as not billing-relevant on Max — track it only as a comparable, attributable estimate.
- **pi on GitHub Copilot:** GitHub moved from premium-request multipliers to **token-priced AI Credits** (1 credit = $0.01) on 2026-06-01; the multiplier table now applies only to legacy annual Pro/Pro+ holdouts. pi's own model registry pulls live token rates from `api.individual.githubcopilot.com` — i.e. pi is unambiguously wired to the **current, non-legacy** regime already. `gh api` *does* have per-user endpoints for this (`/users/{username}/settings/billing/ai_credit/usage` and `.../premium_request/usage`, confirmed working), but both returned empty for the `bearmoth` account this month — so **which GitHub account/org actually carries Phil's Copilot billing is the #1 open question**, not whether the API exists.
- Both harnesses already log token/cost per model per turn locally, so a JSONL "per-session record" is mechanically straightforward; the hard part is bridging Claude Code's Stop hook (no cost/rate-limit fields) to its statusline (which has them), and pinning down pi's/Copilot's live billing regime before trusting any dollar rollup.

## Claude Code recipe

**Fields (statusline input JSON only — Stop hook does NOT receive these):**
Source: `https://code.claude.com/docs/en/statusline` (fetched 2026-10-01).

| Field | Notes |
|---|---|
| `model.id`, `model.display_name` | current model |
| `cost.total_cost_usd` | "Estimated session cost in USD, computed client-side at list price... May differ from your actual bill." Resets on `/clear` |
| `cost.total_duration_ms`, `cost.total_api_duration_ms` | wall-clock vs API-wait time |
| `cost.total_lines_added`/`removed` | |
| `context_window.total_input_tokens`/`total_output_tokens`, `.context_window_size`, `.used_percentage`, `.remaining_percentage`, `.current_usage.{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}` | live context window, not cumulative session usage |
| `effort.level` | reasoning effort; absent when model doesn't support it |
| `rate_limits.five_hour.used_percentage`/`.resets_at`, `.seven_day.*`, `.spend_limit.*` | **Pro/Max-only**, account-wide, appears only after first API response, each window independently absent, dropped once `resets_at` passes |
| `prompt_cache.{warm,hit_ratio,requests,misses,...}` | main-conversation cache stats, v2.1.251+ |
| `session_id`, `session_name`, `prompt_id`, `transcript_path`, `version`, `workspace.repo.{host,owner,name}`, `worktree.*`, `pr.*` | identity/task-attribution fields |

Refresh cadence: on session start/resume, after each new assistant message, after `/compact`, on permission-mode/vim-mode change, on a `refreshInterval` timer, when a `rate_limits` window's `resets_at` passes, or when `prompt_cache.expires_at` passes. Debounced 300ms; in-flight script runs are cancelled by a new trigger. The currently-deployed script (`/Users/phil/.local/share/chezmoi/dot_claude/statusline-command.sh`) already reads `cost.total_cost_usd`, `cost.total_duration_ms`, `context_window.used_percentage`, and both `rate_limits.*` windows via `// empty` fallbacks.

**Is cost real or estimated?** Per `https://code.claude.com/docs/en/costs` (fetched 2026-10-01): *"Claude Code computes the dollar figure locally from token counts at list price... The figure is an estimate... Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes."* Same applies to the statusline's `cost.*` and to OTel's `claude_code.cost.usage` metric — all three are the same list-price computation, not an invoice.

**`/cost`:** UNVERIFIED. The costs page documents `/usage` (Session block: tokens, estimated cost, cache-hit stats, plan-usage breakdown with skill/subagent/MCP attribution) and `/insights`; no `/cost` command appears on that page. Possibly renamed/folded into `/usage`, or version-dependent — don't build on it without confirming in a live session.

**Transcript usage fields** (read from `~/.claude/projects/*/*.jsonl`, field names only, per rule):
- Per-turn: `message.usage.{input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens, output_tokens_details.thinking_tokens, server_tool_use.{web_search_requests,web_fetch_requests}, service_tier, cache_creation.{ephemeral_1h_input_tokens,ephemeral_5m_input_tokens}, inference_geo, iterations[], speed}`, plus `message.model`.
- A separate, **undocumented** entry type, `"cost-state"`, appears to be Claude Code's own running rollup for the session (likely what feeds `/usage` and the statusline): `{type:"cost-state", sessionId, totalCostUSD, totalAPIDuration, totalAPIDurationWithoutRetries, totalToolDuration, totalLinesAdded, totalLinesRemoved, totalDuration, startTime, modelUsage:{<model-id>:{inputTokens,outputTokens,thinkingTokens,cacheReadInputTokens,cacheCreationInputTokens,webSearchRequests,costUSD}}, hasUnknownModelCost}`. This is the single richest local artifact per session — already aggregated per model — but it is not a documented/stable schema, so treat it as a convenience shortcut, not a contract.
- Caveat: consecutive `assistant` entries were observed carrying identical-looking `usage` blocks in one transcript sample. Dedupe by the message's own id/request-id field before summing per-turn usage; don't just sum every `usage` block seen.

**OpenTelemetry** (`https://code.claude.com/docs/en/monitoring-usage`, fetched 2026-10-01): disabled by default, enable with `CLAUDE_CODE_ENABLE_TELEMETRY=1` (+ `OTEL_METRICS_EXPORTER`/`OTEL_LOGS_EXPORTER`). Metrics: `claude_code.session.count`, `claude_code.cost.usage` (USD — same list-price estimate), `claude_code.token.usage` (attributes `type`: input/output/cacheRead/cacheCreation, `model`, `query_source`: main/subagent/auxiliary), `claude_code.lines_of_code.count`, `claude_code.commit.count`, `claude_code.pull_request.count`, `claude_code.active_time.total`. Events include `claude_code.api_request`, `claude_code.user_prompt`, `claude_code.assistant_response`. Standard attributes: `session.id`, `user.id`, `user.email`, `organization.id`, `model`, `prompt.id`. UNVERIFIED (summarized secondhand, not quoted verbatim from the page): whether a personal Max subscriber can enable this purely by setting `CLAUDE_CODE_ENABLE_TELEMETRY=1` themselves, versus needing org-managed settings — confirm directly against `/en/monitoring-usage` before relying on it. If it does work standalone, it's a viable parallel path to the hook/tee bridge below, at the cost of running a collector (or `OTEL_METRICS_EXPORTER=console`).

**Stop hook** (`https://code.claude.com/docs/en/hooks`, fetched 2026-10-01): common fields across all hooks — `session_id`, `prompt_id`, `transcript_path`, `cwd`, `scratchpad_dir`, `permission_mode`, `effort`, `hook_event_name` — plus Stop-specific `last_assistant_message`. **It carries no `cost.*` or `rate_limits.*`** — those only reach the statusline process. Stop fires after every assistant turn (good for upsert-style capture that survives a kill); `SessionEnd` fires once at clean exit but would miss a killed session.

**Recipe — one record per session, with task attribution:**
1. A `Stop` hook already gets `transcript_path`, so per-model tokens and the `list_usd_estimate` can be read straight from that session's last `cost-state` entry — **no bridge needed for those**. The only field the Stop hook genuinely lacks is `rate_limits.*` (and `effort`/`context_window` snapshot), which only reaches the statusline process. So the *minimal* bridge is: the statusline script tees just its `rate_limits` object (plus timestamp) to `~/.local/state/cc-usage/<session_id>.json` on each invocation — a small, additive change to its existing logic, proposed here but not made (the live script under `dot_claude/` was not modified for this research).
2. The `Stop` hook reads that small rate-limit snapshot, plus the transcript's latest `cost-state` entry, plus its own hook input (`session_id`, `cwd`→`workspace.repo`, `last_assistant_message` for a one-line task description), and **upserts** (keyed by `session_id`) one row into `~/.local/state/harness-cost/claude-code.jsonl`.
3. Baseline arithmetic: sum `list_usd_estimate` per session for an attributable (but non-billing) total; separately track `rate_limits.five_hour/seven_day.used_percentage` deltas (start snapshot vs. end snapshot) as the actual go/no-go measure, flagging whenever a `resets_at` boundary was crossed mid-session or other concurrent Claude Code/claude.ai activity could have contributed to the delta. Caveat: `rate_limits` only appears *after* the first API response, so a session's first "start" snapshot already reflects turn 1's cost — either seed `start` from the **previous** session's final snapshot, or accept that the delta slightly undercounts the first turn.

## pi / Copilot recipe

**Per-turn usage fields pi exposes** (from `~/.pi/agent/sessions/**/*.jsonl`, field names only, per rule): each assistant `message` carries `api`, `provider` (e.g. `"github-copilot"`), `model` (e.g. `"claude-fable-5"`), and `usage: {input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost: {input, output, cacheRead, cacheWrite, total}}`, plus `stopReason`, `responseId`, `timestamp`. A failed/timed-out turn logs an all-zero `usage` block with `stopReason: "error"`.

**Models visible in pi's github-copilot provider** (`~/.pi/agent/models-store.json`, keyed by provider, field names and values are pi's own cached copy of GitHub's rate card, `checkedAt`/`lastModified` epoch-ms timestamps on the file): 32 models as of the last refresh, each with `{id, name, api, provider, baseUrl: "https://api.individual.githubcopilot.com", cost:{input, output, cacheRead, cacheWrite}, contextWindow, maxTokens}` — the `cost` block is $/M tokens, not a multiplier, and `baseUrl` contains `individual`, confirming these are pulled from the **current, non-legacy, usage-based** per-token API, not the legacy multiplier regime:

| Model id | Input $/M | Output $/M | CacheRead $/M | CacheWrite $/M | Context |
|---|---|---|---|---|---|
| claude-fable-5 | 10 | 50 | 1 | 12.5 | 1M |
| claude-fable-5.1 | 10 | 50 | 0.25 | 12.5 | 1M |
| claude-haiku-4.5 | 1 | 5 | 0.1 | 1.25 | 200K |
| claude-opus-4.7 | 5 | 25 | 0.5 | 6.25 | 1M |
| claude-opus-4.8 | 5 | 25 | 0.5 | 6.25 | 1M |
| claude-opus-5 | 5 | 25 | 0.5 | 6.25 | 1M |
| claude-opus-5.5 | 4 | 20 | 0.2 | 5 | 1M |
| claude-sonnet-4.6 | 3 | 15 | 0.3 | 3.75 | 1M |
| claude-sonnet-5 | 2 | 10 | 0.2 | 2.5 | 1M |
| gemini-3.5/3.6/3.7/3.8-flash | 0.75–1.5 | 3.75–9 | 0.075–0.15 | 0 | 200K–1M |
| gpt-5-mini | 0.25 | 2 | 0.025 | 0 | 264K |
| gpt-5.3-codex | 1.75 | 14 | 0.175 | 0 | 1M |
| gpt-5.4 / gpt-5.4-mini / gpt-5.4-nano | 0.2–2.5 | 1.25–15 | 0.02–0.25 | 0 | 400K–1M |
| gpt-5.5 | 5 | 30 | 0.5 | 0 | 1M |
| **gpt-5.6-luna** (pi's `implement`/`plan-critique`/`verify-run`/`diagnose` default) | 0.2 | 1.2 | 0.02 | 0.25 | 1.05M |
| gpt-5.6-sol / gpt-5.6-terra | 2–4 | 12–20 | 0.2–0.4 | 2.5–5 | 1.05M |
| gpt-6-astra / gpt-6-luna / gpt-6-sol | 0.1–10 | 0.5–50 | 0.01–1 | 0.125–12.5 | 1M |
| grok-4.5/4.6/4.7 | 2 | 6 | 0.5 | 0 | 500K |
| kimi-k2.7-code / kimi-k3 | 0.95–3 | 4–15 | 0.19–0.3 | 0 | 256K–1.05M |
| mai-code-1-flash-picker / mai-code-1.1-flash | 0.2–0.75 | 1.2–4.5 | 0.02–0.075 | 0 | 256K |

**Calibration check:** a sampled `github-copilot`/`claude-fable-5` turn in a live session billed input at exactly $10/M, output at exactly $50/M, and cache-read at $1.00/M — matching the `models-store.json` row for `claude-fable-5` exactly (note `claude-fable-5` and `claude-fable-5.1` differ only in `cacheRead`: 1 vs 0.25). This confirms pi's `usage.cost.total` is computed directly from this same rate card, so **summing `usage.cost.total` across turns and multiplying by 100 gives AI-credit consumption**, for any model in the table above, with no separate multiplier lookup — and a mid-session model switch is handled for free, since every turn independently carries its own `model` and `cost`.

**Billing-regime fork — the open question, re-scoped:** pi itself is wired to the current usage-based rate card (see `baseUrl` above), so *pi's number* is right for that regime. The open question is whether **this GitHub account's subscription** is still being billed under the legacy per-request-multiplier regime (only possible for annual Pro/Pro+ holdouts who didn't migrate) — in which case GitHub's own ledger wouldn't match pi's token-cost-derived number at all, regardless of what pi computes locally. Confirm via the `gh api` probe below before trusting either number as the billing truth.

**`gh api` / billing visibility — tested empirically (corrected):** GitHub does document and expose per-user billing endpoints beyond generic Actions/Packages billing — found via the `documentation_url` in a 404 body, not from the page fetches above:
```
$ gh api user --jq .login
bearmoth

$ gh api /users/bearmoth/settings/billing/ai_credit/usage
{"timePeriod":{"year":2026,"month":10},"user":"bearmoth","usageItems":[]}

$ gh api /users/bearmoth/settings/billing/premium_request/usage
{"timePeriod":{"year":2026,"month":10},"user":"bearmoth","usageItems":[]}
```
Both return **HTTP 200** with the correct schema (`timePeriod`, `usageItems[]`) using the existing `gist, read:org, repo, user` token scopes — no special billing scope was needed. Both came back empty for October, September, and August 2026 on the `bearmoth` account. **This means the mechanism exists and works**, but either (a) `bearmoth` has no Copilot subscription of its own (`gh api user` shows `"plan":{"name":"free"}`), or (b) Phil's actual Copilot/pi usage is billed through a different account or an employer org/enterprise seat, whose per-seat consumption these personal endpoints don't surface. **Which account/org pi's Copilot calls are actually billed against is the concrete open question**, not API availability. (A generic `/users/{username}/settings/billing/usage` — Actions/Packages/Storage only, no Copilot rows — does work and was the one originally probed in error against the wrong username; it is a 404 only for a mistyped path, not absent for this account.)

**Orchestrator manifest/report already recording cost/tokens per dispatch** (`/Users/phil/.local/share/chezmoi/private_dot_pi/private_agent/extensions/modes/`):
- `dispatch.ts` accumulates, per dispatch, `usage = {turns, tokens, cost}` while streaming a worker's messages (around line 468-471): `usage.turns++` per message; `usage.tokens += (msg.usage.input||0)+(msg.usage.output||0)` — **this excludes `cacheRead`/`cacheWrite`, so the `tokens` field understates true billed tokens**; `usage.cost += msg.usage.cost?.total||0` — this one is complete and correct, since `cost.total` already includes cache components.
- `dispatch-log.ts`'s `DispatchRecord` carries `{turns?, tokens?, cost?}` per dispatch (settled from `result.usage`), rebuildable from session history on resume (`rebuildDispatchLog`).
- `workstream.ts`'s `MetricRollups`/`computeMetricRollups()` (~line 279) sums `dispatches[].{cost,tokens,durationMs}` across a whole workstream and renders them in `renderManifest()`/`renderReport()` (dispatch table with step/profile/status/duration/turns/tokens/cost/questions/rework columns).
- Caveats: (a) the `tokens` rollup is an undercount for the reason above, even though `cost` is right; (b) an errored, all-zero-usage turn still increments `turns`; (c) these rollups cover **worker dispatches only** — the orchestrating pi session's own tokens/cost aren't in the manifest and would need to be added from that session's own `.pi/agent/sessions/**/*.jsonl` file separately to get a true whole-workstream total.

## Multiplier table

**Current (usage-based, default since 2026-06-01) — per-million-token rates**, source `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing` (fetched 2026-10-01, no page-level date shown; 1 AI credit = $0.01):

| Model | Input $/M | Cached input $/M | Cache write $/M | Output $/M |
|---|---|---|---|---|
| Claude Haiku 4.5 | 1.00 | 0.10 | 1.25 | 5.00 |
| Claude Sonnet 4 | 3.00 | 0.30 | 3.75 | 15.00 |
| Claude Sonnet 4.6 | 3.00 | 0.30 | 3.75 | 15.00 |
| Claude Sonnet 5 | 2.00 | 0.20 | 2.50 | 10.00 |
| Claude Sonnet 5.5 | 2.00 | 0.20 | 2.50 | 10.00 |
| Claude Opus 4.7 | 5.00 | 0.50 | 6.25 | 25.00 |
| Claude Opus 4.8 | 5.00 | 0.50 | 6.25 | 25.00 |
| Claude Opus 5 | 5.00 | 0.50 | 6.25 | 25.00 |
| Claude Opus 5.5 | 4.00 | 0.20 | 5.00 | 20.00 |
| Claude Fable 5 / 5.1 | 10.00 | 0.25–1.00 | 12.50 | 50.00 |
| GPT-5 mini | 0.25 | 0.025 | — | 2.00 |
| GPT-5.3-Codex | 1.75 | 0.175 | — | 14.00 |
| GPT-5.4 (default / long-context) | 2.50 / 5.00 | 0.25 / 0.50 | — | 15.00 / 22.50 |
| GPT-5.4 mini | 0.75 | 0.075 | — | 4.50 |
| GPT-5.4 nano | 0.20 | 0.02 | — | 1.25 |
| GPT-5.5 (default / long-context) | 5.00 / 10.00 | 0.50 / 1.00 | — | 30.00 / 45.00 |
| GPT-5.6 Luna (default / long-context) | 0.20 / 0.40 | 0.02 / 0.04 | 0.25 / 0.50 | 1.20 / 1.80 |
| GPT-6 Luna (default / long-context) | 0.10 / 0.20 | 0.01 / 0.02 | 0.125 / 0.25 | 0.50 / 0.75 |

This current-regime table is a mix of two fetches of the same `models-and-pricing` doc page (Claude rows, then OpenAI/Luna rows) plus the authoritative `~/.pi/agent/models-store.json` cache above, which agrees with it exactly where they overlap (e.g. `gpt-5.6-luna`: $0.20/$1.20/$0.02/$0.25 in both). There is no "0x/included" row in this table — included usage comes from the monthly AI-credit allowance (e.g. Copilot Pro ≈ 1,000 base + 500 flex credits/month per `https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing`, fetched 2026-10-01), not a per-model exemption.

**Legacy (request-based, annual Pro/Pro+ holdouts only)**, source `https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans` (fetched 2026-10-01, no page-level date shown):

| Model | Multiplier |
|---|---|
| Claude Haiku 4.5 | 0.33 |
| Claude Sonnet 4.6 | 9 |
| Claude Opus 4.7 | 27 |
| Claude Opus 4.8 | 27 |
| Gemini 3 Pro | 6 |
| Gemini 3.5 Flash | 14 |
| GPT-4o | 0.33 |
| GPT-4o mini | 0.33 |
| GPT-5.1 / GPT-5.1-Codex / GPT-5.1-Codex-Max | 3 |
| GPT-5.1-Codex-Mini | 0.33 |
| GPT-5.3-Codex | 6 |
| GPT-5.4 / GPT-5.4 mini | 6 |
| GPT-5.5 | 57 |
| GPT-5 mini | 0.33 |
| MAI-Code-1.1-Flash | 0.25 |
| Copilot code review (feature, not a chat model) | 13 |

No model is listed at `0x` in this fetched table either — an earlier web-search-engine summary claimed GPT-4.1/4o/5-mini at `0x`, but that could not be confirmed against the actual fetched page content, so it is **explicitly dropped** rather than reported as fact. The legacy table also has **no published row for `claude-opus-5`, `claude-fable-5`, or any `gpt-5.6`/`gpt-6`-era model** (`gpt-5.6-luna` included) — those are current-regime-only model IDs, so their legacy multiplier (if the account were ever switched back) is UNVERIFIED/not published.

## Proposed per-session record schema

One JSON object per line, one line per harness-session, in e.g. `~/.local/state/harness-cost/sessions.jsonl`:

```json
{
  "schema_version": 1,
  "harness": "claude-code",
  "session_id": "…",
  "task_ref": "bearmoth/dotfiles#50",
  "workspace": { "repo": "bearmoth/dotfiles", "branch": "research/cost-accounting", "cwd": "…" },
  "session_name": "…",
  "started_at": "2026-10-01T00:00:00Z",
  "ended_at": "2026-10-01T00:30:00Z",
  "models": [
    { "model": "claude-opus-5", "provider": "anthropic",
      "input_tokens": 8500, "output_tokens": 1200,
      "cache_read_tokens": 2000, "cache_write_tokens": 5000,
      "cost_usd": 0.42 }
  ],
  "total_tokens": 16700,
  "native_unit": "cc_5h_pct",
  "native_usage": {
    "start": { "five_hour_pct": 10.2, "seven_day_pct": 30.0, "resets_at": 1738425600 },
    "end":   { "five_hour_pct": 14.8, "seven_day_pct": 31.1, "resets_at": 1738425600 },
    "reset_crossed": false,
    "concurrent_sessions_possible": true,
    "ai_credits_consumed": null,
    "premium_requests_consumed": null,
    "billing_regime": "unknown"
  },
  "list_usd_estimate": 0.42,
  "source": "statusline-tee+stop-hook"
}
```

Field reference — unit and source per harness:

| Field | Unit | Claude Code source | pi source |
|---|---|---|---|
| `harness` | enum `claude-code`\|`pi` | constant | constant |
| `session_id` | opaque id | hook/statusline `session_id` | session filename / `sessionId` |
| `task_ref` | issue ref string | not native; caller supplies | workstream slug (`workstream.ts` manifest `slug`) |
| `workspace.repo`/`branch`/`cwd` | strings | statusline `workspace.repo.*`, `cwd` | manifest `worktrees[].path`/`branch`, or session cwd |
| `session_name` | string | statusline/hook `session_name` | workstream `slug` |
| `started_at`/`ended_at` | ISO 8601 | first/last statusline snapshot timestamp (not itself a field — derive from tee-file mtimes) or transcript first/last line | session filename timestamp / first-last `message.timestamp` |
| `models[].{model,provider}` | strings | transcript `cost-state.modelUsage` keys, or per-message `message.model` | per-message `message.model`/`message.provider` |
| `models[].input_tokens` etc. | token count | `cost-state.modelUsage[model].{inputTokens,outputTokens,cacheReadInputTokens,cacheCreationInputTokens}` | `message.usage.{input,output,cacheRead,cacheWrite}` |
| `models[].cost_usd` | USD (estimate) | `cost-state.modelUsage[model].costUSD` | `message.usage.cost.{input,output,cacheRead,cacheWrite}` |
| `total_tokens` | token count | sum of the above | `message.usage.totalTokens`, summed |
| `native_unit` | enum | `cc_5h_pct`\|`cc_7d_pct` | `copilot_ai_credits`\|`copilot_premium_requests` |
| `native_usage.start`/`end.*_pct` | percent 0–100 | statusline `rate_limits.five_hour\|seven_day.used_percentage` | n/a |
| `native_usage.*.resets_at` | Unix epoch seconds | statusline `rate_limits.*.resets_at` | n/a |
| `native_usage.ai_credits_consumed` | credits (1 = $0.01) | n/a | `message.usage.cost.total` summed × 100, **if** current regime; else `gh api /users/{login}/settings/billing/ai_credit/usage` |
| `native_usage.premium_requests_consumed` | request count | n/a | turn count × model multiplier (derived), **if** legacy regime; or `gh api /users/{login}/settings/billing/premium_request/usage` |
| `native_usage.billing_regime` | enum | n/a | `usage_based`\|`legacy_multiplier`\|`unknown` — resolve once via the `gh api` probes above, then cache |
| `list_usd_estimate` | USD (estimate, not a bill) | `cost.total_cost_usd` (statusline) or `cost-state.totalCostUSD` (transcript) | sum of `message.usage.cost.total` |
| `source` | enum | `statusline-tee+stop-hook`\|`otel`\|`transcript-scan` | `session-jsonl-scan`\|`dispatch-log-rollup` |

Rationale: `models[]` is an array so a mid-session model switch (both harnesses already record `model` per message/turn) is captured natively without special-casing. `native_unit`/`native_usage` is what the two-week baseline and the later go/no-go should actually do arithmetic on — it's the thing each harness bills against. `list_usd_estimate` exists purely so the two harnesses are eyeball-comparable in one currency, with the explicit understanding that it is not authoritative for either.

## Caveats

- **Neither harness's dollar figure is a bill.** Claude Code: "isn't relevant for billing purposes" on Max (`/en/costs`). Copilot: pi's cost is a derived estimate from token counts; the only authoritative Copilot ledger is the web usage page.
- **Claude Code rate limits are account-wide, not session-scoped.** `five_hour`/`seven_day` `used_percentage` is shared with any other concurrent session/device/claude.ai activity — a per-session delta can be contaminated by concurrent usage; flag it, don't assume isolation.
- **Stop hook has no cost/rate-limit fields** — a bridge (statusline tee, or OTel) is required; this research did not modify the live statusline script or hooks, only proposes the design.
- **Transcript usage blocks may need dedup** — observed apparently-duplicate `usage` blocks on consecutive assistant entries in one sampled transcript; sum by message/request id, not blindly by block.
- **The `cost-state` transcript entry type is undocumented** — useful (it's Claude Code's own per-model rollup) but not a stable contract; don't build a hard dependency on its exact shape.
- **pi's orchestrator `tokens` rollup undercounts** (excludes cache read/write) even though its `cost` rollup is correct; and it covers worker dispatches only, not the orchestrating session itself.
- **GitHub Copilot billing regime is a live fork, not settled by this research.** The platform-wide default moved to token-priced AI Credits on 2026-06-01; legacy per-model multipliers persist only for annual Pro/Pro+ holdouts. pi itself is wired to the current regime (`models-store.json` pulls from `api.individual.githubcopilot.com`), but **which GitHub account/org Phil's actual Copilot usage bills against is UNVERIFIED** — the `bearmoth` account's own `ai_credit`/`premium_request` usage endpoints both returned empty for Aug/Sep/Oct 2026, consistent with billing happening elsewhere (a different personal account, or an employer org/enterprise seat).
- **`gh api` per-user Copilot endpoints exist and work** — `GET /users/{username}/settings/billing/ai_credit/usage` and `.../premium_request/usage` both returned HTTP 200 with a proper `{timePeriod, usageItems[]}` schema using ordinary `gist, read:org, repo, user` scopes (no billing scope needed). The first probe in this research hit the wrong path/account and a 404 was misreported as "no endpoint exists" — corrected above. Org/enterprise-wide aggregate metrics endpoints also exist separately (`GET /orgs/{org}/copilot/metrics/reports/...`) and need org-admin access.
- **`/cost` is UNVERIFIED** — not present on the current costs doc page (which documents `/usage` instead).
- **Legacy multiplier "0x" models are UNVERIFIED and dropped** — a search-engine summary claimed some OpenAI models are 0x/free under the legacy table; the actual fetched legacy page content did not show any 0x row, so that claim is omitted rather than repeated.
- **How Copilot's legacy regime counts a multi-tool-call turn as "requests"** is UNVERIFIED — pi has no native premium-request counter, only raw token/cost usage.

## Sources

- Statusline fields/refresh/rate limits: `https://code.claude.com/docs/en/statusline`
- Cost tracking, `/usage`, estimate-vs-billing caveat: `https://code.claude.com/docs/en/costs`
- OpenTelemetry metrics/events: `https://code.claude.com/docs/en/monitoring-usage`
- Hooks, common input fields, Stop/`last_assistant_message`: `https://code.claude.com/docs/en/hooks`
- Current Copilot per-token model pricing: `https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing`
- Current individual usage-based billing (AI Credits, allowances): `https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing`
- Legacy premium-request model multipliers: `https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/model-multipliers-for-annual-plans`
- Requests in GitHub Copilot (what a request is): `https://docs.github.com/en/copilot/concepts/copilot-billing/requests-in-github-copilot`
- Individual usage monitoring surfaces: `https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-ai-usage`
- pi repo (architecture, provider list reference): `https://github.com/earendil-works/pi`
- Local evidence (field names only): `~/.claude/projects/**/*.jsonl` (`message.usage.*`, `cost-state` entries); `~/.pi/agent/sessions/**/*.jsonl` (`message.usage.*`, `message.provider`, `message.model`); `~/.pi/agent/models-store.json` (github-copilot model/rate registry); statusline script `/Users/phil/.local/share/chezmoi/dot_claude/statusline-command.sh`; orchestrator code `/Users/phil/.local/share/chezmoi/private_dot_pi/private_agent/extensions/modes/{dispatch.ts,dispatch-log.ts,workstream.ts,step-config.ts}`
- Empirical probes (run 2026-10-01, token scopes `gist, read:org, repo, user`): `gh api /users/bearmoth/settings/billing/ai_credit/usage` → `200 {"timePeriod":{...},"usageItems":[]}`; `gh api /users/bearmoth/settings/billing/premium_request/usage` → `200 {"timePeriod":{...},"usageItems":[]}`
