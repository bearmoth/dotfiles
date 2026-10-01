# Research: pi routing levers (model / effort / skills / footer) and their cost

Issue: [bearmoth/dotfiles#47](https://github.com/bearmoth/dotfiles/issues/47) (child of map issue #44)
pi version read: `@earendil-works/pi-coding-agent` 0.84.3 (installed). Date: 2026-10-01.

## Question

Which routing levers work in the installed pi, and what do they cost? The goal is a decision
layer: an external CLI that the `modes` extension shells out to. It would pick the model and
thinking level per prompt, pick the `{model, effort}` tuple per dispatch, trim the skill
catalogue, and show degraded state in the footer at zero token cost.

## Method

This was mostly source reading. pi was never run against `~/.pi` or with Phil's auth. Sources:

- **Installed package.** `PI=/Users/phil/.local/share/npm/lib/node_modules/@earendil-works/pi-coding-agent`.
  Files: `dist/core/agent-session.js`, `dist/core/extensions/{runner,loader,types.d.ts}`,
  `dist/core/{sdk,exec,skills,system-prompt,cache-stats,messages,model-registry}.js`,
  `dist/modes/{print-mode,interactive/interactive-mode}.js`, the bundled
  `node_modules/@earendil-works/pi-agent-core/dist/{agent,agent-loop}.js` and
  `node_modules/@earendil-works/pi-ai/dist/{api,providers,auth/oauth}/…`, and the shipped
  docs `docs/extensions.md` and `docs/providers.md`. These docs are the same docs/ tree as
  https://github.com/earendil-works/pi.
- **Worktree extension.** `private_dot_pi/private_agent/extensions/` (`modes/*.ts` and `ui-plus.ts`)
  in this branch.
- **Three local measurements, all read-only or throwaway:**
  - Skill-catalogue size: called pi's own `loadSkills` + `formatSkillsForPrompt` from a node script.
  - Spawn latency: ran pi's own `execCommand` against `node -e ''`, `/usr/bin/true` and `sh -c true`.
  - `execCommand` timeout and ENOENT behaviour.
- **GitHub Copilot billing docs** (docs.github.com, fetched 2026-10-01). These came through a
  summarising fetcher, so the quoted sentences are paraphrase-grade. The price table was
  cross-checked against pi's catalogue (see L2).

Paths below starting with `PI/` are relative to the installed package. `AI/` means
`PI/node_modules/@earendil-works/pi-ai/dist` and `CORE/` means
`PI/node_modules/@earendil-works/pi-agent-core/dist`. `EXT/` means
`private_dot_pi/private_agent/extensions` in this worktree.

## Verdict

- **Every lever works mechanically.** An `input` handler can call `pi.setModel` and
  `pi.setThinkingLevel`, and the change applies to the same prompt. `before_agent_start` can
  replace the system prompt per turn. `context` can rewrite messages. `setStatus`/`setFooter`
  render at zero token cost. `pi.exec` adds about 30 ms for a bare node spawn.
- **The real cost is prompt-cache invalidation, not tokens or latency.** Every cache hint pi
  sends is prefix-based. A model switch starts a cold cache on the target model, and a changed
  system prompt (a trimmed skill list) misses the whole conversation.
- **Per-prompt switching and per-turn trimming lose money on long sessions.** Under the
  token-priced Copilot AI-credit billing, they cost more than they save. Decide once, at
  session start or on a phase change, and then hold the choice.
- **Per-dispatch tuple selection is nearly free.** Each worker is a fresh process with its own
  cold cache anyway. This is the best place for the selector.
- **Two blockers to fix first:**
  - The live footer (`ui-plus.ts`) renders only the `mode` status key, so a new status glyph
    would be invisible.
  - The router's `input` hook would also fire inside dispatched `pi -p` workers and override
    resolveTuple's `--model`. It needs a mode-locked guard.

## Lever table

| # | Lever | Verified | Mechanism | Cost | Latency | Notes |
|---|---|---|---|---|---|---|
| L1 | `pi.setModel` + `pi.setThinkingLevel` from `input` | **yes** (source) | Writes `agent.state.model`/`thinkingLevel` before `agent.prompt()` snapshots the loop config | 0 tokens. One `model_change` (+ `thinking_level_change`) session entry per switch. A cold prompt cache on the target model | setModel awaits `checkAuth`. Negligible | Call setThinkingLevel **after** setModel, because setModel resets effort. Returns false only on missing provider auth |
| L2 | Copilot mid-session switch | **partial** | pi sends no model-specific cache key, but caches are per-model and prefix-based | Token billing: a full re-read of the context as uncached input (+ cache-write premium on Anthropic models). Legacy request billing: 1 request × the model multiplier per user prompt; the switch itself is free | n/a | Which billing Phil's plan uses is UNVERIFIED. `X-Initiator` header set per request |
| L3 | `input` event transform/handled | **yes** | `continue` / `transform` (text+images) / `handled`. The transformed text is what is expanded and sent | 0 tokens. Added text counts as normal user tokens | Awaited inline, no timeout. No spinner until `agent_start` | Fires for `-p` workers too. Check `source` and `streamingBehavior` |
| L4 | `before_agent_start` systemPrompt replace / skill trim | **yes** | Return `{systemPrompt}`. Chained across extensions and reset to base each prompt | The full catalogue is about 16.2k chars ≈ 4k tokens (30 visible skills). Trimming saves about $0.004/turn cached on fable-5. Changing the trim costs a full cache rewrite | ~0 | Feasible only as decide-once-and-hold |
| L5 | `context` rewrite / `session_before_compact` | **yes** | `context` gets a `structuredClone` deep copy; return `{messages}`. Compact: `{cancel}` or `{compaction}` | Mid-history edits break the cache prefix from the edit point | ~0 | The existing mode-context filter already causes a small recurring miss |
| L6 | Footer/status glyph | **partial** | `ctx.ui.setStatus(key,text)` → footer re-render. `setFooter`, `setWidget` | 0 tokens | Immediate | `ui-plus.ts:220` shows only `statuses.get("mode")`. Needs a one-line change |
| L7 | Per-turn cost/usage | **yes** (Copilot quota: partial) | `message.usage` {input, output, cacheRead, cacheWrite, reasoning?, cost} on assistant messages. `turn_end`. `after_provider_response` {status, headers} | 0 | 0 | `getSessionStats` is RPC-only. pi does not read Copilot quota; `ui-plus.ts` does (undocumented endpoint) |
| L8 | `pi.exec` shell-out | **yes** (measured) | `spawn(cmd,args,{shell:false, stdio:[ignore,pipe,pipe]})`, `{signal,timeout,cwd}` | 0 tokens | `node -e ''` p50 31.7 ms; `/usr/bin/true` p50 5.5 ms (M3 Pro, node 24) | stdin ignored, so pass input by argv or a file. **A timeout returns `code:0, killed:true`** |
| L9 | Dispatch selector seam in `resolveTuple` | design only | A new `TupleSource` value `"selected"`, with the shell-out in the async dispatch execute | 0 (worker caches are cold anyway) | One exec per dispatch | Off-list picks must still resolve as `override` |
| L10 | `model_select` / `thinking_level_select` | **yes** | Notification events. **No veto** | 0 | 0 | `pi.setModel` and `/model` both emit `source:"set"`, so the router cannot tell its own switch from the user's |

## Detail per lever

### L1 — `setModel` / `setThinkingLevel` from an `input` handler

**Ordering in `AgentSession.prompt()`** (`PI/dist/core/agent-session.js:795-923`):

1. Extension `/commands` run first (`:802-808`).
2. **`input` is emitted and awaited** (`:816-827`).
3. Skill and template expansion (`:829-832`).
4. If streaming, the text is queued as steer/followUp and the method returns (`:834-845`).
5. The model is validated (`this.model`), then auth (`:849-862`).
6. **`_checkCompaction(lastAssistant)`** runs (`:866-869`).
7. The user message is built and **`before_agent_start`** is emitted (`:888`).
8. The system prompt override is applied (`:904-912`).
9. `_runAgentPrompt` → `agent.prompt()` (`:747-760`, `:922`).

`agent.prompt()` snapshots `model: this._state.model` and
`reasoning: this._state.thinkingLevel` into the loop config at call time
(`CORE/agent.js:272, 287-292`). That snapshot is passed to `streamFunction(config.model, …)`
(`CORE/agent-loop.js:194`), and `onPayload` → `before_provider_request` fires inside that
provider call (`PI/dist/core/sdk.js:208-214`).

The full order is therefore `input` → `before_agent_start` → `context` (transformContext,
`agent-loop.js:181-182`) → `before_provider_request`. A model or effort set in `input` (or in
`before_agent_start`) **applies to that prompt's first provider request**.

Mid-run turns also pick up later changes. `prepareNextTurnWithContext` re-reads
`agent.state.model`/`thinkingLevel` after every `turn_end` (`agent-session.js:272-290`,
`agent-loop.js:138-149`).

**What `setModel` does** (`agent-session.js:1201-1217`):

- `checkAuth(provider)` throws `No API key for …` if auth is missing.
- It sets `agent.state.model` and appends a `model_change` session entry.
- It **resets the thinking level** via `_getThinkingLevelForModelSwitch`. That returns the
  per-model setting, else `defaultThinkingLevel` (Phil: `"high"`), else the current level
  (`:1339-1351`).
- It emits `model_select` with source `"set"`.

So the order inside a handler must be `await pi.setModel(m); pi.setThinkingLevel(level)`.
`setThinkingLevel` clamps to the model's supported levels and appends a
`thinking_level_change` entry only when the level changes (`:1290-1310`).

**When `pi.setModel` returns false.** The extension wrapper returns `false` only when
`!hasConfiguredAuth(model.provider)` (`agent-session.js:1975-1980`; documented at
`PI/docs/extensions.md:1686-1698`). The check is provider-level, not model-level. A model that
the Copilot account has not enabled passes this check and fails later at request time. If the
inner `checkAuth` throws, the error propagates from the handler, and `emitInput` catches it as
an extension error. The prompt then proceeds on whatever model state exists
(`runner.js:946-953`).

**Getting a Model object from an id:**

- `ctx.modelRegistry.find(provider, id)` delegates to `runtime.getModel`
  (`PI/dist/core/model-registry.js:24-26`). This is the catalogue lookup.
- `ctx.modelRegistry.getAvailable()` returns `runtime.getAvailableSnapshot()` (`:21-23`). That
  is the auth- and account-filtered set. The Copilot provider filters by the account's
  `availableModelIds` (`AI/providers/github-copilot.js:18-27`).
- A selector should resolve ids against `getAvailable()`, not only `find()`.
- `step-config.ts` currently reads `~/.pi/agent/models-store.json` directly
  (`EXT/modes/step-config.ts:139-163`).

**Side-effects to know:**

- Every switch persists entries into the session file, so a resumed session restores the last
  routed model.
- The switch fires `model_select`. `ui-plus.ts` force-refetches Copilot quota on every
  `model_select` (`EXT/ui-plus.ts:258`), which is one HTTPS call per switch.
- **Compaction interaction.** `_checkCompaction` runs *after* `input` and uses
  `this.model.contextWindow` (`agent-session.js:1567`). If the router switches to a
  smaller-window model, threshold compaction can trigger on that same prompt. The selector
  should take `ctx.getContextUsage()` as an input.

### L2 — GitHub Copilot: cache and billing on a mid-session switch

**How pi builds Copilot requests:**

- **APIs.** The provider speaks three APIs (`AI/providers/github-copilot.js:28-32`). Claude
  4.x/5 models other than fable go over `anthropic-messages`. `claude-fable-5`, gemini, kimi and
  gpt-4.1 go over `openai-completions`. gpt-5.x goes over `openai-responses` (catalogue
  `AI/providers/data/github-copilot.json`).
- **Dynamic headers** (`AI/api/github-copilot-headers.js:3-27`):
  - `X-Initiator` is `"user"` when the last message is a user message, else `"agent"`.
  - `Openai-Intent: conversation-edits`.
  - `Copilot-Vision-Request` when images are present.
  - Custom messages (e.g. the modes extension's per-turn context) convert to role `user`
    (`PI/dist/core/messages.js:89-96`), so the first request of a prompt stays
    `X-Initiator: user`.
- **Cache hints by API:**
  - `anthropic-messages` adds `cache_control: {type:"ephemeral"}` to the system prompt, the
    last tool and the last user message (`AI/api/anthropic-messages.js:28-38, 728-769, 995-1011, 1047`).
  - `openai-responses` sends `prompt_cache_key = sessionId` (`AI/api/openai-responses.js:219`).
  - `openai-completions` sends `prompt_cache_key` only for `api.openai.com` or long retention
    (`AI/api/openai-completions.js:556-560`). On Copilot it relies on implicit prefix caching.
- **Nothing is model-specific in pi.** A switch does not change pi's cache keys. But provider
  KV caches are per-model and prefix-based, so the first request on the new model reads the
  whole context uncached. pi already attributes such misses: `cache-stats.js` records
  `modelChanged` per miss and prices it (`PI/dist/core/cache-stats.js:14-40`). That is the
  measurement hook for a router A/B.

**Billing has two regimes, and which applies to Phil is UNVERIFIED:**

- **Current docs: token-priced "GitHub AI Credits".** 1 credit = $0.01, and input, output and
  cached tokens are priced per model
  (https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing,
  https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
  - The published per-1M prices **match pi's catalogue `cost` fields exactly** for
    fable-5 (10/1/12.5/50), opus-5, sonnet-5, haiku-4.5 and gpt-5-mini. The one difference:
    GitHub lists a $0.25 cache write for gpt-5.6-luna, where pi has 0.
  - So pi's `usage.cost` is a good proxy for credits burned.
  - A switch then costs real money. Example: switching a 50k-token session onto fable-5
    costs about 50k × $12.50/M ≈ **$0.63** in cache writes, against about $0.05 for a cached
    read. That is roughly 13 cached fable turns.
  - The same docs say switching to a cheaper model "is one way to extend your usage
    allowance".
- **Legacy (request-based) docs.** "one premium request per user prompt, multiplied by the
  model's rate". Autonomous tool calls do not count
  (https://docs.github.com/en/copilot/concepts/billing/copilot-requests).
  - In this regime a switch costs only latency, and the multiplier of the model *in use for
    that prompt* is what counts. Per-prompt routing to cheap models then saves requests
    directly.
  - `X-Initiator` is presumably how Copilot tells user prompts from agent follow-ups.
    UNVERIFIED from GitHub's side.
- **Deciding signal.** `ui-plus.ts` already fetches
  `https://api.github.com/copilot_internal/user` and reads
  `quota_snapshots.premium_interactions.{credits_used, percent_remaining, unlimited}`
  (`EXT/ui-plus.ts:46-66`). The field name `credits_used` hints at the credit regime, but this
  research did not call it, so it remains UNVERIFIED.
- **pi docs on Copilot** cover only login and "enable model in VS Code"
  (`PI/docs/providers.md:37-40`). Nothing about premium requests.

### L3 — `input` event

**Types** (`PI/dist/core/extensions/types.d.ts:642-663`):

- The event carries `{text, images?, source: "interactive"|"rpc"|"extension", streamingBehavior?: "steer"|"followUp"}`.
- The result is `{action:"continue"} | {action:"transform", text, images?} | {action:"handled"}`.

**Runner semantics** (`PI/dist/core/extensions/runner.js:930-965`):

- Handlers run sequentially and transforms chain.
- `handled` short-circuits.
- A thrown handler is reported and skipped.

**The transformed text is what the model sees.** It replaces `currentText` before skill and
template expansion and becomes the user message content (`agent-session.js:822-832, 873-879`).
Docs: `PI/docs/extensions.md:891-940`.

**Async.** Handlers are `await`ed with **no timeout**. During the await:

- `isStreaming` is false.
- No `agent_start` has fired, so the working spinner is not shown yet
  (`interactive-mode.js:2577-2580`).
- The user's message is not rendered yet (`message_start` comes later).
- The editor has been cleared, and further submissions queue in `pendingUserInputs`
  (`interactive-mode.js:2548-2553, 3154-3164`).

A 30-100 ms exec is imperceptible. Anything longer needs the extension's own feedback, such as
a `setStatus` glyph, and a hard `timeout` on `pi.exec` with fail-open.

**Guards a router must apply:**

- **Workers.** `-p` workers call `session.prompt(message)` with the default source
  `"interactive"` (`PI/dist/modes/print-mode.js:105-108`). They load the same extensions, since
  `--op-mode` is an extension flag (`EXT/modes/index.ts:231`). Without a guard, the router
  would override the `--model`/`--thinking` that `dispatch.ts` passed (`EXT/modes/dispatch.ts:410-415`).
  Skip when `modeLocked` or `PI_WRITE_FENCE` is set.
- **Extension input.** Skip `source === "extension"` (sendUserMessage).
- **Streaming input.** Skip any defined `streamingBehavior`. A model switch there would apply
  at the next turn of the *running* loop (L1).

### L4 — `before_agent_start` and the skill catalogue

**Result shape.** `{ message?, systemPrompt? }` (`types.d.ts:830-834`).

- `systemPrompt` replaces the prompt for this prompt only.
- It chains across handlers; `event.systemPrompt` and `ctx.getSystemPrompt()` reflect the
  chain (`runner.js:837-889`).
- If no handler returns one, the base prompt is restored (`agent-session.js:904-912`), and the
  override is cleared after the run (`:755-757`).
- `event.systemPromptOptions.skills` exposes the loaded skill objects (`PI/docs/extensions.md:530-560`).

**Today's injection.** `buildSystemPrompt` appends `formatSkillsForPrompt(skills)` only when the
`read` tool is active (`PI/dist/core/system-prompt.js:27-30, 112-114`). The format
(`PI/dist/core/skills.js:275-296`):

- A 3-line preamble.
- Then `<available_skills>` with one `<skill><name/><description/><location/></skill>` per
  skill whose `disableModelInvocation` is false, XML-escaped.

**Sources:**

- The `skills` setting. `EXT/../modify_settings.json:30` manages `["~/.claude/skills"]`. Note
  that the deployed `~/.pi/agent/settings.json` currently lacks the key, so it is not yet
  applied on this machine.
- Plus auto-discovered `~/.pi/agent/skills`, `~/.agents/skills` and project
  `.pi/skills`/`.agents/skills` (`PI/dist/core/package-manager.js:1966-2017`).
- Duplicates are removed by realpath.

**Measured with pi's own functions** (cwd = chezmoi source; sources = defaults +
`~/.claude/skills` + `~/.agents/skills`):

| Measure | Value |
|---|---|
| Loaded skills | 53 |
| Model-visible skills | 30 |
| Catalogue size | 16,209 chars ≈ **4.0k tokens** (chars/4 heuristic) |
| Defaults only (without `~/.claude/skills`) | 13 visible skills, 5.1k chars ≈ 1.3k tokens |
| Largest entries | pptx, google-workspace, xlsx, docx (about 1.1k chars each) |
| Median entry | about 365 chars |
| Name collisions (winner = first loaded) | 21 |

**Feasibility.** A handler can rebuild the prompt as
`event.systemPrompt.replace(fullCatalogue, formatSkillsForPrompt(subset))`. `formatSkillsForPrompt`
is exported from the package root (`PI/dist/index.js:26`). The alternative is to rebuild from `systemPromptOptions`.

**Economics.** The system prompt is the head of every cache prefix, so any change to the
trimmed set rewrites the cache for the whole context.

- A stable 4k block costs about $0.004/turn cached on fable-5 ($0.0008 on luna).
- A single change at 50k context costs about $0.63 on fable-5.
- **Trim once per session, or per mode change, and keep it fixed.**
- An alternative that avoids prompt mutation: put skills the router wants hidden behind
  `disable-model-invocation` (`skills.js:276`). That is a static, zero-churn trim.

### L5 — `context` and `session_before_compact`

**`context` event:**

- It fires before every LLM call, inside the loop (`CORE/agent-loop.js:181-182`; `sdk.js:226-232`).
- `emitContext` passes a **`structuredClone`** of the messages. Handlers chain by returning
  `{messages}` (`runner.js:747-773`). Mutation is therefore safe for session state; only the
  outgoing request changes.
- Docs: `PI/docs/extensions.md:657-667`.
- Safety rules:
  - Keep the tool-call/tool-result pairing intact.
  - Keep role ordering valid for the provider.
  - Do not edit history behind the latest cache breakpoint.
- The existing modes filter (`EXT/modes/index.ts:688-699`) drops the previous turn's
  `mode-context-*` message every prompt. That changes the prefix at the start of the previous
  turn, causing a recurring partial cache miss of about one turn's worth of tokens.
  `cache-stats.js` would show it. It is not a router blocker, but it is a known cost.

**`session_before_compact`:**

- The event carries `{preparation, branchEntries, customInstructions?, reason: manual|threshold|overflow, willRetry, signal}`
  (`types.d.ts:442-453`).
- Return `{cancel:true}` or `{compaction:{summary, firstKeptEntryId, tokensBefore, usage?, details?}}`
  (`types.d.ts:842-845`; `PI/docs/extensions.md:452-490`). The runner returns early on `cancel`
  (`runner.js:589-593`).
- Hook sites: `agent-session.js:1422, 1683`.
- A router could cancel threshold compaction when it is about to switch to a larger-window
  model. Do not cancel `overflow`, because the turn will not retry.

### L6 — Footer / status glyph

**`ctx.ui` surface** (`types.d.ts:68-130`):

- `setStatus(key, text|undefined)`
- `setWidget(key, lines|factory, {placement})`
- `setFooter(factory(tui, theme, footerData))`
- `setWorkingMessage` / `setWorkingIndicator` / `setWorkingVisible`
- `notify`, `setTitle`, `custom`, …

In TUI mode, `setStatus` stores the text and calls `requestRender()`
(`interactive-mode.js:1653-1656, 1916`). The footer factory reads
`footerData.getExtensionStatuses()` each render. This is all local rendering, with **zero
token cost**. Docs: `PI/docs/extensions.md:2566-2620`.

**The live footer is `ui-plus.ts`, not `modes/footer.ts`.**

- `installPaddedFooter` is commented out ("ui-plus.ts owns the footer now",
  `EXT/modes/index.ts:535`).
- `modes/footer.ts` would render *all* status keys, sorted (`footer.ts:91-99`).
- `ui-plus.ts` renders **only** `getExtensionStatuses().get("mode")` on line 2
  (`EXT/ui-plus.ts:220`).

A `setStatus("route", "◐")` would therefore be invisible. There are three minimal options:

- (a) Add `statuses.get("route")` next to the mode status in `ui-plus.ts`.
- (b) Have `modes/index.ts:updateStatus` append the glyph to the `mode` text (`index.ts:177-189`).
- (c) Use `setWidget` with `placement: "belowEditor"`.

Option (a) is the cleanest. ui-plus already renders model and thinking on the right of line 2,
so the routed model shows up automatically.

### L7 — Per-turn cost and usage exposure

**Message usage.** Assistant messages carry `usage` with these fields
(`AI/types.d.ts:265-286`):

- `input`, `output`, `cacheRead`, `cacheWrite`
- `cacheWrite1h?`, `reasoning?`
- `totalTokens`
- `cost{input, output, cacheRead, cacheWrite, total}`

Cost is computed from the catalogue rates, which for Copilot equal GitHub's credit prices (L2).

**Events:**

- `turn_end` carries `{turnIndex, message, toolResults}` (`types.d.ts:570-575`).
- `message_end` can even rewrite usage/cost (`PI/docs/extensions.md:600-625`).
- `after_provider_response` carries `{status, headers}` before the body is consumed
  (`sdk.js:215-225`; `types.d.ts:533-537`). Whether Copilot returns quota or credit headers
  there is UNVERIFIED; no live call was made.

**`get_session_stats` is RPC-only.** It is `rpc-mode.js:465-467` → `AgentSession.getSessionStats()`
(`agent-session.js:2580-2625`). It is **not** on `ExtensionContext`, which offers
`getContextUsage()` (`types.d.ts:244`). Extensions add up `ctx.sessionManager.getEntries()`
themselves, as `ui-plus.ts:178-190` and `footer.ts:51-59` do.

**Copilot quota.** pi itself only reads `/models` for `availableModelIds` and discards
everything else (`AI/auth/oauth/github-copilot.js:64-98, 129-145`). Quota is visible only
through ui-plus's `copilot_internal/user` fetch (undocumented endpoint, 60 s throttle,
`EXT/ui-plus.ts:46-81`). A router can read the same value cheaply by sharing that cached
`quota` rather than refetching.

### L8 — `pi.exec` shell-out

**Signature.** `pi.exec(command, args[], {signal?, timeout?, cwd?}) → Promise<{stdout, stderr, code, killed}>`
(`types.d.ts:976`; `PI/dist/core/exec.d.ts:7-28`). The loader binds `cwd` to the session cwd
by default (`PI/dist/core/extensions/loader.js:320-323`).

**Implementation** (`PI/dist/core/exec.js:10-74`):

- `spawn` with `shell:false` and **`stdin: "ignore"`**. A prompt must go by argv (macOS ARG_MAX
  is about 1 MB) or by a temp file path.
- Timeout and abort send SIGTERM, then SIGKILL after 5 s.

**Gotchas, measured:**

- A timed-out `sleep 5` with `timeout:200` resolved
  `{"code":0, "killed":true}`, because a signal exit gives `code ?? 0`.
- A nonexistent binary resolved `{"code":1, "stderr":""}`.
- **Callers must check `killed` and validate stdout (e.g. parse JSON), never trust `code`
  alone.**

**Latency** (Apple M3 Pro, node v24.14.1, 15 runs through pi's own `execCommand`):

| Command | min | p50 | max |
|---|---|---|---|
| `node -e ''` | 28.2 ms | 31.7 ms | 34.1 ms |
| `sh -c true` | 8.5 ms | 9.4 ms | 16.1 ms |
| `/usr/bin/true` | 5.0 ms | 5.5 ms | 193 ms (one outlier) |

The real CLI's own startup (module loading, config parsing) comes on top and is UNVERIFIED. A
compiled binary (Go/Rust/bun-compiled) stays at about 5-10 ms. `child_process` directly is
equivalent; `dispatch.ts` already uses `spawn` (`EXT/modes/dispatch.ts:13, 447`).

### L9 — Dispatch seam (proposal only, not implemented)

**Current flow:**

- `dispatch.ts:383-399` calls the synchronous `resolveTuple(step, {overrideModel, overrideEffort, strategy})`
  (`EXT/modes/step-config.ts:99-132`).
- It then maps the result into `DispatchRouting` and pushes `--model/--thinking` (`dispatch.ts:410-415`).
- `TupleSource = "default"|"fallback"|"alternative"|"override"` is at `step-config.ts:61`.
  `DispatchRouting.source` duplicates it, adding `"role-default"` (`dispatch.ts:82`).
- The panel renders `default`/`role-default` dim and *every* other source as a `⚠` warning, red
  for override (`EXT/modes/dispatch-panel.ts:232-240`).

**Minimal seam:**

1. **step-config.ts.** Extend the type to `TupleSource = … | "selected"`. Add
   `ResolveOptions.selected?: { model, effort, reason }`. In `resolveTuple`, after the explicit
   override branch and before the default:
   - If `selected` is present and the tuple equals the default, return `"default"`.
   - If it is in `def.allowed` and available, return `"selected"`.
   - Otherwise treat it exactly like an override. It resolves as `"override"` and keeps the
     existing user-approval rule, so the selector can never bypass the allow-list.
   - An unavailable selection falls through to the normal default → fallback chain, which also
     makes the tuple degraded.
   - `resolveTuple` stays pure and sync.
2. **dispatch.ts.** In the async execute, before calling `resolveTuple` and only when no
   explicit `params.model`/`effort` is given, run
   `await pi.exec(selectorCli, ["dispatch", "--step", step, "--brief-file", tmp], {timeout: 300})`.
   - Parse its JSON.
   - On failure, `killed`, or parse error, pass `selected: undefined` and mark the routing
     degraded. Fail open to the static table.
   - Add `"selected"` and an optional `reason` to `DispatchRouting`.
3. **dispatch-panel.ts.** Render `selected` as a neutral/accent line showing the reason, not
   as `⚠`. Keep `⚠` for fallback, alternative and override.

**Cost.** A worker is a fresh process with a cold cache regardless of model, so per-dispatch
selection adds no cache penalty. Its only cost is one exec.

### L10 — `model_select` / `thinking_level_select`

**Payloads:**

- `model_select`: `{model, previousModel, source: "set"|"cycle"|"restore"}` (`types.d.ts:616-622`).
  It is emitted only when the model actually changes (`agent-session.js:1184-1193`).
- `thinking_level_select`: `{level, previousLevel}` (`types.d.ts:624-628`). It is fired with
  `void`, so it is not awaited (`agent-session.js:1302-1307`).

**No veto.** `runner.emit` keeps handler results only for `session_before_*` events
(`runner.js:579-608`). The docs call `thinking_level_select` "notification-only"
(`PI/docs/extensions.md:743-756`).

**Telling routed switches from user switches.** `/model` (interactive-mode.js:4011, 4142, 4734)
and `pi.setModel` both produce `source:"set"`. A router that wants to respect a user pin must
set a self-flag around its own `setModel` call. Any `model_select` it did not cause then means
"user pinned; stop routing".

**Docs gap.** The docs list only `/model`, cycling and restore as triggers
(`PI/docs/extensions.md:722-741`), but `pi.setModel` triggers it too.

## Open questions

1. **Which Copilot billing regime is Phil on?** Token AI credits or legacy request multipliers?
   This decides whether a cache loss costs money or only latency (L2). Check the
   `copilot_internal/user` payload, or GitHub billing settings.
2. **Does Copilot return quota/credit headers on completions?** That would make
   `after_provider_response` a zero-cost per-turn meter. UNVERIFIED: needs one logged
   response.
3. **How large is the real per-switch miss on Copilot?** Run `cache-stats` attribution on a
   real session with a deliberate switch before choosing per-prompt routing at all.
4. **The deployed settings lack the managed `"skills": ["~/.claude/skills"]` key.** Is that
   drift (the modify script not yet applied) or intentional?
5. **Selector CLI cold-start time** in its real implementation language (L8).

## Sources

- **Installed pi 0.84.3** (`/Users/phil/.local/share/npm/lib/node_modules/@earendil-works/pi-coding-agent`):
  - `dist/core/agent-session.js` — 272-290, 595-650, 747-760, 795-923, 956-990, 1184-1351, 1422, 1560-1640, 1683, 1960-2015, 2580-2625
  - `dist/core/extensions/runner.js` — 579-608, 747-773, 776-806, 837-889, 930-965
  - `dist/core/extensions/types.d.ts` — 68-130, 210-250, 442-453, 514-663, 795-845, 898-925, 960-990
  - `dist/core/extensions/loader.js` — 320-323
  - `dist/core/sdk.js` — 180-236
  - `dist/core/exec.js`, `dist/core/exec.d.ts`, `dist/utils/child-process.js`
  - `dist/core/skills.js` — 275-380
  - `dist/core/system-prompt.js` — 8-30, 112-114
  - `dist/core/resource-loader.js` — 500-520
  - `dist/core/package-manager.js` — 1966-2017
  - `dist/core/cache-stats.js` — 1-60
  - `dist/core/messages.js` — 89-96
  - `dist/core/model-registry.js` — 18-30
  - `dist/core/model-runtime.js` — 277-304
  - `dist/modes/print-mode.js` — 105-108
  - `dist/modes/interactive/interactive-mode.js` — 870-885, 2520-2580, 1653-1656, 1916, 3154-3164, 4011, 4142, 4734
  - `docs/extensions.md` — 452-490, 530-760, 891-940, 1650-1710, 2566-2620
  - `docs/providers.md` — 19-40
- **pi-agent-core** (`node_modules/@earendil-works/pi-agent-core/dist`): `agent.js` 226-315, `agent-loop.js` 120-200
- **pi-ai** (`node_modules/@earendil-works/pi-ai/dist`):
  - `api/github-copilot-headers.js`
  - `api/anthropic-messages.js` — 15-38, 355-370, 670-690, 728-769, 995-1011
  - `api/openai-completions.js` — 139-175, 515-560
  - `api/openai-responses.js` — 42-64, 96-100, 163-182, 213-221
  - `providers/github-copilot.js`, `providers/data/github-copilot.json`
  - `auth/oauth/github-copilot.js` — 60-145
  - `types.d.ts` — 265-286
- **Worktree** (`private_dot_pi/private_agent/`):
  - `extensions/modes/step-config.ts`, `dispatch.ts` (13, 82, 370-450), `dispatch-panel.ts` (220-250, 370-380), `dispatch-log.ts` (25-40)
  - `extensions/modes/index.ts` (123-127, 177-189, 231, 535, 668-699), `footer.ts`
  - `extensions/ui-plus.ts`
  - `modify_settings.json`
- **pi repo:** https://github.com/earendil-works/pi (docs/ tree as shipped in the package)
- **GitHub Copilot billing** (fetched 2026-10-01 through a summarising fetcher):
  - https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing
  - https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
  - https://docs.github.com/en/copilot/concepts/billing/copilot-requests (legacy)
- **Local measurements:** pi's own `loadSkills`/`formatSkillsForPrompt` and `execCommand`,
  called from throwaway node scripts (read-only; no pi session, no auth).
