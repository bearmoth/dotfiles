# Research: Claude Code routing levers (skill / model / effort per task)

Issue: [bearmoth/dotfiles#46](https://github.com/bearmoth/dotfiles/issues/46) (child of map issue #44)
Claude Code version examined: **2.1.286** (`claude --version`), binary
`/Users/phil/.local/share/claude/versions/2.1.286` (Mach-O with embedded Bun JS bundle).
Date: 2026-10-01.

## Verdict

- **Zero-token degraded display works.** A synchronous hook's `systemMessage` is shown to the user and adds nothing to the model's context: the API normalizer maps `hook_system_message` to `()=>[]`. The statusline also costs no tokens. The trap is `async: true`. An async hook's `systemMessage` **is** delivered to Claude. Plain stdout from UserPromptSubmit, SessionStart and PostModelSwitch hooks is also delivered to Claude.
- **No hook can switch the main session's model or effort.** PreModelSwitch can only allow, deny or ask on a switch the user requested. The things that actually change model or effort per task are:
  - skill frontmatter `model`/`effort` (lasts until the end of the turn)
  - rewriting a subagent dispatch with PreToolUse `updatedInput` (`model` limited to the 4 aliases; `subagent_type` can point at tiered agent definitions that carry `effort`)
  - launch flags and env vars
  - the user typing `/model` or `/effort`
- **The Agent tool has no `effort` parameter.** An `effort` key added through `updatedInput` is silently dropped. Per-subagent effort comes only from agent or skill frontmatter.
- **UserPromptSubmit gets no effort information**, neither the `effort` field nor `$CLAUDE_EFFORT`. The statusline does get it, along with model and rate limits, so the statusline should be both the sensor (writing a cache file) and the display.
- **Editing settings.json mid-session does not change model or effort.** The docs say so and the binary agrees: the effort table is built once at startup. This is PARTIAL because no live test was possible.
- **Keep the prompt-path hook to reading a cache file.** Spawning `sh` costs about 20 ms and bash+jq about 30 ms. A network call on the prompt path adds its full round-trip on every prompt.

## Lever table

| Lever | Verified | Mechanism | Token cost | Latency | Notes |
| :- | :- | :- | :- | :- | :- |
| UPS `systemMessage` (sync) | yes (docs + binary) | `hook_system_message` attachment; UI "<hook> says: …"; API normalizer `hook_system_message:()=>[]` | **0** | hook runtime (blocks prompt) | Use this for the degraded-state line. Not if `async:true` |
| UPS `systemMessage` (`async:true`) | yes (docs + binary) | `async_hook_response` → `Re({content:systemMessage,isMeta:!0})` | **full text, into context** | non-blocking; delivered next turn | **Trap**: async systemMessage goes *to Claude*, not the user |
| UPS `additionalContext` | yes (docs + binary) | `<system-reminder>UserPromptSubmit hook additional context: …` meta user msg next to prompt | text length (≤10k chars, else file+2k preview); persisted, replayed on resume | blocks prompt | Lands after the cached prefix, so it is uncached input on that turn only, then becomes part of history |
| UPS plain stdout | yes (docs + binary) | `hook_success` → `<system-reminder>… hook success: …` (only SessionStart/UPS/UPE) | text length | blocks prompt | Output starting `{` but not ending `}` counts as plain text and is injected |
| UPS input has `effort.level` | **no** (binary) | common input builder `kc()` builds `effort` only with a tool-use context; both UPS call sites pass 3 args | n/a | n/a | `$CLAUDE_EFFORT` also absent (env built from input via `Ete()`) |
| UPS `decision:block` / `sessionTitle` | yes (docs) | block `reason` shown to user, not context | 0 | — | `sessionTitle` probably 0 tokens (UNVERIFIED) |
| PreToolUse(Agent) `updatedInput.model` | yes (docs + binary) | replaces whole input; `inputSchema.safeParse`, `unrecognized_keys` ignored | 0 (but subagent gets a fresh cache on its model) | hook runtime | `model` enum is `sonnet\|opus\|haiku\|fable` only; full IDs fail validation |
| PreToolUse(Agent) `updatedInput.effort` | **no** (binary) | schema has no `effort`; extra key filtered | — | — | Rewrite `subagent_type` to an agent definition with `effort:` frontmatter instead |
| PreToolUse(Agent) `updatedInput.subagent_type` | partial (docs + schema) | swaps agent definition (its `model`/`effort`/`tools`) | 0 | hook runtime | UNVERIFIED end to end; confirm via PostToolUse `resolvedModel` |
| SubagentStart | yes (docs) | input: `agent_id`, `agent_type` (+common); can only add `additionalContext` | that text (inside the subagent's context) | — | Cannot block, cannot change model |
| PreModelSwitch | yes (docs + binary) | gates `/model`, picker, `/config`, fast mode, SDK `set_model`; allow/deny/ask | 0 (systemMessage always shown) | 30 s default; **timeout = block** | Input includes `context_tokens`, `prompt_cache_warm`, `cache_ttl`, `estimated_cache_write_usd`, `pricing`. Not fired for auto fallback or resume |
| PostModelSwitch | yes (docs) | also fires on fallback, opusplan flips, resume restore; stdout/`additionalContext` sent with next request | text length | 5 s grace, then deferred one request | Plain stdout is injected; don't echo status |
| SessionStart resume/fork cost fields | yes (docs) | `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired`, `estimated_cache_write_usd` | 0 if reported via `systemMessage` | runs in background at launch; first response waits | Present only when source is resume/fork and transcript has ≥1 response |
| Settings hot-reload of `model`/`effortLevel`/`modelSettings` | partial (docs + binary, no live test) | effort table built once at startup | — | — | Docs say startup-only; ConfigChange still fires |
| `fallbackModel` / `--fallback-model` | yes (docs) | per-turn chain on overload/unavailable, ≤3 models | cold cache on fallback model for that turn | — | Hot-reload UNVERIFIED |
| `--model` / `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_MODEL` | yes (docs) | launch-time precedence: `/model` > `--model` > `ANTHROPIC_MODEL` > settings `model` > `ANTHROPIC_DEFAULT_MODEL` | 0 | — | Per-terminal routing = per-launch flag |
| `--effort` / `CLAUDE_CODE_EFFORT_LEVEL` | yes (docs) | env > `--effort`/`/effort` > `modelSettings`/`effortLevel` > model default | 0 | — | **Env var overrides skill/subagent frontmatter**, which kills per-task effort routing |
| `maxEffortLevel` / `availableModels` | yes (docs) | caps / allowlist across session, subagents, skills | 0 | — | Cap is applied before each request; hot-reload UNVERIFIED |
| `CLAUDE_CODE_SUBAGENT_MODEL` (+`_FORCE`) | yes (docs + binary) | default subagent model; `_FORCE=1` overrides everything | 0 | — | Since 2.1.251 it is a default, below invocation param and frontmatter |
| Agent / skill frontmatter `model`, `effort` | yes (docs) | skill: rest of current turn; agent: for that subagent | model switch → full uncached re-read; effort change keeps cache on Opus 5.5/Sonnet 5.5/Fable 5.1 | — | Most practical per-task actuator |
| Stop `last_assistant_message` | yes (docs) | input field | 0 | — | — |
| Stop `additionalContext` / `decision:block` | yes (docs + binary) | continues conversation (8-continuation cap) | **a whole extra model turn** | +1 model turn | Never use to report status |
| PreCompact block | yes (docs) | exit 2 / `decision:block`; proactive auto → skipped; recovery auto → request fails | 0 | — | `systemMessage` discarded |
| Statusline | yes (docs + binary) | stdin JSON incl. `model`, `effort.level`, `cost`, `context_window`, `rate_limits`, `prompt_cache` | **0** (docs: "does not consume API tokens") | event-driven, 300 ms debounce, optional `refreshInterval` ≥1 s | Best sensor and display |
| Hook timeout | yes (docs) | `timeout` (s); default 600, **30** for UPS/Pre/PostModelSwitch, 10 MessageDisplay | — | UPS timeout fails open + user-only notice | Timed-out notice is `hook_cancelled:()=>[]` (0 tokens) |
| `${CLAUDE_EFFORT}` in skill body | yes (docs + binary) | substituted at skill expansion | part of skill text | — | Lets a skill adapt instructions to effort |
| `reloadSkills` (SessionStart) | yes (docs) | re-scan skills after hook | skill listing delta | — | Lets a router install or refresh skills at session start |
| UserPromptExpansion | yes (docs) | fires on `/skill` typed directly; block / `additionalContext` | text length | blocks expansion | Covers the path PreToolUse(Skill) misses |
| `opusplan` | yes (docs) | Opus in plan mode, Sonnet in execution | cache cold at each flip | — | Fires PostModelSwitch |

## Detail per lever

### 1. UserPromptSubmit

**`systemMessage` (synchronous hook): zero tokens.**
- Docs: it is a "Warning message shown to the user" ([hooks#json-output](https://code.claude.com/docs/en/hooks#json-output)).
- Binary: the hook runner yields an attachment `sn({type:"hook_system_message",content:…,hookName,hookEvent})`.
- The UI renders it as `[hookName," says: ",content]`.
- The attachment-to-API table (`normalizeAttachmentForAPI`) contains `hook_system_message:()=>[]`. It sits alongside `hook_cancelled:()=>[]`, `hook_error_during_execution:()=>[]` and `hook_non_blocking_error:()=>[]`. So the text never reaches the model. Timeout notices and hook-error notices are also zero-token.

**`async: true` breaks this.**
- Docs ([hooks, "How async hooks execute"](https://code.claude.com/docs/en/hooks#run-hooks-in-the-background)): "Claude Code delivers the `additionalContext` and `systemMessage` fields from the hook's JSON response to Claude on the next conversation turn … neither field is shown to you."
- Binary: `case"async_hook_response"` pushes `Re({content:systemMessage,isMeta:!0})`.
- So a background status refresher must print nothing.

**`additionalContext`.**
- Binary: `hook_additional_context:(e)=>[Re({content:ol(`${e.hookName} hook additional context: ${e.content.join("\n")}`),isMeta:!0})]`. That is a system-reminder meta user message placed next to the submitted prompt.
- Cost is its text length, capped at 10,000 chars. Above the cap it is spilled to a file and only a 2,000-char preview is injected.
- It is saved in the transcript and replayed on `--resume` rather than re-run ([hooks#add-context-for-claude](https://code.claude.com/docs/en/hooks#add-context-for-claude)). It therefore stays in history and is re-sent, cached, every later turn.

**Plain stdout.**
- Injected as `<system-reminder>{hook} hook success: {stdout}`. The binary's `case"hook_success"` only passes this through for `SessionStart`, `UserPromptSubmit` and `UserPromptExpansion`; every other event returns `[]`.
- Docs list PostModelSwitch plain stdout as context too, routed through `hook_additional_context`.
- Stdout that starts with `{` but doesn't end with `}` is treated as plain text and injected ([hooks#exit-code-0](https://code.claude.com/docs/en/hooks#exit-code-0)).
- Stderr on exit 0 goes to the debug log only.

**Effort.**
- Docs: `effort` is "Present for events that fire within a tool-use context, such as PreToolUse, PostToolUse, Stop, and SubagentStop".
- Binary: `function kc(e,n,r,s){… D=h&&s?.getAppState&&fw(h)?{level:pA(h,b,w)}:void 0 …}`. Both UPS input builders call `kc(e,oe(),s)` / `kc(r.session,oe(),n)` with no fourth argument, so `effort` is undefined.
- The hook env comes from `Ete(e){return{sessionId:e.session_id,effortLevel:e.effort?.level,…}}`, and `CLAUDE_EFFORT` is set only when `effortLevel!==void 0`. So **`$CLAUDE_EFFORT` is also absent in UPS hooks**, unless inherited from the parent process env.
- The schema text in the binary says: "absent for session-lifecycle hooks and models without effort support."
- Workaround: the statusline input carries live `effort.level`, and statusline commands also get `CLAUDE_EFFORT`. The statusline can write it to a cache file that the UPS hook reads.

**Other fields.** Block with `decision:"block"` + `reason`; the reason is shown to the user and not added to context. `sessionTitle` and `suppressOriginalPrompt` are also available ([hooks#userpromptsubmit-decision-control](https://code.claude.com/docs/en/hooks#userpromptsubmit-decision-control)). UPS can't rewrite the prompt.

### 2. PreToolUse on `Agent`, and SubagentStart

**Agent tool schema** (binary, zod `ho`/`yo`):
- `description`, `prompt`
- `subagent_type?`
- `model?: enum["sonnet","opus","haiku","fable"]`
- `run_in_background?`
- `name?`, `team_name?` (deprecated), `mode?` (deprecated)
- `isolation?: enum["worktree","remote"]`
- `cwd?`

There is **no `effort` field.** The call site destructures `{subagent_type,run_in_background,name,isolation,prompt,description,cwd,model}`. The tool definition exposed in this very session matches.

**How `updatedInput` is handled.**
- It replaces the whole input object ([hooks#pretooluse-decision-control](https://code.claude.com/docs/en/hooks#pretooluse-decision-control)).
- Binary: `let xe=n.inputSchema.safeParse(be.updatedInput),Ae=xe.success?[]:xe.error.issues.filter((Pe)=>Pe.code!=="unrecognized_keys");if(!xe.success&&Ae.length>0){… "returned updatedInput that failed schema validation" …}`.
- Unknown keys such as `effort` are tolerated and dropped. A `model` outside the four aliases is a validation error.

**What a hook can and cannot do here.**
- It **can** force `model` to an alias, or swap `subagent_type` to a tiered agent definition that carries `model:` (full IDs allowed in frontmatter) and `effort:`.
- Omit `permissionDecision` to rewrite without changing permission semantics. Combining with `"allow"` auto-approves the call.

**Caveats on the resolved model** ([sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model)):
- Resolution order is: invocation `model` > frontmatter `model` > `CLAUDE_CODE_SUBAGENT_MODEL` > main model.
- A family alias resolves to the main conversation's exact model when the families match.
- `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` ignores both the parameter and frontmatter. `CLAUDE_CODE_COORDINATOR_FORCE_WORKER_INHERIT_MODEL` (binary) also voids the parameter.
- Verify the outcome with the PostToolUse `tool_response.resolvedModel` / `modelsUsed`.

**SubagentStart** ([hooks#subagentstart](https://code.claude.com/docs/en/hooks#subagentstart)):
- Receives the common fields plus `agent_id` and `agent_type`. There is no model and no prompt.
- It can't block. It can only add `additionalContext` to the subagent, injected once per subagent so the subagent's cache is preserved.

### 3. PreModelSwitch / PostModelSwitch

Both require v2.1.251 or later ([hooks#premodelswitch](https://code.claude.com/docs/en/hooks#premodelswitch)).

**PreModelSwitch input:**
- `from_model`, `to_model`, `requested_model`
- `source`: `command` / `picker` / `sdk`
- `context_tokens`: input + cache read + cache creation + output tokens of the last response
- `prompt_cache_warm`, `cache_ttl` (`5m`/`1h`)
- `estimated_cache_write_usd`
- `pricing`: `configured` / `catalog` / `default`

**When it fires and what it can do.**
- The matcher is the canonical target name, ignoring `[1m]`.
- It fires for `/model`, the pickers, `/config`, fast mode and SDK `set_model`. It does **not** fire for automatic fallback or resume restore.
- Whether it fires for a skill-frontmatter `model` switch is UNVERIFIED.
- Decisions:
  - `permissionDecision` can be `allow`, `deny` or `ask`.
  - `allow` also skips the built-in warm-cache confirmation.
  - Precedence is deny > ask > allow.
  - `decision:"block"` or exit 2 cancels the switch.
- It does not accept `updatedInput` or `additionalContext`.
- Only interactive `/model` can show the `ask` prompt. Every other surface treats `ask` as a refusal.
- **Timeout blocks the switch** (30 s default).

**What the user sees on deny.** `permissionDecisionReason` is "shown to the user as the reason the switch was blocked". Claude Code "keeps the current model and reports that a PreModelSwitch hook blocked the switch, with your message as the reason". `systemMessage` is shown whatever the decision. Binary `pOo()` collects `hook_system_message` and `"PreModelSwitch hook X failed: …"` strings for that report.

**PostModelSwitch.**
- Same input, plus `source` values `auto` and `resume`.
- It fires on any change: requested switches, automatic fallback, `opusplan` plan-mode flips and resume restore. It does not fire for per-turn fallback-chain substitution.
- Plain stdout or `additionalContext` goes to Claude with the next request. If the hook takes more than 5 s after the next prompt is sent, the output slips to the following request.
- Because stdout is injected, a degraded-state hook here must print nothing, or JSON with only `systemMessage`.

### 4. SessionStart on resume/fork

Requires v2.1.251 or later ([hooks#sessionstart-input](https://code.claude.com/docs/en/hooks#sessionstart-input)).
- When `source` is `resume` or `fork` and the transcript has at least one response, the input adds `seconds_since_last_response`, `context_tokens`, `prompt_cache_likely_expired` and `estimated_cache_write_usd`.
- The `model` field may be omitted, for example after `/clear` or conversation recovery.
- Report these figures through `systemMessage` (0 tokens). Do not use stdout: SessionStart plain stdout becomes context.
- Other outputs: `additionalContext`, `initialUserMessage` (`-p` only), `sessionTitle`, `watchPaths` and `reloadSkills`.

### 5. Settings hot-reload: PARTIAL (no live test possible)

**Docs** ([settings#when-edits-take-effect](https://code.claude.com/docs/en/settings#when-edits-take-effect)):
- Settings files are watched and most keys apply live, including `permissions` and `hooks`.
- "Claude Code reads some keys only once, at session start … `model` … `effortLevel` and `modelSettings`: use `/effort` to change effort mid-session."
- ConfigChange fires for each settings-file change (`user_settings`, `project_settings`, `local_settings`, `policy_settings`, `skills`) and can block it, except for policy settings ([hooks#configchange](https://code.claude.com/docs/en/hooks#configchange)).

**Binary trace.**
- Effective effort for an "inherit" session comes from `Sd(appState)` → `appState.settingsEffortTable`.
- The only writer of `settingsEffortTable` other than the static initial state is `function tft(e){let n={sessionEffort:se(zKn(e)),settingsEffortTable:z()};…}`. Both of its call sites are startup paths (`...tft(e.effort)` in the two initial-state builders).
- No settings-change handler recomputing it was found.
- `z()` is also called live by `Nfn()`, but only to word the `/effort` messages.
- **Conclusion:** settings edits to `effortLevel`/`modelSettings` don't change the running session's effort. This agrees with the docs.

**Why the community "next-turn reload" claim probably doesn't hold today.**
- It likely predates v2.1.251, the version that moved effort to per-model `modelSettings`.
- Separately, a top-level `effortLevel` in user `~/.claude/settings.json` is **ignored on Opus 5.5** in any case ([settings-reference#effortlevel](https://code.claude.com/docs/en/settings-reference#effortlevel)).
- A live test is still owed. Steps: in an interactive session, edit `modelSettings` → send a prompt → read the statusline `effort.level`.

**Not checked.** Hot-reload of `fallbackModel` and `maxEffortLevel` is UNVERIFIED. The `maxEffortLevel` docs say the cap is applied "before each request", but that describes clamping, not reload.

**Smoke test status.** `CLAUDE_CONFIG_DIR=/tmp/ccr/cfg claude -p --model haiku --settings /tmp/ccr/empty.json …` returned `Not logged in · Please run /login`. Per the rules, I did not work around this.

### 6. Launch-time and env levers

**Model precedence** ([model-config#setting-your-model](https://code.claude.com/docs/en/model-config#setting-your-model)): `/model` > `--model` > `ANTHROPIC_MODEL` > settings `model` > `ANTHROPIC_DEFAULT_MODEL`.
- `ANTHROPIC_DEFAULT_MODEL` needs v2.1.236 or later. It is ignored for `default`, `inherit`, `opusplan` and `haiku`.
- `--model` and `ANTHROPIC_MODEL` apply only to the session they launch.
- A resumed session keeps the model saved in its transcript unless `--model` or `ANTHROPIC_MODEL` is given.

**Effort precedence** ([model-config#adjust-effort-level](https://code.claude.com/docs/en/model-config#adjust-effort-level)): `CLAUDE_CODE_EFFORT_LEVEL` > `--effort` or `/effort` > `modelSettings`/`effortLevel` > model default.
- Opus 5.5 and Sonnet 5.5 default to `medium`.
- Frontmatter `effort` overrides the session level **but not the env var** ([model-config#set-the-effort-level](https://code.claude.com/docs/en/model-config#set-the-effort-level)).
- `max` applies to the session only unless it comes from the env var.
- `--effort ultracode` sets `xhigh` and turns ultracode on.

**`fallbackModel` / `--fallback-model`** ([model-config#fallback-model-chains](https://code.claude.com/docs/en/model-config#fallback-model-chains)):
- Triggers only on overload, unavailable model or non-retryable server error, never on rate limit.
- Lasts one turn, with at most 3 models. The flag overrides the setting.
- The chain doesn't merge across settings files.
- `/status` doesn't show it.
- It also applies to subagents.

**`maxEffortLevel`** (v2.1.267 or later): caps every source, including frontmatter. Per-model caps are set in `modelSettings`. The lowest cap across scopes wins.

**`availableModels`:** an allowlist covering the session, subagents, skills and the advisor. `enforceAvailableModels` extends it to the Default option.

**`CLAUDE_CODE_SUBAGENT_MODEL` / `_FORCE`:** see §2. Explore and Plan are unaffected unless `_FORCE` is set.

**Agent frontmatter:** `model` takes an alias, full ID or `inherit`. `effort` takes `low` through `max` ([sub-agents#supported-frontmatter-fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)).

### 7. Stop and PreCompact

**Stop** ([hooks#stop-input](https://code.claude.com/docs/en/hooks#stop-input)):
- The input has `last_assistant_message`, `stop_hook_active`, `background_tasks` and `session_crons`.
- `hookSpecificOutput.additionalContext` continues the conversation without an error label ("Stop hook feedback").
- `decision:"block"` + `reason` also continues. Both count toward the 8-continuation cap (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- **Cost: a whole extra model turn**, not just the text.

**PreCompact** ([hooks#precompact](https://code.claude.com/docs/en/hooks#precompact)):
- Exit 2 or `decision:"block"` blocks compaction.
- A proactive auto-compact is skipped and the conversation continues. A compaction that was recovering from a context-limit error fails the request instead.
- `systemMessage` and `continue` are discarded.

### 8. Hook timeouts and latency

**Timeouts** ([hooks#common-fields](https://code.claude.com/docs/en/hooks#common-fields)):
- `timeout` is in seconds and configurable per hook.
- Defaults are 600 for `command`, `http` and `mcp_tool`, 30 for `prompt` and 60 for `agent`.
- The command/http/mcp default is lowered to **30** on UserPromptSubmit, PreModelSwitch and PostModelSwitch, and to 10 on MessageDisplay. SessionEnd hooks share a 1.5 s budget.
- When a UPS hook times out, its output is discarded, the prompt proceeds (fails open), and a user-only notice appears (`hook_cancelled:()=>[]`).
- Matching hooks run in parallel. UPS blocks model processing until all of them finish.
- Shell form uses `sh -c`, or bash per the `shell` field. Exec form (`args`) skips the shell.

**Latency:** measured outside Claude Code, Python `subprocess`, n=15, this Mac:

| Component | Median | p90 |
| :- | :- | :- |
| `sh -c 'cat >/dev/null'` (no-op hook) | 19.7 ms | 21.9 ms |
| `bash -c 'jq -r .prompt'` | 30.0 ms | 31.3 ms |
| `fish -c 'cat'` (only relevant with a fish shebang) | 66.4 ms | 71.9 ms |
| `curl` status.claude.com status.json (n=8) | 152 ms | 156 ms |

- Read the expected per-prompt overhead as a lower bound: about 20–30 ms of spawn plus the full network round-trip. So a hook making a ~300 ms call adds roughly 320–340 ms to every prompt.
- Claude Code's own hook bookkeeping comes on top. It is recorded as `hook_duration_ms` / `tengu_repl_hook_finished` but was not measured in-harness (UNVERIFIED).
- Recommendation: the UPS hook only reads a cache file and prints JSON `systemMessage` when the state is degraded. The refresh runs out of band, from the statusline or a launchd timer, and prints nothing.

### 9. Statusline

Fields ([statusline#available-data](https://code.claude.com/docs/en/statusline#available-data); the binary builder matches):
- `model.id/display_name`
- `cost.*` (`total_cost_usd`, durations, lines)
- `context_window.*` (`total_input_tokens`, `context_window_size`, `used_percentage`, `current_usage`)
- `exceeds_200k_tokens`
- `fast_mode`
- **`effort.level`**: live, including mid-session `/effort`
- `thinking.enabled`
- `rate_limits.five_hour/seven_day/spend_limit` (`used_percentage`, `resets_at`)
- `prompt_cache.*` (`warm`, `ttl`, `expires_at`, `hit_ratio`, `recache_tokens_if_cold`, …)
- session, workspace, worktree and PR fields, and `agent.name`

**Cadence.**
- It runs at session start and resume, then on: a new assistant message, `/compact` finishing, a permission-mode change, a vim toggle, a `command` change, a `rate_limits.resets_at` or `prompt_cache.expires_at` boundary, and optionally `refreshInterval` (≥1 s).
- Updates are debounced at 300 ms, and an in-flight script is cancelled by a newer trigger.
- "Does not consume API tokens."

### 10. Other levers

- **Skill frontmatter `model` / `effort`** ([skills#frontmatter-reference](https://code.claude.com/docs/en/skills#frontmatter-reference)):
  - The `model` override lasts for the rest of the current turn and the session model resumes on the next prompt.
  - With `context: fork` it sets the forked subagent's model instead.
  - `effort` overrides the session level, but not `CLAUDE_CODE_EFFORT_LEVEL`.
  - This is the main way to pick a model and effort per task in the main thread.
- **`${CLAUDE_EFFORT}` substitution in skill bodies** (docs; binary `Kn.replaceAll("${CLAUDE_EFFORT}",…)`).
- **SessionStart `reloadSkills`** re-scans skills after the hook, so a router can install or refresh skills at session start.
- **UserPromptExpansion** fires when a user types `/skill` directly, which PreToolUse(Skill) misses. It can block or add context, and matches on `command_name`.
- **`opusplan`** uses Opus in plan mode and Sonnet in execution. Each flip fires PostModelSwitch and starts the new model on a cold cache.
- **`ultrathink`** keyword: adds an in-context instruction for one turn. The API effort is unchanged.
- **Advisor tool:** consults a second model mid-task (see [model-config#opusplan-model-setting](https://code.claude.com/docs/en/model-config#opusplan-model-setting)).
- **Cache cost of routing** ([prompt-caching](https://code.claude.com/docs/en/prompt-caching)):
  - Each model has its own cache, so any main-thread model switch, including a skill `model`, re-reads the whole conversation uncached.
  - An effort change keeps the cache on Opus 5.5, Sonnet 5.5 and Fable 5.1 with an API key or subscription. On other models and on Bedrock, Vertex and gateways it recomputes the whole request.

## Open questions

1. Hot-reload, by live test: does an edit to `modelSettings`, `fallbackModel` or `maxEffortLevel` reach a running session? The binary and docs say no for effort and model, but no auth was available in a throwaway config dir.
2. In-harness hook overhead. Use `--debug` `hook_duration_ms` against the measured shell components.
3. Does a skill's frontmatter `model` fire PreModelSwitch and PostModelSwitch?
4. End-to-end check that rewriting PreToolUse `updatedInput.subagent_type` to a tiered agent applies that agent's `effort`. Confirm via `/tasks` or `resolvedModel`.
5. Does UPS `sessionTitle` add any tokens? Probably not.

## Sources

**Docs**, fetched 2026-10-01 as `.md`:
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/settings-reference
- https://code.claude.com/docs/en/statusline
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/cli-reference
- https://code.claude.com/docs/en/env-vars
- https://code.claude.com/docs/en/prompt-caching

**Binary** `/Users/phil/.local/share/claude/versions/2.1.286`. Greps were run with `strings -n 6` and `rg -a`. Key hits:
- `hook_system_message:()=>[]`, `hook_cancelled:()=>[]`, `hook_non_blocking_error:()=>[]`: API normalizer table
- `case"hook_success":if(e.hookEvent!=="SessionStart"&&e.hookEvent!=="UserPromptSubmit"&&e.hookEvent!=="UserPromptExpansion")return[]`
- `hook_additional_context:(e)=>…ol(`${e.hookName} hook additional context: …`)`
- `case"async_hook_response":… g.push(Re({content:b,isMeta:!0}))`: async `systemMessage` goes into context
- `function kc(e,n,r,s){… D=h&&s?.getAppState&&fw(h)?{level:pA(h,b,w)}:void 0 …}` and the UPS call sites `{...kc(e,oe(),s),hook_event_name:"UserPromptSubmit",…}`
- `function Ete(e){return{sessionId:e.session_id,effortLevel:e.effort?.level,source:"harness"}}`, `if(e.effortLevel!==void 0)n.CLAUDE_EFFORT=e.effortLevel`
- Agent schema `model:U(["sonnet","opus","haiku","fable"]).optional()`, with no `effort`
- `n.inputSchema.safeParse(be.updatedInput)… filter((Pe)=>Pe.code!=="unrecognized_keys")`
- `function tft(e){let n={sessionEffort:se(zKn(e)),settingsEffortTable:z()};…}`, with startup-only callers
- statusline builder `…context_window:HTe(ze,$e),exceeds_200k_tokens:r,…fw(Pe)&&{effort:{level:pA(Pe,ke)}},thinking:…,rate_limits:Qe…`

**Measurements:** Python `subprocess` timing on this machine, 2026-10-01.
