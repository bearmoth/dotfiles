# Modes extension — future ideas

Living document. Revisit, refine, implement, or abandon. Keep entries short.

## ORCHESTRATE mode (was: LEAD)
Fully designed — see [ORCHESTRATE-SPEC.md](./ORCHESTRATE-SPEC.md) and
docs/adr/0001–0004. Renamed LEAD → ORCHESTRATE. Sync v1: role-typed
dispatch (implementor/researcher/reviewer), read-everything/write-nothing
orchestrator, manual rework gate. Excluded from shift+tab cycle (separate
CYCLE_ORDER when implementing).
- Status: designed, awaiting implementation. Check for friction with EOS
  features before/while implementing.

## Orchestrate: deferred to the async pass
- Async dispatch: task ids, status tool, parallel workers, worker counts
  and per-role states in the footer, auto-rework-loop with max-iterations.
- Interactive workers via herdr workspaces (refiner is the motivating
  case; herdr's blocked-state plumbing already exists). Worker lifetime
  across feedback cycles is the open question.
- Planner role: needs an "explore-plus-one-path" permission shape; belongs
  with a roles-as-config refactor. Trigger: running multiple workstreams
  in parallel (in-conversation planning doesn't scale to that).
- Per-repo QA/check config (how to run tests/lint deterministically before
  review) — folds into per-repo policy config below.
- Status: recorded during the Orchestrate design pass.

## Subagent dispatch / cross-repo delegation
Model-facing escape hatch for out-of-scope work: instead of widening scope
(/allow-dir is user-only), delegate to a child pi in the other repo's cwd
with that repo's own trust/guardrails. Base: examples/extensions/subagent/,
`pi -p`. Never give the model an allow-dir tool.
- Status: idea; /allow-dir (user-invoked) shipped as the interim hatch.

## Inline sigil capture (mid-prompt commands)
`input` event handler strips `%%...%%`-style directives from prompts before
the model sees them (decided: model never sees directives); v1 is pure
capture (append to a fixed inbox file), no dispatch, no LLM. Leading sigil
candidate: line-leading `%%`. Inbox location is an open design question:
user has multiple vaults, and long-term the sigil grammar likely routes to
destinations/actions beyond note capture (verb → handler map, e.g.
`%%investigate:`, `%%todo:`, later dispatch verbs) — so the inbox should be
owned by the modes/eos config layer, not hardcoded to one vault. Parked
until the routing design pass.
- Open: multi-session concurrency (append-only + timestamps — only a
  concern if dispatch/consumption is added later), UI acknowledgement
  shape (v1: ctx.ui.notify).
- Security: the handler must treat directive contents as opaque text — never
  eval, never expand into commands; capture-only until a real design pass.
- Status: idea, discussed at length; v1 scope agreed (capture only).

## Per-repo policy config
Repo-level overrides for gates, e.g. force-push allowed in personal vault
repos but gated in shared repos. Likely `.pi/modes.json` in-repo (trusted
projects only) layered over `~/.pi/agent/modes.json`.
- Status: idea.

## Sensitive-file deny/ask list (#3 from guardrail review)
Block/ask on reading `.env*`, key material, credentials in all modes
(EXPLORE included — read-only mode can still exfiltrate secrets to context).
Tiers: deny / ask / allow; config in modes.json.
- Status: agreed in principle, not implemented.

## Containment for bash writes
Current containment covers write/edit tools only; bash in EDIT/YOLO can
still write outside cwd (e.g. `cp x ~/elsewhere`). Deterministic bash path
analysis is hard; options: reuse the EXPLORE classifier to *flag* (not
block) out-of-tree writes, or accept as a documented gap until
containerization.
- Status: known gap.

## Containerized YOLO
True autonomous mode: pi in Docker/devcontainer with repo mounted (see
docs/containerization.md); YOLO becomes genuinely safe, host YOLO keeps the
hard floor.
- Status: long-term strategy, user to investigate.

## Prompt-injection content heuristics
Scanning tool results for injection attempts. Parked: high false positives,
arms race; effect-gating already caps damage.
- Status: parked deliberately.
