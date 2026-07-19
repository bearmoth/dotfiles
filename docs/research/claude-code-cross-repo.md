# Claude Code cross-repo mechanics

Research for [bearmoth/dotfiles#6](https://github.com/bearmoth/dotfiles/issues/6) (child of map #3).
Verified against current official docs at `https://code.claude.com/docs` on **2026-07-20**. Claude Code line: 2.1.x.

## TL;DR

- **The load-bearing distinction: context vs. enforcement.** CLAUDE.md, rules, and skills are *context* delivered to the model — "not enforced configuration." Only **hooks** run deterministically at lifecycle events regardless of what the model decides. So anything that must happen **without prompting** (worklog updates, note capture, routing) belongs in a hook, not in CLAUDE.md.
- **A registry** of contexts/vaults/repos loads two ways: statically via `~/.claude/CLAUDE.md` (+ `@imports`), or dynamically via a `SessionStart` hook that injects `additionalContext`. Prefer the hook when the registry is generated/large or must reflect current state.
- **Cross-repo file read+write** comes from `--add-dir` / `permissions.additionalDirectories`. Under the repo's current `defaultMode: "auto"`, added dirs are **readable without prompts and writable** (edits follow the permission mode). Big gotcha: `additionalDirectories` in *settings* grants **file access only** — it does **not** load skills/agents/CLAUDE.md from the sibling. Only `--add-dir` loads sibling skills + agents.
- **obsidian-cli is NOT an MCP server.** It's a plugin *skill* wrapping the `obsidian` CLI binary; it addresses vaults by name with `vault=<name>` but **requires a running Obsidian GUI** (won't work headless/cloud/routine).

---

## Capability matrix

Jobs: **REG** = registry loading · **ROUTE** = "which repo/context am I in" routing · **VAULT** = read+write sibling repos/vaults · **ROUTINE** = unprompted routines (worklog, capture).

| Primitive | REG | ROUTE | VAULT | ROUTINE | Notes / limit |
|---|---|---|---|---|---|
| Global `~/.claude/CLAUDE.md` (+`@imports`) | Best (static registry) | Weak (static, can't sense cwd) | — | No (guidance only) | Loaded every session, in full; counts against context. Not enforced. |
| Project `./CLAUDE.md` / `.claude/rules/` | Per-repo overlay | Per-repo facts | — | No | Concatenated with globals; path-scoped rules for subtrees. |
| `SessionStart` hook | Best (dynamic registry) | Best (inspect cwd+git, inject) | — | Partial (session-open tasks) | `additionalContext` / stdout injected before first prompt. |
| `UserPromptSubmit` hook | Good (per-turn) | Good (per-turn) | — | Yes (capture per prompt) | Injects context alongside each prompt; can block. |
| `Stop` / `SubagentStop` / `PostToolUse` / `SessionEnd` hooks | — | — | — | **Best** (worklog/capture) | Fire deterministically at end-of-turn / after edits / session close. |
| `--add-dir` | — | — | **Yes (RW + skills+agents)** | — | Loads sibling `.claude/skills` + `.claude/agents`; CLAUDE.md only with env flag. |
| `permissions.additionalDirectories` | — | — | **Yes (RW, files only)** | — | Persistent; **no** config/skill loading from the dir. |
| Skills (`SKILL.md`) | — | — | Vault ops (obsidian-cli) | Only if triggered | Progressive disclosure; still model-invoked unless a hook fires them. |
| Subagents (`.claude/agents`) | — | Delegated routing | Delegated RW / isolated worktree | — | Own context/tools/model; good for heavy sibling-repo work. |
| MCP servers | Registry-as-tools | — | Vault/repo via server tools | Push channels can wake session | Scopes: local/project/user. obsidian-cli is *not* MCP. |
| `CLAUDE_PROJECT_DIR` / cwd / statusline | — | **Best (identity signal)** | — | — | Env var + git remote inspection inside hooks/statusline. |

---

## 1. CLAUDE.md layering

**Locations, in load order (broadest → most specific), all *concatenated* — later ones do not override, they append** (`/en/memory`):

| Scope | Location |
|---|---|
| Managed policy | macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`; Linux/WSL `/etc/claude-code/CLAUDE.md` (or `claudeMd` key in `managed-settings.json`) |
| User | `~/.claude/CLAUDE.md` |
| Project | `./CLAUDE.md` **or** `./.claude/CLAUDE.md` |
| Local | `./CLAUDE.local.md` (gitignore it) |

- **Resolution:** Claude walks *up* the tree from cwd; every `CLAUDE.md` + `CLAUDE.local.md` from filesystem root down to cwd is loaded in full at launch. Subdirectory CLAUDE.md files load **on demand** when Claude reads files there. Within a directory, `CLAUDE.local.md` appends after `CLAUDE.md`.
- **Override semantics:** "All discovered files are concatenated into context rather than overriding each other." Contradictory rules → Claude "may pick one arbitrarily." Precedence for *conflicts* effectively favors the last-read (most specific) file.
- **Imports (`@file` syntax):** `@path/to/import` expands and loads at launch. Relative (to the importing file) or absolute; `@~/…` for home. Recursive, **max depth 4 hops**. Parsing **skips code spans/fences** — `` `@README` `` stays literal. First external import shows a one-time approval dialog.
- **Size guidance:** target **under 200 lines** per file; "longer files consume more context and reduce adherence." Imports help *organization* but **not** context cost (imported files still load at launch). For big trees use path-scoped `.claude/rules/*.md` (YAML `paths:` frontmatter) which load only when matching files are touched.
- **Not enforcement:** CLAUDE.md is delivered "as a user message after the system prompt… no guarantee of strict compliance." For hard rules use a `PreToolUse` hook; for system-prompt level use `--append-system-prompt`.
- **Worktree gotcha (relevant here):** a gitignored `CLAUDE.local.md` exists only in the worktree that created it. To share personal instructions across worktrees, `@~/.claude/my-instructions.md` from home instead.
- **Additional-directory CLAUDE.md:** not loaded from added dirs unless `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` (and only for `--add-dir` dirs, not `additionalDirectories` settings).

## 2. Hooks

Configured under `hooks` in any settings file (`~/.claude/settings.json` = all projects; `.claude/settings.json` = project, committable; `.claude/settings.local.json` = local; managed; plugin `hooks/hooks.json`; or skill/agent frontmatter). Structure:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [ { "type": "command", "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/load-registry.sh" } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "if": "Bash(rm *)", "command": "…/block.sh" } ] }
    ]
  }
}
```

**Event list (selected, full list in `/en/hooks`):** `SessionStart`, `SessionEnd`, `Setup`, `UserPromptSubmit`, `UserPromptExpansion`, `PreToolUse`, `PermissionRequest`, `PermissionDenied`, `PostToolUse`, `PostToolUseFailure`, `PostToolBatch`, `Notification`, `MessageDisplay`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`, `Stop`, `StopFailure`, `InstructionsLoaded`, `ConfigChange`, `CwdChanged`, `FileChanged`, `WorktreeCreate`/`Remove`, `PreCompact`/`PostCompact`, `Elicitation`/`ElicitationResult`.

**Context injection (verified verbatim):** exit-0 stdout is written to the debug log for most events; **the exceptions are `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart`, where stdout is added as context that Claude can see and act on.** So a context-only `SessionStart`/`UserPromptSubmit` hook can just `echo` to stdout — no JSON needed. Use JSON when combining with other fields:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Current branch: feat/auth\nActive issue: #4211",
    "sessionTitle": "auth-refactor"
  }
}
```

- `UserPromptSubmit` injects `additionalContext` *alongside* the prompt (it "can't replace the prompt"). Also available on `PostToolUse`, `Stop`/`SubagentStop` (context continues the conversation without a `decision`).
- **Matchers:** exact (`"Bash"`), OR (`"Edit | Write"` or `"Edit, Write"`), regex (`"^Notebook"`), MCP (`"mcp__server__.*"`). What each event matches on varies — tool events match tool name; `SessionStart` matches source (`startup`/`resume`/`clear`/`compact`); `SubagentStart/Stop` match agent type. Tool events also support an `if` permission-rule narrower (`"if": "Bash(git *)"`).
- **Handler types:** `command`, `http`, `mcp_tool`, `prompt`, `agent`. Exit code 2 = blocking error (stderr → Claude). `${CLAUDE_PROJECT_DIR}` is exported to the subprocess.

## 3. Additional directories (`--add-dir` / `permissions.additionalDirectories`)

- **Read AND write:** yes. "Files in additional directories follow the same permission rules as the original working directory: they become readable without prompts, and file editing permissions follow the current permission mode." With the repo's `defaultMode: "auto"`, added dirs are auto-approved for writes (and `acceptEdits` covers `mkdir/touch/mv/cp` there too).
- **Three ways to add:** `--add-dir <path>` at startup · `/add-dir` in-session · `permissions.additionalDirectories` in settings (persistent).
- **The critical asymmetry** (`/en/permissions#additional-directories-grant-file-access-not-configuration`):

| Loaded from the added dir | `--add-dir` / `/add-dir` | `additionalDirectories` (settings) |
|---|---|---|
| Skills `.claude/skills/` | **Yes** (live reload) | **No** |
| Subagents `.claude/agents/` | **Yes** | **No** |
| Settings keys | only `enabledPlugins`, `extraKnownMarketplaces` | No |
| CLAUDE.md / rules / CLAUDE.local.md | only with `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` | No |

  → A chezmoi-distributed `additionalDirectories` list gives Phil RW to sibling repos/vaults but will **not** bring their skills/agents along. If sibling-repo skills matter, launch with `--add-dir` (or ship them user-level / as a plugin).

- **Permission rule scoping across dirs** (gitignore-style path patterns, `/en/permissions`): `//abs`, `~/home`, `/settings-relative`, `path`/`./path` (cwd-relative). A `/path` anchors at the *settings source* — in user settings `~/.claude/settings.json`, `Read(/secrets/**)` means `~/.claude/secrets/**`, **not** the project. To make a rule apply inside every repo/vault, use `//abs` or `~/`-relative patterns. `Edit(...)` rules cover all file-editing tools; a `Read` deny also blocks `Edit` on that path. `/cd` (unlike `/add-dir`) relocates the session and loads the new dir's CLAUDE.md.

## 4. Skills

- **Discovery + precedence** (`/en/skills`): Personal `~/.claude/skills/<name>/SKILL.md` (all projects) · Project `.claude/skills/<name>/SKILL.md` (walked up to repo root; nested dirs load on demand) · Plugin skills namespaced `plugin-name:skill-name`. **On name clash: enterprise > personal > project** (personal beats project — counterintuitive), and any of these overrides a bundled skill. Nested same-name skills both stay, disambiguated as `apps/web:deploy`.
- **Progressive disclosure:** only the `description` is loaded up front; the body loads when invoked (by you via `/name` or by Claude when relevant). Cheap to keep many skills.
- **Frontmatter:**

```yaml
---
name: my-skill
description: What this skill does and when to use it
disable-model-invocation: true   # only you can /invoke; also blocks preload into subagents & routines
allowed-tools: Read Grep          # pre-approved tools for the invoking turn
paths: "src/**/*.ts"              # auto-activate only for matching files (scoped skills)
context: fork                     # run in its own subagent context
agent: <subagent-type>            # which subagent when context: fork
---
```

- **Dynamic context injection:** a `` !`command` `` line in the body runs at load and inlines its stdout before Claude sees the skill (e.g. `` !`git remote get-url origin` ``). `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PROJECT_DIR}` are substituted.
- **Scoped skills:** `paths:` frontmatter limits auto-activation to matching files; nested `.claude/skills/` scope to a monorepo package.
- **Cloud/routine limit:** `~/.claude/skills/` are **not** read by cloud/Cowork/routine sessions — commit to the repo's `.claude/skills/` or ship in a plugin declared in the repo settings.

## 5. Subagents

- **Definitions** (`/en/sub-agents`): `.claude/agents/*.md` (project, walked up; closest wins on name clash) and `~/.claude/agents/*.md` (all projects). `--add-dir` dirs' `.claude/agents/` also load. Identity = `name` frontmatter only (subfolders don't matter). `/agents` no longer opens a wizard; edit files directly.
- **Frontmatter:**

```yaml
---
name: code-reviewer
description: When Claude should delegate to this subagent (write for auto-delegation)
tools: Read, Glob, Grep        # omit = inherit all; or use disallowedTools
model: sonnet                  # sonnet|opus|haiku|fable|<id>|inherit (default inherit)
mcpServers: [github]           # give access to MCP servers (inline or by reference)
isolation: worktree            # run in an isolated copy of the repo
memory: true                   # own persistent auto-memory dir
---
```

- **Delegation:** Claude auto-delegates based on `description`, or you invoke via the `Agent`/Task tool. Deny the `Agent` tool to disable delegation. Subagents can spawn nested subagents.
- **Startup context:** a subagent receives its own system prompt (the body) plus basic env (working directory) — **not** the parent's full context or the main auto-memory. Custom + general-purpose subagents load CLAUDE.md; Explore/Plan skip it. Starts in the parent's cwd; `cd` doesn't persist across its Bash calls.
- **Cross-repo use:** a subagent with `--add-dir`-granted access or `isolation: worktree` does heavy sibling-repo work in its own context and returns only a summary — ideal for "update the worklog repo" or "capture into the vault" without flooding the main session. `mcpServers`/`tools` scope exactly what it may touch.
- **Fork:** `/subtask` (v2.1.212+) or `/fork` copies the current conversation into a subagent that inherits parent context + system prompt (the one exception to the "no parent context" rule).

## 6. MCP

- **Scopes** (`/en/mcp`): `local` (default; current project only; stored in `~/.claude.json`) · `project` (shared via `.mcp.json` at repo root, committable) · `user` (all your projects; `~/.claude.json`). Add with `claude mcp add [--transport http|sse|stdio|ws] <name> [--scope local|project|user] …`. Project `.mcp.json`:

```json
{ "mcpServers": { "name": { "type": "http", "url": "https://…/mcp" } } }
```

  Project servers require workspace-trust approval before they connect. Plugins can bundle MCP servers (registered as `plugin:<plugin>:<server>`).
- **obsidian-cli — the framing correction:** the installed `obsidian@obsidian-skills` plugin exposes **skills, not an MCP server**. `obsidian-cli` wraps the `obsidian` CLI binary (docs `https://help.obsidian.md/cli`). Multi-vault addressing: commands default to the **most recently focused vault**; target a named vault with `vault=<name>` as the **first** parameter:

  ```bash
  obsidian vault="Worklog" read file="2026-07-20"
  obsidian vault="Notes" create name="Capture" content="# …" silent
  obsidian vault="Worklog" daily:append content="- worked on #6"
  ```

  File targeting: `file=<wikilink-name>` or `path=<from-vault-root>`. **Limit:** requires a **running Obsidian GUI** — no headless/cloud/routine use, and the vault name registry lives in Obsidian, not in Claude Code. For headless vault access, treat the vault as a plain directory via `--add-dir` + the filesystem tools (or the obsidian-markdown skill for syntax).

## 7. Env / session identity ("which repo/context am I in")

- **`CLAUDE_PROJECT_DIR`** — project root, exported to hook subprocesses (and stdio MCP servers). Best stable anchor.
- **cwd** — the launch directory; drives CLAUDE.md/skill/agent discovery. `/cd` relocates it.
- **git remote inspection** — inside a `SessionStart`/`UserPromptSubmit` hook or the statusline command, run `git -C "$CLAUDE_PROJECT_DIR" remote get-url origin` (or `rev-parse --show-toplevel`) to identify the repo, then look it up in the registry and inject the matching context via `additionalContext`.
- **statusline** — the repo already ships `statusLine.command = bash ~/.claude/statusline-command.sh`; it receives session JSON on stdin (cwd, model, etc.) and is the display-side counterpart to a routing hook.

---

## Recommendations (chezmoi-actionable)

Source paths are in `dot_claude/` (chezmoi source → `~/.claude/`).

1. **Registry — populate `dot_claude/CLAUDE.md`** (currently `dot_claude/empty_CLAUDE.md`, 0 bytes). Keep it a lean index (<200 lines) that `@`-imports a registry file:
   ```markdown
   # Root layer
   @~/.claude/registry.md   # contexts / vaults / repos table
   ```
   Chezmoi-manage `dot_claude/registry.md`. If the registry must reflect live state (open Obsidian vaults, current branches), generate it instead via a `SessionStart` hook that `echo`s it to stdout — cheaper and always current.

2. **Routing — add a `SessionStart` hook** (`dot_claude/settings.json` → `hooks.SessionStart`) that reads `git remote`/`CLAUDE_PROJECT_DIR`, matches against the registry, and injects the active context + relevant sibling paths as `additionalContext`. Mirror the identity in the existing statusline script.

3. **Vault/sibling access — `permissions.additionalDirectories`** in `dot_claude/settings.json` for the vault + sibling repo roots (RW under the existing `defaultMode: "auto"`). This answers "read AND write?" → **yes**. If you need the *siblings' own skills/agents*, you must instead launch with `--add-dir` (settings-based list won't load them) or promote those skills to user-level `dot_claude/skills/`.

4. **Unprompted routines — hooks, not CLAUDE.md.** Worklog updates → `Stop`/`SessionEnd` hook writing to the worklog repo/vault (via `obsidian … daily:append` if GUI is open, else file write). Note capture → `UserPromptSubmit` hook. This is the only mechanism that fires regardless of the model's choices.

5. **obsidian-cli** is already installed as a plugin skill — use `vault=<name>` addressing, but design routines to **fall back to filesystem writes** when Obsidian isn't running (and remember it's unavailable in any cloud/routine session).

## Known limits / gotchas

- CLAUDE.md/rules/skills are **context, not enforcement** — never rely on them for "always/never" guarantees; use hooks.
- `additionalDirectories` (settings) ≠ `--add-dir`: settings grants **file access only**; `--add-dir` additionally loads skills + subagents.
- **Skill precedence is personal > project** (enterprise > personal > project) — a personal skill silently shadows a project one of the same name.
- **`~/.claude/skills/` and `~/.claude/agents/` don't reach cloud/routine sessions** — commit to the repo or ship as a plugin.
- obsidian-cli needs a **live Obsidian GUI**; it is a skill, not MCP.
- Worktree gitignored `CLAUDE.local.md` is per-worktree — import from `~/` to share.
- Creating a **new** top-level `skills`/`agents` dir mid-session isn't detected — restart required (edits to existing ones live-reload).
- Nested subagent/skill name collisions resolve by "closest to cwd" (subagents) or path-qualified name (skills) — keep `name` values unique.

## Primary sources (verified 2026-07-20)

- Memory / CLAUDE.md: `https://code.claude.com/docs/en/memory`
- Hooks: `https://code.claude.com/docs/en/hooks`
- Skills: `https://code.claude.com/docs/en/skills`
- Subagents: `https://code.claude.com/docs/en/sub-agents`
- MCP: `https://code.claude.com/docs/en/mcp`
- Permissions / additional directories: `https://code.claude.com/docs/en/permissions`
- obsidian-cli: installed skill `~/.claude/plugins/.../obsidian-cli/SKILL.md` + `https://help.obsidian.md/cli`
