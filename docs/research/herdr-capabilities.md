# Research: herdr worktree/workspace/agent capabilities

Issue: [bearmoth/dotfiles#5](https://github.com/bearmoth/dotfiles/issues/5) (child of map issue #3)
herdr version tested: 0.7.4, protocol 16. Home: https://herdr.dev

## Question

Can herdr provide agent-driven git worktree provisioning, so that a Claude session working
in repo A can determine that work is needed in repo B and provision a fresh, correctly-placed,
tracked worktree in repo B — instead of today's failure mode of branching on an existing
checkout (often `master`)?

## Method

Reconnaissance only — no worktrees/sessions/servers were created or stopped. Sources:

- `herdr --help` and the full sub-help tree (`worktree`, `workspace`, `agent`, `api`, `wait`,
  `session`, `integration`, `tab`, `pane`, `notification`, `config`, `channel`)
- `herdr api schema --json` (full JSON Schema for the socket API, all 55 result types / ~90
  methods)
- Live, read-only socket calls: `herdr status`, `herdr worktree list [--cwd ...]`,
  `herdr workspace list`, `herdr session list`, `herdr integration status`,
  `herdr pane list --workspace ...`
- `~/.config/herdr/config.toml`, `~/.local/share/chezmoi/dot_config/herdr/config.toml.tmpl`,
  `run_once_install-herdr.sh.tmpl`, `run_onchange_update-herdr.sh.tmpl`,
  `run_onchange_after_reload-herdr.sh.tmpl`
- `~/.claude/hooks/herdr-agent-state.sh` (the installed Claude Code integration hook)
- herdr.dev docs pages: `/docs/cli-reference/`, `/docs/agent-skill/`

## What herdr is

A "terminal workspace manager for AI coding agents": a persistent headless server
(`herdr server`) plus a terminal client, addressable both via keybindings/TUI and via a JSON
socket API (`~/.config/herdr/herdr.sock`). It organizes state as
`session → workspace → tab → pane`, and panes can have an associated "agent" (a coding CLI
whose status — idle/working/blocked — is tracked). This session is itself running inside
herdr (`HERDR_ENV=1`, `HERDR_WORKSPACE_ID=w1`, `HERDR_PANE_ID=w1:p14`, `HERDR_SOCKET_PATH` all
set in env), confirming the socket is live and reachable from an ordinary Bash tool call.

## Worktree capability inventory

CLI surface (`herdr worktree --help`):

```
herdr worktree list   [--workspace ID | --cwd PATH] [--json]
herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] [--path PATH] [--label TEXT] [--focus] [--no-focus] [--json]
herdr worktree open   [--workspace ID | --cwd PATH] (--path PATH | --branch NAME) [--label TEXT] [--focus] [--no-focus] [--json]
herdr worktree remove --workspace ID [--force] [--json]
```

Backed 1:1 by socket API methods `worktree.list` / `worktree.create` / `worktree.open` /
`worktree.remove`, with typed JSON Schema params/results (`WorktreeCreateParams`,
`WorktreeInfo`, `WorktreeSourceInfo`, etc., from `herdr api schema --json`).

**Repo resolution.** Every worktree subcommand takes `--workspace ID` (an existing herdr
workspace) or `--cwd PATH` (any filesystem path inside the target repo's working tree — not
necessarily the calling process's own cwd). herdr resolves the repository by walking to the
repo root/`.git` dir (`repo_key`/`repo_root`), independent of which repo the calling shell
happens to be sitting in.

**Creation.** `create` runs `git worktree add`-equivalent logic:
- `--branch NAME`: if `NAME` is an existing local branch, herdr checks it out; otherwise it
  creates a new branch from `--base REF` (or `HEAD` if `--base` omitted).
- `--path PATH`: explicit location; if omitted, defaults to
  `"<worktrees.directory>/<repo>/<branch-slug>"`. Default `worktrees.directory` is
  `~/.herdr/worktrees` (see `herdr --default-config`; commented out, unset in Phil's
  `config.toml`/`config.toml.tmpl`, so the default applies for both repos we checked).
- `--label TEXT`: cosmetic label shown in the herdr UI, independent of branch name.
- `--focus`/`--no-focus`: whether the terminal switches to the new workspace.

**Discovery.** `list` reflects the real state of `git worktree list` for the resolved repo —
it picked up worktrees this repo's own agent-fork mechanism created
(`.claude/worktrees/agent-<hash>`, branches named `worktree-agent-<hash>`) even though herdr
did not create them. (Inference, not directly verified: those specific worktrees look like
Claude Code's own `EnterWorktree` fork mechanism, based on the naming convention, not herdr's
own worktree-creation naming scheme, which defaults to `<branch-slug>` under
`~/.herdr/worktrees/<repo>/`.) This means herdr's worktree tracking is not a separate
database it owns — it's live discovery over the repo's actual `git worktree` state, always
consistent with reality, plus optional linkage to a herdr workspace (`open_workspace_id`) if
one is currently open on that path.

**Removal.** `remove` requires `--workspace ID` (not a path) and runs `git worktree remove`;
needs `--force` when git refuses a dirty checkout. Docs note: `workspace close` only tears
down herdr's own UI state and does **not** remove the git worktree — the two are decoupled.

## Cross-repo test (the crux of the target behaviour)

Confirmed empirically, live, from *this* session (running in a chezmoi worktree, herdr
workspace `w1`), against two entirely unrelated repos open in other herdr workspaces:

```
$ pwd
/Users/phil/.local/share/chezmoi/.claude/worktrees/agent-ae957a905c993e61d

$ herdr worktree list --cwd /Users/phil/Dev/primeslice/stake-production-gitops
{"result":{"source":{"repo_root":"/Users/phil/Dev/primeslice/stake-production-gitops",
  "source_workspace_id":"w4", ...}, "worktrees":[...2 worktrees for that repo...]}}

$ herdr worktree list --cwd /Users/phil/Dev/primeslice/stake/current-work/backend
{"result":{"source":{"repo_root":"/Users/phil/Dev/primeslice/stake/master",
  "source_workspace_id":"w2", ...}, "worktrees":[...22 worktrees for that repo...]}}
```

Both calls returned the correct target repo's own worktree list, correct `repo_root`, and the
`source_workspace_id` of the *other* workspace where that repo happens to be open (w4, w2) —
even though the call itself ran from workspace w1 with cwd in a third, unrelated repo
(chezmoi). This is exactly the "repo A session → provision in repo B" topology Phil described.
Since `worktree.create` takes the identical `--cwd`/`--workspace` resolution path as
`worktree.list` (confirmed via schema: `WorktreeCreateParams` and `WorktreeListParams` share
the same `cwd`/`workspace_id` shape), the same cross-repo targeting applies to creation by
construction of the API, though `create` itself was not executed (out of scope: reconnaissance
only, no mutation).

## Agent-drivability: exit codes, JSON, non-interactive use

- Every subcommand supports `--json` and, on error, returns a structured envelope:
  `{"error":{"code":"not_git_worktree","message":"..."}}` with **non-zero exit status** (all
  three negative-path tests above returned exit code 1 with a stable `code` field) — safely
  scriptable/parseable by an agent's Bash tool without screen-scraping.
- `herdr agent start <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split right|down] [--env K=V] [--focus|--no-focus] -- <argv...>` launches an arbitrary command (e.g. `claude`)
  in a chosen cwd/workspace/tab — this is the complementary primitive to `worktree create`:
  create the worktree, then `agent start` a fresh Claude session rooted in it.
- `herdr wait agent-status <pane_id> --status <idle|working|blocked|done|unknown> [--timeout MS]` and `herdr agent wait <target> --status ... [--timeout MS]` let a calling agent
  block until the newly-started agent in repo B reaches a terminal/blocked state — i.e. a
  session in repo A can hand off work to repo B and synchronously wait for it.
- `herdr api snapshot` / `herdr api schema --json` expose the full live runtime state and
  machine-readable schema respectively, suitable for an agent to introspect capabilities
  before calling them.

## State: what herdr keeps, and where

- Runtime state (workspaces/tabs/panes/agent statuses) lives in the running server process,
  addressed over `~/.config/herdr/herdr.sock`; `herdr session list --json` shows one `default`
  session here. No separate persistent "worktree registry" file — worktree state is always
  derived live from `git worktree list` in the target repo plus whichever herdr workspace (if
  any) currently has that path open.
- Config lives in `~/.config/herdr/config.toml` (chezmoi-templated from
  `dot_config/herdr/config.toml.tmpl`); the only worktree-relevant setting is
  `[worktrees] directory` (default `~/.herdr/worktrees`, currently unset/default for Phil).
- Install/update on this machine is via Homebrew (`/opt/homebrew/bin/herdr`); the chezmoi
  `run_once_install-herdr.sh.tmpl` / `run_onchange_update-herdr.sh.tmpl` scripts are gated
  `{{ if eq .chezmoi.os "linux" }}` and are no-ops on macOS — herdr's presence on this Mac is
  managed outside chezmoi.

## Existing agent integration

- `herdr integration status` shows a Claude Code hook already installed and current (`claude:
  current (v7)`, at `~/.claude/hooks/herdr-agent-state.sh`). Reading that hook: it fires on
  Claude Code's `SessionStart`/session hooks, and does a **one-way push** — it reports the
  pane's agent/session-id/status (idle/working/blocked) to herdr over the socket
  (`pane.report_agent_session`, `pane.report_agent`). It does not give Claude any tools; it
  only lets herdr's UI show accurate agent status per pane. Same pattern is installed/current
  for `copilot`; most other integrations (codex, cursor, droid, opencode, etc.) are "not
  installed."
- Separately, herdr publishes an **agent skill** (`npx skills add ogulcancelik/herdr --skill
  herdr -g`) — a markdown instruction file (not a plugin/MCP server) that teaches an agent
  running inside a herdr pane how to drive herdr: inspect workspaces/tabs/panes, split panes
  and run commands without stealing focus, read pane output, wait on other agents, and start
  helper agents in sibling panes. This skill is **not currently installed** for Phil (absent
  from `~/.claude/skills/`). The published docs page for it contains no worked example of
  cross-repo worktree provisioning specifically — the capability exists at the CLI/API level
  (see above) but isn't yet packaged as an off-the-shelf agent skill/example for this exact
  workflow.

## Verdict

**Yes — herdr can drive the target workflow, via the CLI already available to every Claude
Code Bash tool call, with no server/session mutation required in this repo to prove it:**

1. A session in repo A runs `herdr worktree create --cwd <path in repo B> --branch <name>
   [--base <ref>] [--no-focus] --json` — creating a real, isolated `git worktree add` in repo
   B (not a branch on repo B's existing/master checkout), placed under
   `~/.herdr/worktrees/<repo>/<branch-slug>` by default or at an explicit `--path`.
2. It optionally runs `herdr agent start claude --cwd <new worktree path> --no-focus -- claude
   ...` to spin up a fresh Claude session rooted there.
3. It optionally blocks on `herdr wait agent-status <pane_id> --status idle|done --timeout
   ...` to synchronize on completion.
4. Every step returns structured JSON with exit codes suitable for programmatic
   success/failure handling.

This directly replaces the observed failure mode (an agent branching on whatever checkout of
repo B happens to be open, often `master`) with a herdr-registered, correctly-named, isolated
worktree — driven entirely non-interactively.

Note on "tracked": herdr satisfies the *placement/isolation* reading of "tracked" (a real,
discoverable `git worktree`, not an ad hoc branch on an existing checkout) — `worktree list`
always reflects the true git state. It does **not** mean herdr sets up remote tracking/upstream
branches automatically; `--branch` only creates a local branch off `--base`/`HEAD`, so pushing
and upstream configuration remain the caller's responsibility, same as plain `git worktree add`.

## Gaps versus the target behaviour

1. **No headless "just make the git worktree" mode.** Per the API schema, `worktree.create`'s
   result type (`worktree_created`) *requires* `workspace`, `tab`, and `root_pane` fields —
   every worktree creation also spins up a herdr workspace/tab/pane, not a bare `git worktree
   add`. This requires the herdr server (and, unclear from this recon, possibly the terminal
   client app) to be running; it is not a drop-in replacement for scripting `git worktree add`
   in a context with no herdr session at all. Whether it also requires the GUI terminal client
   attached (vs. server-only/headless) was not conclusively determined in this pass — worth a
   follow-up check with the client detached.
2. **No packaged agent-facing recipe for this exact workflow.** The CLI/API supports
   cross-repo worktree + agent-start + wait, but neither the installed Claude Code hook
   integration (which is one-way status reporting only) nor the separately-published
   `herdr` agent skill (not installed here) currently document or encode "detect work needed
   in another repo → provision a worktree there → hand off." This would need to be written
   (e.g. as a CLAUDE.md snippet, project skill, or contribution to the upstream herdr skill)
   rather than relied upon out of the box.
3. **Default worktree path is herdr's own tree (`~/.herdr/worktrees/<repo>/<branch-slug>`),
   not the repo-adjacent convention Phil currently uses** (e.g. this very session's worktree
   lives at `<repo>/.claude/worktrees/agent-<hash>`, and the stake repos use
   `<repo>/bau/<ticket>` style paths) — `--path` must be passed explicitly to match existing
   conventions per repo, since there's no per-repo override in config, only the single global
   `[worktrees] directory`.
4. **No remote/upstream setup, no PR creation, no branch-naming policy enforcement** — those
   remain entirely the calling agent's responsibility; herdr only wraps `git worktree
   add`/`remove` and pane/workspace bookkeeping.
5. **`create` and `remove` were not executed in this research** (scope: reconnaissance only),
   so the exact shape of `worktree_created`'s response and any create-time failure modes
   (e.g. branch-name collisions, existing dirty worktree at the default path) are known from
   docs/schema but not empirically exercised end-to-end.
