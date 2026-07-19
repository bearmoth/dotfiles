# Research: symbiosis conventions deep-read

> Wayfinder ticket: [bearmoth/dotfiles#4](https://github.com/bearmoth/dotfiles/issues/4) (child of map #3)
> Source: `bearmoth/symbiosis` @ `main`, cloned read-only to `/tmp/symbiosis-ro` (`gh repo clone bearmoth/symbiosis /tmp/symbiosis-ro -- --depth 1`). Symbiosis is reference-only — nothing was written back to it.

## Question

How does `bearmoth/symbiosis` make its repo navigable to agents, and which of those patterns generalise to a personal, chezmoi-distributed, cross-repo "engineering OS" layer coordinating multiple Obsidian vaults and repos?

## Method

Read end-to-end: `docs/meta/{docs-strategy,conventions,docs-quick-ref,claude-context,glossary,meta}.md`, `docs/agents/{domain,issue-tracker,triage-labels}.md`, root `CLAUDE.md` / `AGENTS.md`, all six `.base` files, `.claude/settings.json`, `.claude/agents/vault-auditor.md`, the `docs-context` and `obsidian-cli` skills, `docs/guides/agent-orchestration.md`, plus a sample ADR (ADR-022), backlog item (backlog-tile-config), devlog (devlog-M1-first-steps), and the domain glossary.

---

## 1. The Three-Audience Entrypoint Pattern

Symbiosis names three distinct readers and gives each a tailored front door, all converging on the same underlying vault (`docs-strategy.md` §11):

1. **Humans** → `README.md` → `docs/home.md`
2. **Claude** → `CLAUDE.md` → `docs/meta/docs-quick-ref.md` → `docs/meta/claude-context.md`
3. **Other AI agents** → `AGENTS.md` → `docs/meta/docs-quick-ref.md`

`CLAUDE.md` and `AGENTS.md` are near-duplicates but not identical — `CLAUDE.md` carries Claude-specific mechanics (skill table, PR slicing, Bash CI check rules, sibling-consistency and convention-propagation rules, git hooks setup) while `AGENTS.md` is a leaner briefing for non-Claude agents. Both route to the same two docs (`docs-quick-ref.md`, `claude-context.md`) so there is exactly one source of truth for "what's the state" and "what are the rules" — only the framing/length differs per audience.

`claude-context.md` is explicitly **an index, not a content store** — a live rolling log of current focus, active specs, key decisions, with a strict "capture routing" table that says where new signals (decisions, ideas, backlog items, guides, user-doc changes) get filed *immediately*, without interrupting the current task.

## 2. Docs-That-Point-To-Docs ("Read This When X")

This is the dominant context-engineering pattern in the vault. Nearly every meta doc opens with a blockquote stating **when to read it** and **what NOT to use it for**:

- `docs-strategy.md`: *"the why... read when making structural decisions... quarterly reviews... Day-to-day doc-touching tasks use docs-quick-ref, not this doc."*
- `docs-quick-ref.md`: *"Required reading for any task that creates, edits, moves, or deletes documentation. Implementation-only tasks are exempt."*
- `domain.md`: *"Project state... is a separate concern handled by claude-context.md via docs-context — don't re-read it for domain vocabulary."*

This creates a **conditional-mandatory-reading graph** rather than a flat "read everything" instruction — each doc scopes its own applicability and explicitly defers to a sibling for adjacent concerns, which keeps any single required-reading path short. `CLAUDE.md` states the enforcement rule directly: *"Before any task that creates, edits, moves, or deletes documentation, you MUST read docs/meta/docs-quick-ref.md. Implementation-only tasks (code, tests, configs) are exempt. If unsure, read it."*

Enforcement is layered, not just declared (`docs-strategy.md` §12):
1. Conditional mandatory reading (above).
2. Skill preconditions — doc-touching skills declare "required reading: X §Y" and refuse to proceed without it.
3. CI as backstop for doc-shape rules.
4. A short (<100 line) quick-reference kept separate from the long rationale doc, so the "what" is cheap and the "why" is read on demand.
5. No duplicate rule copies across docs (duplication signals optionality).
6. Friction on bypass — skills detecting missing context refuse to proceed.

The repo also literally diagrams the document graph (`docs-strategy.md` §5):

```
                  AGENTS.md / CLAUDE.md
                          │
                          ▼
                      home.md
        ┌─────┬─────┬─────┴─────┬─────┬─────┐
        ▼     ▼     ▼           ▼     ▼     ▼
  architecture ideas decisions specs backlog roadmap
                │   │           │
                └───┼───────────┘
                    ▼
              crates/*/docs/* ◄────► src code (rustdoc)
```

with explicit **edge rules** (who links forward to whom, who is discovered only via backlinks, e.g. ideas never listed forward from system docs — only found as backlinks).

## 3. Taxonomy Vocabulary

### 3.1 Type tags (frontmatter, not inline)

Every note has **exactly one** `type/X` tag in YAML `tags:` frontmatter — never an inline `#type` body tag, never a custom `type:` field. Rationale given (`docs-strategy.md` §2): `tags:` has native Obsidian UI support (filter, graph colour, tag pane); a bespoke `type:` field is a second-class citizen in Bases/obsidian-cli/graph view.

Full type matrix (`docs-quick-ref.md`):

| Type | Tag | Required fields | Lives in |
|---|---|---|---|
| System | `type/system` | — | `crates/<crate>/docs/<system>.md` |
| Idea | `type/idea` | optional `touches:` | `crates/<crate>/docs/<system>.ideas/` or `docs/ideas/` |
| Archived | `type/archived` | `promoted-to:` OR `archived-reason:` | `<original>/archive/` |
| ADR | `type/adr` | `status`, `scope`, optional `crate`, `supersedes` | `docs/decisions/ADR-NNN-<slug>.md` |
| Spec | `type/spec` | `status`, `milestone`, optional `depends-on`, `impl-pr` | `docs/specs/<slug>.md` |
| Design sibling | `type/design` | — | `docs/specs/<slug>.design.md` |
| Cross-system architecture | `type/architecture` | — | `docs/architecture/<slug>.md` |
| Backlog | `type/backlog` | `status` | `docs/backlog/backlog-<slug>.md` |
| Milestone | `type/milestone` | `status`, optional `target-date`, `theme`, `specs` | `docs/milestones/milestone-<slug>.md` |
| Guide | `type/guide` | — | `docs/guides/<slug>.md` |
| User doc | `type/user-doc` | — | `docs/user-docs/<slug>.md` |
| Devlog | `type/devlog` | — | `docs/devlog/<slug>.md` |
| Glossary/Roadmap/Meta/Template | `type/{glossary,roadmap,meta,template}` | — | fixed paths |

Status vocabularies are type-scoped and small: ADR (`proposed·stable·deprecated`), Spec (`planned·in-progress·implemented·archived`), Backlog (`planned·in-progress·resolved·implemented`), Milestone (`planned·in-progress·implemented`).

**A hard "must not appear" list** is maintained (both in `docs-quick-ref.md` and duplicated in the `vault-auditor` agent for enforcement): `maturity`, `confidence`, `context`, `related`, `domain`, `created`, `updated`, frontmatter `type:` as a field. The stated principle (`docs-strategy.md` §1, principle 5): *"Minimum ceremony, maximum signal. Every metadata field must justify its existence by enabling a query that is actually run. Anything else is removed."* Section 13 lists categories they deliberately *removed* after finding they didn't earn their keep (`reference/`, `concepts/`, `tdd/`, per-crate ADR registries, most workflow fields).

### 3.2 The domain glossary as `CONTEXT.md` replacement

`docs/agents/domain.md` explicitly states this repo has **no standalone `CONTEXT.md` / `docs/adr/`** — `docs/glossary.md` (domain glossary) plays the `CONTEXT.md` role and `docs/decisions/` plays the `docs/adr/` role. Glossary entries follow a strict micro-format: **Definition. Usage. Contrast with: (the "avoid this synonym" list). Related: [[wikilinks]]**, grouped under domain headings (`goap`, `iso-grid`, `sim`, etc.) that are pre-approved in `claude-context.md` — *"New domains require approval here before being used in any frontmatter."* Agents are told explicitly: use the glossary's term, don't drift to a `Contrast with:` synonym; if a concept isn't in the glossary, that's a signal to either stop inventing vocabulary or add the term.

### 3.3 Two separate glossaries

There are deliberately **two** glossaries at different altitudes: `docs/meta/glossary.md` (vault/workflow vocabulary — what "spec", "parked", "EARS" mean) vs `docs/glossary.md` (domain vocabulary — what "Belief", "Facade", "Footprint" mean in the game itself). They cross-link but are never merged — meta-vocabulary about how the vault works is a different kind of thing from domain vocabulary about what the software does.

## 4. Obsidian Bases Replace Grep for Structural Queries

Six `.base` files (`systems.base`, `specs.base`, `decisions.base`, `backlog.base`, `ideas.base`, `archive.base`) are the **living indexes** — no hand-maintained index files. Principle stated directly (`docs-strategy.md` §1, principle 4): *"Indexes are queries, not files. Hand-maintained index files drift. Obsidian Bases queries always reflect reality."*

Every active Base shares one filter idiom:

```yaml
filters:
  and:
    - file.hasTag("type/spec")     # or type/system, type/adr, etc.
    - not:
        - /\/archive\//.matches(file.path)
views:
  - type: table
    groupBy: { property: status, direction: ASC }
```

`archive.base` is the sole exception — it filters *for* `type/archived` rather than excluding it, and is "queried only when investigating history." The **query-mechanism table** in `docs-strategy.md` §9 maps each question to its tool:

| Query | Mechanism |
|---|---|
| All docs of type X | `#X` via obsidian-cli or Base |
| ADRs scoped to a crate | `#adr` + `scope:/crate:` frontmatter |
| In-progress specs for a milestone | `#spec` + `status:/milestone:` |
| Backlinks of an ADR | obsidian-cli backlink query |
| Full-text search | obsidian-cli search (index-backed) |

Stated tool preference: **obsidian-cli for index-driven queries; grep only for raw content patterns that have no metadata equivalent.** This is the single clearest generalisable idea in the whole repo — agents are steered toward structured, tag/frontmatter-driven queries first, and toward text search only as a fallback for content that metadata can't express.

## 5. Issue Tracker & Triage Conventions

`docs/agents/issue-tracker.md` is a **per-repo adapter doc** for a generic external "skills" package (issue-tracker-agnostic skills like `/triage`) — it maps generic verbs ("publish to the issue tracker," "fetch the relevant ticket") onto concrete `gh` CLI incantations for this specific repo (GitHub Issues). It also encodes hard-won conventions: never close an issue manually before the fixing PR merges (the PR's `Closes #N` does it); infer repo from `git remote -v`; a documented **wayfinding protocol** for a "map issue + child tickets" pattern using GitHub's native sub-issues and issue-dependency APIs (`gh api .../dependencies/blocked_by`), including exact `jq`/`gh api` invocations for computing blocker status and claiming/resolving tickets.

`docs/agents/triage-labels.md` is a similarly generic **label-name adapter table** — maps five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`) used by generic skills onto this repo's actual label strings (which happen to be identical here, but the indirection exists precisely so they *don't* have to be).

Both files are tagged `type/meta` even though they live outside `docs/meta/` — documented explicitly as an intentional exception (`docs-quick-ref.md`): *"Agent-config docs (docs/agents/*.md) also use type/meta outside docs/meta/. They are per-repo configuration read by external engineering skills... not vault content."*

## 6. Rustdoc ↔ Vault Split ("How" vs "Why")

A crisp division of labour: rustdoc describes *how* (signatures, parameters, invariants) and never design rationale; the vault describes *why* and *how the system works as a whole*. Module-level `//!` doc comments carry a bare `See: crates/<crate>/docs/<system>.md` line (no backticks, no label prefix — `System doc:` etc. flagged as non-standard) linking code to its owning vault doc. Rustdoc updates are required to ship in the same commit as the API change that motivates them — this is a code-review gate, not a suggestion.

## 7. Enforcement Machinery Beyond Docs-as-Prose

Several mechanisms exist purely to make the conventions self-defending rather than aspirational:
- `.claude/settings.json` hooks: a `PreToolUse` hook on `Bash|Edit|Write` prints a nudge to load vault context; a `PreToolUse` hook on `git commit` asks "which docs describe the behaviour you just changed?"; a `Stop` hook prints a Done checklist; a `PostToolUse` hook on `Write|Edit` runs `.claude/scripts/validate-frontmatter.sh`.
- `.claude/agents/vault-auditor.md` — a dedicated, cheap (haiku-tier) sub-agent whose entire job is running `rg`/obsidian-cli conformance checks (type-tag presence, frontmatter field legality, orphan/archive-placement errors, wikilink collisions) and reporting drift — invoked periodically by a `docs-audit` skill, never auto-fixing.
- **Convention Propagation** rule in `CLAUDE.md`: introducing a new type tag or schema field requires updating three named files *in the same commit* (`docs-quick-ref.md` type matrix, `vault-auditor.md` valid-tags list, `AGENTS.md` Doc Types table) — named explicitly as "the root cause of most multi-round Copilot churn on doc PRs" when skipped.
- **Sibling Consistency** rule: touching one file in a structural group (all `.base` files, all skill files, all AI-context files) requires checking the others for the same gap.
- Pre-commit git hook (`core.hooksPath .githooks`) enforcing wikilink integrity.

## 8. Idea Lifecycle & Archival

Ideas follow an explicit state machine, not ad hoc deletion: promoted (into a system doc / new system / new spec) or rejected, and in both cases **physically moved** to an `archive/` subdirectory, re-tagged `type/archived`, and given `promoted-to:` or `archived-reason:` frontmatter plus a closing paragraph. Archived docs are excluded from every active Base by convention and agents are explicitly told never to treat `type/archived` docs as current state. Rationale: *"ideas are decision artifacts. The reasoning that produced a system is as valuable as the system itself."*

## 9. Agent-Orchestration / Dispatch-Matrix Guide

`docs/guides/agent-orchestration.md` is a distinct layer above the doc conventions: a model/effort **dispatch matrix** (which sub-agent tier for which task shape — haiku for mechanical, sonnet for default, opus for judgment calls), a unit-execution protocol (one unit = one branch = one PR, gate gates, close-out-before-merge), and explicit **stop-and-ask triggers** (scope creep beyond ~2x the named files, any harness/config change beyond the unit's explicit ask, RULE-CHANGE-flagged content, two failed fix attempts, deleting content you didn't author this session).

---

## 10. Classification Table

| # | Pattern | Classification | Notes / adaptation |
|---|---|---|---|
| 1 | Three-audience entrypoint (README→humans, CLAUDE.md→Claude, AGENTS.md→other agents, all converging on one source doc) | **ADAPT** | Personal layer has one primary agent (Claude) but multiple *vaults/repos* as audiences instead of multiple *agent brands*. Adapt to: a root routing file per vault/repo that always points to the same cross-repo "state" doc, rather than duplicating rules per repo. |
| 2 | `claude-context.md` as a live, capture-routed index (not a content store) | **GENERALISE-AS-IS** | Directly portable: a single "current state" note per vault/repo with a capture-routing table (decision→ADR, idea→ideas note, footgun→backlog, etc.) is domain-agnostic. This is the strongest single candidate for the personal layer's root note. |
| 3 | Docs-that-point-to-docs, each scoped with "read this when X / don't use this for Y" | **GENERALISE-AS-IS** | Pure context-engineering discipline — applies to any doc corpus, game or not. Adopt the blockquote convention (`> **When to read this:**...`) verbatim. |
| 4 | Conditional-mandatory-reading + skill-precondition + CI-backstop enforcement layering | **ADAPT** | The CI-backstop leg assumes a Rust/CI pipeline. For a dotfiles/notes layer without CI, the enforcement stack becomes: chezmoi apply hooks / git pre-commit + a lightweight lint script (frontmatter validator) instead of `just docs-check`. The hook nudges (`.claude/settings.json`) are directly reusable as-is. |
| 5 | One `type/X` tag per note in frontmatter `tags:`, never inline, never a bespoke `type:` field | **GENERALISE-AS-IS** | This is an Obsidian/Bases mechanical fact (tags get native UI treatment), not game-specific. Adopt directly for the personal vault(s). |
| 6 | Full type matrix + per-type required frontmatter fields + status vocab | **ADAPT** | The *mechanism* generalises; the *type list* (system/spec/ADR/backlog/milestone/devlog/user-doc) is tuned to a software project with milestones. A personal engineering-OS layer would define its own type list (e.g. `type/decision`, `type/project`, `type/note`, `type/reference`, `type/journal`) but keep the one-tag, small-status-vocab, no-`created/updated`-field discipline. |
| 7 | "Minimum ceremony, maximum signal" — every field must justify a query that is actually run; explicit list of removed categories | **GENERALISE-AS-IS** | This is a philosophy/heuristic, fully portable, and worth stating as a first-class principle in the personal layer's own meta doc. |
| 8 | Domain glossary as `CONTEXT.md` replacement, with `Definition / Usage / Contrast with / Related` micro-format, pre-approved domain list | **ADAPT** | The glossary *mechanism* (tight terms, contrast-with anti-synonyms, wikilinked relations) generalises well for cross-repo/cross-vault vocabulary (e.g. avoiding drift between "project" in one vault and "initiative" in another). The "pre-approved domain list gated by claude-context.md" governance step is heavier than a personal layer likely needs solo — could be relaxed to "add it and flag it" rather than requiring prior approval. |
| 9 | Two separate glossaries at different altitudes (vault/workflow vocab vs domain vocab) | **GENERALISE-AS-IS** | Directly useful: the personal layer will want a "how this system of notes works" glossary distinct from any given vault's subject-matter glossary. |
| 10 | Bases as living indexes; standard `not archive/` filter idiom; "Bases/obsidian-cli first, grep only for content with no metadata equivalent" | **GENERALISE-AS-IS** | This is the centrepiece transferable insight for "agent navigability": query-by-tag/frontmatter beats full-text search when the metadata is disciplined enough to support it. Directly reusable `.base` filter idiom and tool-preference rule. |
| 11 | Issue-tracker adapter doc (`docs/agents/issue-tracker.md`) mapping generic skill verbs onto repo-specific `gh` invocations | **ADAPT** | The *pattern* — a thin per-repo/per-vault adapter file that translates a shared vocabulary ("fetch the ticket", "publish to tracker") into local mechanics — generalises extremely well to a multi-repo personal layer where different repos might use GitHub Issues, Jira, or a plain Obsidian backlog. The wayfinder map/child-ticket protocol with GitHub-native sub-issues and dependency APIs is GitHub-specific plumbing but the map/frontier/claim/resolve *shape* is reusable against any tracker. |
| 12 | Triage-label adapter table (canonical role → local label string) | **GENERALISE-AS-IS** (as a pattern) | The indirection table itself (canonical vocabulary → local string) is a reusable integration pattern for keeping shared skills decoupled from any one repo's label taxonomy. |
| 13 | Rustdoc-vault split ("how" vs "why"), `//! See:` line convention | **SYMBIOSIS-SPECIFIC** | Tied to Rust/rustdoc and a compiled codebase. No direct analogue in a personal notes/dotfiles layer, though the underlying principle (code-adjacent docs describe mechanism; central vault describes rationale) could inform how chezmoi scripts/configs reference back to decision notes. |
| 14 | `.claude/settings.json` PreToolUse/Stop/PostToolUse hooks nudging context-loading, pre-commit doc reminders, Done-checklist echo | **GENERALISE-AS-IS** | Fully portable Claude Code mechanism — usable verbatim in any repo, including the dotfiles repo itself, to nudge toward reading a "state" doc before edits. |
| 15 | `vault-auditor` sub-agent (cheap, haiku-tier, read-only conformance scanner) invoked by a periodic `docs-audit` skill | **GENERALISE-AS-IS** | Directly reusable: a cheap conformance-scanning sub-agent for any tag/frontmatter-disciplined vault, personal or project. |
| 16 | Convention Propagation checklist (new tag/field ⇒ update N named files in the same commit) | **GENERALISE-AS-IS** | A reusable discipline for any small-schema system: name the exact files that must move together and enforce it as a checklist item. |
| 17 | Sibling Consistency rule (touch one file in a structural group ⇒ check all) | **GENERALISE-AS-IS** | Same as above — generic anti-drift discipline for structurally-grouped files (all `.base` files, all skill files, all context files). |
| 18 | Idea lifecycle: physical move to `archive/`, re-tag, `promoted-to`/`archived-reason`, Bases exclude `archive/` | **GENERALISE-AS-IS** | Fully portable note-lifecycle pattern for any Obsidian vault wanting to preserve reasoning without polluting active views. |
| 19 | PR/spec slicing rules (≤50 files, slice specs >150 lines or >1 subsystem, PR description template) | **SYMBIOSIS-SPECIFIC** | Tuned to a code-shipping cadence with PR review load and Copilot re-review costs. Not applicable to a personal knowledge layer with no PR flow, though the underlying idea (bound the size of any single atomic change) could loosely inform "don't let one commit touch the whole cross-repo layer." |
| 20 | Agent-orchestration dispatch matrix (model/effort per task shape) + stop-and-ask triggers + unit-execution protocol | **ADAPT** | The dispatch-matrix concept (route task shapes to appropriately-costed agents) and the stop-and-ask trigger list (scope creep, harness changes, RULE-CHANGE flags, repeated failure, deleting unauthored content) generalise directly to any multi-repo agent-driven workflow — this is architecture-agnostic project management, not game-specific. The specific agent names (`bevy-specialist`, etc.) are obviously project-specific and would be swapped for the personal layer's own roster. |
| 21 | Three non-negotiable structural principles: docs live where they belong (code-adjacent vs central), truth-status by location/type not status fields, atomic units + value through edges | **GENERALISE-AS-IS** | These are vault-design principles independent of subject matter — directly quotable as founding principles for the personal engineering-OS vault. |
| 22 | C4 (Context/Container/Component/Code) mapping of doc altitude to vault structure + rustdoc | **SYMBIOSIS-SPECIFIC** | C4 is a software-architecture framework mapped onto crates/specs/rustdoc; not meaningful for a non-code personal layer, though the underlying idea — pick one documentation-altitude framework and map every doc type onto a rung of it — is a technique worth borrowing in the abstract (ADAPT-flavoured, but the concrete framework itself doesn't transfer). |

---

## 11. Top Takeaways for the Personal Layer

1. **Adopt the capture-routed live-state note** (`claude-context.md` pattern) as the connective tissue across vaults/repos — this is the single highest-leverage, most directly portable idea.
2. **Adopt tag-in-frontmatter typing + Bases-as-queries** as the taxonomy backbone; keep the schema deliberately small and prune fields that don't back a real query ("minimum ceremony, maximum signal").
3. **Adopt the "read this when X" docs-that-point-to-docs discipline** everywhere a doc could otherwise become a wall of undifferentiated rules.
4. **Adopt the adapter-doc pattern** (`docs/agents/*.md`) for translating shared/generic skill vocabulary into whatever each repo's actual tracker/labels/tools are — this is exactly the shape needed to keep a cross-repo layer DRY without forcing every repo onto identical tooling.
5. **Adopt the enforcement stack** (hooks nudging context load, a cheap conformance-auditor sub-agent, convention-propagation and sibling-consistency checklists) rather than relying on prose conventions alone — symbiosis's own retrospective (`harness-adherence-matrix`) found several rules had silently gone unenforced, which is itself a useful cautionary data point.
6. **Leave behind** the C4/rustdoc/PR-slicing layer — those are Rust-crate-shaped solutions to a Rust-crate-shaped problem and have no direct analogue once the personal layer isn't shipping compiled code.
