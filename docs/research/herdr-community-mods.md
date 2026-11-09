# Research: community herdr-app mods and layouts for editor mode, worktrees and multi-repo

Issue: [bearmoth/dotfiles#86](https://github.com/bearmoth/dotfiles/issues/86) (child of map #65;
blocks #76).
Surveyed 2026-11-10 against herdr-app **0.1.14** (`herdr-app --version`) on macOS.

**herdr-app is not the herdr TUI.** Many herdr repos on GitHub are TUI plugins
(`herdr-plugin.toml`). They are listed separately at the end and not ranked.

## Question

What have other people already built for herdr-app that could serve or inspire:

- **editor mode**: one nvim with a socket, plus panels wired to it;
- **worktree-first spaces**;
- **multi-repo tasks**?

For each relevant entry: what it does, how it does it (`exec`/`hc`/network, keys), how it is
built, and whether it targets the current app. End with a ranked list.

## Method and evidence labels

1. **Gallery.** Fetched `https://herdr.dev/gallery/`. Each card is a `<div class="card">` with
   `data-*` fields: key, blurb, stars, last update, GitHub folder. Parsed all cards and
   filtered the blurbs with a keyword regex (nvim, editor, worktree, repo, project, task, review,
   diff, file tree, file:line, socket). Cross-checked with `gh search repos --topic herdr-mod`,
   `--topic herdr-layout` and `--topic herdr`. AGENTS.md says the gallery is fed by those
   topics.
2. **Source.** Shallow-cloned 36 candidate repos, each into its own empty dir under
   `/tmp/herdr-community/`. Read their `RECIPE.md`, README and source. **Nothing was executed
   or installed**, and nothing under `~/.config/herdr-app` was changed.
3. **Scans.** Grepped each clone for:
   - `exec("…")`, `hc([...])` and `run("…")` targets;
   - network calls (`fetch(`, `net.connect`, `curl`, `gh`, `reqwest`/`ureq` in Rust or sh);
   - the hardcoded worktree path `.herdr/worktrees`.

   These greps are a **lower bound**. They miss non-literal calls such as `exec(bin(), …)`.
4. **Upstream.** Read issues in [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app)
   where a recipe cited one.

Each claim is labelled:

- **[verified]**: observed on this machine (gallery fetch, clone contents, Phil's config).
- **[doc]**: stated in the project's own `RECIPE.md`/README, or an upstream issue.
- **[source]**: read in the cloned source code (not run).
- **[inferred]**: reasoned from the above.

## Scale of the ecosystem

- The gallery holds **859 cards** [verified]:
  - 554 community mods and 297 community layouts;
  - 8 herdr-made examples (7 layouts and the `tmux-prefix` mod).
- Every repo is 0–6 weeks old. The surveyed ones were last pushed between 2026-10-30 and
  2026-11-10 [verified].
- Nothing declares a target app version in a manifest. `mod.json` has no version field; the
  shipped `worktree` mod's is just `{ "place": "none" }` [verified].
- "Targets current" below therefore means one of:
  - the recipe names an app version (e.g. "cloned from `main` 0.1.13");
  - "unstated", when it names none.

  Strings like `0.1.16`–`0.1.18` in some recipes are **hc** (herdr-core) versions, not app
  versions [verified: project-presets says "tested with `herdr-app 0.1.12` and `hc 0.1.17`"].
- 21 surveyed files across 8 repos hardcode the shipped worktree path
  `~/.herdr/worktrees/<repo>/<branch>` [verified]:
  - herdr-max (8)
  - herdr-orca (5)
  - worktree-bootstrap (2)
  - kiosk (2)
  - project-presets (1)
  - herdr-workspaces (1)
  - herdr-corral (1)
  - kickoff (1)

  **Phil's worktrees live at `~/worktrees/<owner>/<repo>/<name>`** (worktree-provisioning
  skill). Those mods won't recognise his worktrees without changes [inferred].

## Findings

### 1. Editor mode

#### ChmaraX/herdr-nvim: the headline find

[github.com/ChmaraX/herdr-nvim](https://github.com/ChmaraX/herdr-nvim), folder `herdr-app/`.
MIT. 344★. Last pushed 2026-11-09. "The Herdr app 0.1.11+" [doc]. Its recipe works around
0.1.12 bugs [doc].

**What it does** [doc: README, RECIPE.md]:

- `cmd-e` (or the tab bar's Files button) opens a native file tree, with the **tab's own nvim**
  in a full-height pane beside it.
- Pressing it again hides both. nvim keeps running: buffers, cursor and LSP survive.
- Other features:
  - `cmd-o`: a fuzzy picker opening on the files the tab's agent read and edited. It reads the
    Claude Code / pi session log, then git changes, then falls back to paths on screen.
  - Tree file operations (rename, move, delete) go through nvim, so open buffers follow.
  - Markdown, image and SVG preview takes nvim's place.
  - `<leader>ac/al/as/aS/ai` comments in nvim are sent to the tab's agent with `file:line`,
    repo and branch.

**How it is built** [doc + source]:

- **One headless nvim daemon per tab**, run by a Rust binary `herdr-nvim` (~20k lines including
  Lua and tests).
- That nvim is shown in a terminal pane with **`nvim --remote-ui`** against the daemon's
  socket. The socket is registered per tab key under a runtime dir [source:
  `src/daemon/registry.rs`].
- **Hiding nvim parks it, it doesn't kill it.** Hiding is `terminal.park`. Showing again is
  `terminal.keep {place: beside}`, which takes about 30 ms. The first open is a `pane.split`,
  300–500 ms [doc].
- **Lifecycle owner** [source: `src/app/watch.rs`]:
  - A watcher, `herdr-nvim app-watch`, runs as a named, unlabelled core terminal.
  - It follows `hc events`. On every layout-document change it reconciles daemons against
    the live tabs, and stops nvims whose tab or space closed.
  - Starting the watcher reconciles first (startup GC).
  - Its own comment: "The app has no plugin events or startup hooks."
- **Jump-to-file interface for other mods** [doc]:
  `<appHome>/mods/herdr-nvim/bin/herdr-nvim open --tab <tab id> <file>[:line[:col]]`.
  This is exactly the "agent jumps the editor to file:line" shape.
- **Two mods** [doc]:
  - `herdr-nvim`: the tree, an always-rendered 0×0 floating "sync" controller, the overlays
    and the picker dialog.
  - `herdr-nvim-header`: a copy of the shipped pane header plus a Preview/Source button.
- **Mod-side programs** [source]: `exec` of its own binary, `git`, `sh`, `cat`, `cp`, and
  `hc kill`.
- **Network** [doc]: no network in the mod itself. The installer downloads the release binary
  from GitHub and checks its SHA-256.

**Install footprint** [doc: RECIPE "Adding it", "Layout footprint"]:

- Install is `curl … install.sh | sh -s -- --app`. Copying the folders doesn't work.
- It writes the binary to `~/.local/share/herdr-nvim/app` and merges three keys:
  `cmd-e`, `cmd-o`, `cmd-shift-e`. None of them is bound in Phil's `keys.json` [verified]. App
  built-in defaults were not checked.
- **It patches the on-screen layout**:
  - the `files` slot becomes `herdr-nvim`;
  - a floating sync block is added;
  - pane headers are swapped;
  - the panel narrows to 300px.
- On a herdr-owned layout it first clones `main` to `main-copy`. That copy "stops following
  Herdr's updates to `main`: install again after an app update" [doc].
- The author acknowledges this goes "against AGENTS.md's 'the person's own layout stays as it
  was'". The reason: no API lets a mod add a tab-bar button ([herdrdev/herdr-app#246], open)
  [doc].

**Fit against ADR-0013 and the editor-mode goal** [inferred]:

| | herdr-nvim | Phil's goal / ADR-0013 |
|---|---|---|
| nvim granularity | one per **tab** | one per **space** |
| placement | right sidebar (or `position = "bottom"`) | nvim at the **centre** |
| opt-in | per tab, by pressing `cmd-e` | per **space** ("editor mode") |
| display | `--remote-ui` in a terminal pane, park/keep | option (A), the same |
| lifecycle owner | `hc events` reconciler + startup GC | open question dotfiles#71 |
| socket / jump API | `herdr-nvim open --tab … file:line` | wanted |
| file tree → nvim | yes, native tree | wanted |
| changes / review → nvim | via herdr-gitview (below) | wanted |
| install | curl binary + layout patch | chezmoi owns `~/.config/herdr-app` |

**Per-tab may suit multi-repo** [inferred]. The tab's folder is "the git repo the tab's
terminals work in" [doc]. So in a multi-repo space with one tab per repo, per-tab nvims give
each repo its own editor, rooted correctly.

#### ChmaraX/herdr-gitview

[github.com/ChmaraX/herdr-gitview](https://github.com/ChmaraX/herdr-gitview), `herdr-app/`.
MIT. 28★. Last pushed 2026-11-09. Mentions 0.1.12/0.1.13.

**What it does** [doc]:

- Takes over the Changes panel: staged/unstaged/conflicts, a tree or flat list, history, and
  commit.
- A click opens a full-height diff pane.
- Review notes on lines are sent to an agent.
- **Enter opens the file in nvim at the cursor's line.** It chooses the editor in this order:
  1. herdr-nvim's tab nvim when installed;
  2. else an nvim already in the tab;
  3. else `$VISUAL`/`$EDITOR` in a terminal in the diff's place.

**How it is built** [doc + source]:

- 9 mods, ~13.8k lines of JS, plus a Rust binary. Install is curl, and it patches the layout's
  `changes` block, the same way herdr-nvim does.
- An nvim that gitview starts itself listens on its own socket through `--cmd serverstart`, at
  `<appHome>/data/gitview/nv-<hash>.sock` [source: `mods/gitview/editors.js`]. gitview can then
  ask it about unsaved buffers and tell it to quit.
- It runs `git`, `hc`, `herdr-app` and an editor. No network of its own [doc].

#### Smaller editor-adjacent pieces

- **cunderw/herdr-mods `visible-files`**
  ([repo](https://github.com/cunderw/herdr-mods/tree/main/visible-files), no license file).
  - A popup lists the file paths visible on the focused terminal (`hc read --lines 200` and a
    Python parser). Enter opens one in "this tab's nvim, else this space's".
  - The **socket convention** [doc]: nvim's config calls `serverstart` at
    `stdpath("state")/herdr-$HC_TERMINAL_ID.sock` when `HC_TERMINAL_ID` is set. It defines a
    `_G.herdr_open(path, line)` that the mod calls remotely.
  - A neat, dependency-free way to make *any* nvim in a herdr terminal addressable
    [inferred].
- **edalicioh/herdr-lazyvim-files**
  ([repo](https://github.com/edalicioh/herdr-lazyvim-files), Apache-2.0).
  - A clone of the Files mod with "Open in LazyVim".
  - It drives nvim by **keystroke injection**: `hc keys <terminal> esc`, then
    `hc send <terminal> ":edit …"` [source].
  - That breaks if nvim is in insert mode with a mapping on Esc, in a prompt, or mid-pending
    operator [inferred]. A socket is the robust shape.
- **Mantiq-com/herdr-telescope** (Apache-2.0).
  - A telescope-style find dialog backed by its own `herdr-telescope` binary.
  - It opens results with `nvim +call cursor(L,C) file` in a *new* terminal, not a running
    nvim [source: `mods/telescope/editors.js`].
- **cha2maru/herdr-ttt** (Apache-2.0).
  - Adds an **Editor** button to a cloned tabs bar that toggles a per-tab TTT editor. It uses
    the same `terminal.park`/`terminal.keep` hide-without-quitting trick [doc + source].
  - A small (195-line) worked example of the keep/park pattern.
- **TaterDoge/herdr-mods `splits-nav`** (no license file).
  - ctrl-h/j/k/l are nvim-aware: they move between nvim windows first, then between herdr
    panes. It uses `hc` and `pane.go`.
  - Upstream has no clean API for this yet ([herdrdev/herdr-app#679], open) [doc].
- **zamonia500/herdr-copy-mode.** Opens a terminal's scrollback read-only in nvim in a new tab.
  23 lines of JS plus a shell script [source]. Only tangential.

#### "Editor look" layouts: chrome only

None of these embeds or drives nvim [verified: no nvim references in their source]:

- **herdrdev/herdr-layout-examples `code`**: the installable form of the homepage "Code" look.
  "The explorer lists real files, but the code view is a fixed, read-only slice of one CSS
  file" [doc].
- **EmmanuelVernet/herdr-neovim**: dressed as LazyVim (bufferline, neo-tree-style spaces,
  lualine). No nvim [source].
- **yama-lei/herdr-editor-layout**: VS Code workbench. Opens files in `code`.
- **newtonmunene99/herdrobe `vscode`** and **dantech99/herdr-zed-layout**: looks only.
- **codexceed/herdr-ide**: "files open as tabs in editor panes". These use gpui-base
  `EditorState.new({…, readonly: true})` [source]. A viewer, not an editor.
- **werlang/herdr-file-editor** and **vampik33/herdr-file-tabs**: native file viewers. The
  latter's Edit button opens a terminal editor (micro) beside the viewer.

Upstream confirms the native editor's limits: "Mods can't use the code editor's LSP features"
([herdrdev/herdr-app#71], open) and "Files panel: … open files in an external editor"
([#610], open) [doc].

### 2. Review / changes panels that could hand off to nvim

None of these opens nvim themselves, except gitview and sangit0's [source/doc]:

- **vytasgavelis/herdr-reviewer** (MIT, 1.2k lines, plain JS, `git` + `hc send` only).
  - The shipped Changes panel with syntax colours and PR-style inline comments.
  - "Submit review" sends them all, with their lines, to the space's agent.
- **fgiova/herdr-agent-review** (MIT, 881 lines).
  - A GitLab-style side-by-side review with a "Viewed" checkbox per file.
  - Comments go to a chosen Claude agent.
- **sangit0/herdr-code-review** (MIT).
  - Tabbed diffs and a whole-change multibuffer.
  - Opens files in a terminal editor, `nvim` by default (`tabbed-changes.editor` shared key).
  - Has a Fetch button (`git fetch`).
- **JinJieBeWater/herdr-pulls-review**: needs an external `jin.review` daemon. Ignore.
- **iml885203/herdr-mods `session-changes`**: "what a Claude Code session changed across its
  repos".
  - It **sends diffs to `claude -p` automatically, with no prompt** [doc: its Privacy
    section].
  - Unsuitable for work repos.

### 3. Worktree-first and multi-repo

#### oguzhan-arslan/herdr-helm: the multi-repo task model

[github.com/oguzhan-arslan/herdr-helm](https://github.com/oguzhan-arslan/herdr-helm). MIT.
Last pushed 2026-11-02. App version unstated.

**The model** [doc: README, RECIPE]:

- A **project** is a folder of repos.
- A **space is one task**: "Pick the repos it needs, and Helm creates a worktree on a new
  branch in each one" inside a **task folder** under `tasks_root` (default `~/herdr/tasks`).
- Each checkout is a subfolder, e.g. `web/` and `web.api/` [source: `agent_files.rs` test
  data].
- Per repo it can copy files (`.env.local`) and run a setup command (`npm install`).
- It writes a `CLAUDE.md` into the task folder listing the goal, the checkouts and the rules.
- Its Changes panel shows every repo of the space, with one commit message and
  commit-and-push across the checked repos.
- "Complete" removes the space only once everything is pushed.

**Build** [doc + source]:

- A whole-window layout (`helm.json`) and 13 mods backed by a Rust `herdr-helm` core.
- **Connectors** for the code host (`gh`), agent (`claude`), editor (VS Code) and system.
- The editor connector contract is `open {path}`, `diff {old,new}`, `window {folder}`
  [doc: `docs/connectors.md`]. **An nvim connector is a natural fit** [inferred].
- Network: `gh`, plus a release check "a few times a day" [doc].

**Fit** [inferred]:

- It replaces the whole window, which conflicts with "ordinary spaces stay plain".
- Its task-folder model is the clearest community answer to "backend repo + gitops preprod repo
  for one task".

#### Multi-repo-aware panels

- **hongmono/herdr-nested-diff** (no license file; "cloned from `main` 0.1.11").
  - A Changes panel listing the changes of the repo you're in **and every git repo nested
    below it**, grouped per repo, plus a commit graph.
  - Plain JS. Runs `git` and `find` only. Read-only git flags so a folder watch doesn't loop
    [doc + source].
  - Ships as a layout that clones `main` and adds one block.
- **Opsord/herdr-mods** (MIT, "cloned from `main` 0.1.13").
  - `project-spaces` shows a space's nested sub-repos as a tree with branch badges.
  - `project-changes` is a Changes panel with a Zed-style **repo dropdown** inside one space.
  - Plain JS, `git` only.
- **madtocc/herdr-workspaces** (Apache-2.0, "Herdr's `main` (0.1.14) cloned": the only
  current-version clone found).
  - Adds a level *above* spaces: a workspace is a folder of repos, with its own `AGENTS.md`
    injected (with `--add-dir`) into agents started from inside it.
  - Hardcodes `~/.herdr/worktrees` for repo naming.

**Key coupling for the multi-repo design** [inferred]. Which panels work depends on the shape
of a task:

| Task shape | What follows |
|---|---|
| **One task folder holding one worktree per repo** (helm) | nested-diff and Opsord's repo dropdown work unchanged, because the space's folder *contains* every repo. One nvim per space rooted at the task folder sees every repo. |
| **One space per repo worktree** | Per-space panels see one repo only. A task needs grouping *above* spaces (madtocc workspaces, paddock, space-folders). Per-tab nvims (herdr-nvim) map one-to-one onto repos. |

#### Worktree creation and space sync

- **thomasschafer/kiosk** (MIT).
  - A fuzzy repo/branch picker. Enter opens a repo as a space, or a branch in its own
    worktree and space, creating them if needed.
  - Rust binary with SHA and attestation-verify steps in the recipe. Hardcodes
    `.herdr/worktrees`.
- **LucasPcq/herdr-app-wtm** (MIT).
  - Spaces **follow an external worktree tool**: it runs `wtm events --output json` as a
    background `hc run --outlive-parent` process writing to an inbox folder. The mod
    `watchFolder`s that folder and opens or closes spaces on `worktree.created` /
    `worktree.removed`.
  - Those are wtm's events, not herdr's [doc + source].
  - **This is the pattern for syncing Phil's own worktree-provisioning tool into spaces**
    [inferred].
- **cgill27/project-presets** (MIT): per-project settings (checkout vs worktree, branch naming,
  fetch, setup command, what starts in the new space).
- **tedkulp/herdr-app-kickoff** (MIT): a zoxide picker with an "In place / Worktree" toggle.
- **BowgartField/herdr-layout-worktree-bootstrap** (Apache-2.0):
  - setup/teardown scripts and copied files per repo, with progress in the sidebar;
  - 7.8k lines including vendored copies of shipped mods (0.1.12).

#### Grouping spaces by project or task

These are sidebar replacements, mostly `mod.clone`s of the shipped `spaces` mod:

- **choam2426/herdr-paddock**: by project, Orca-style. Clone of 0.1.11.
- **jankeesvw/herdr-space-folders** (MIT): folders, by drag or by path rules. Clone of 0.1.10.
- **pixeline/herdr-projects-mod** (MIT): project across machines, 0.1.13.
- **VladTemp27/herdr-orca**: 0.1.13. Runs ~30 programs, including `curl`, `osascript`, `kill`.
- **maxjkfc/herdr-max**: 0.1.13. Its worktree dialog lists the child repos of an "umbrella"
  folder but makes a worktree in *one* of them.
- **martinkozle/herdr-corral**: a Kanban of tasks holding agents.

Cloning a shipped mod freezes it at that version. Upstream notes the cost: "Changing one
shipped mod means cloning every mod that opens it by name" ([#289], open) [doc].

### 4. Talking to a program in a pane

Four shapes appear in the wild, from most to least robust [source; ranking inferred]:

1. **A daemon you own, with a CLI.** herdr-nvim's `herdr-nvim open --tab <id> file:line`. The
   caller never touches nvim's socket.
2. **nvim's own socket, keyed by the terminal.**
   - visible-files: `serverstart(stdpath("state")/herdr-$HC_TERMINAL_ID.sock)`.
   - gitview: `--cmd serverstart(<appHome>/data/…)`.
   - The caller uses `nvim --server <sock> --remote-expr`.
3. **Start a new process at the line**: telescope's `nvim +call cursor(L,C) file`. No reuse.
4. **Keystroke injection**: lazyvim-files' `hc keys esc` + `hc send ":edit …"`. Depends on
   nvim's mode.

Agents are reached the same way in reverse: reviewer, agent-review, hq-deck and herdr-nvim
send review text into the agent's terminal with `hc send` [source/doc].

### 5. TUI-only (out of scope, not ranked)

High-star herdr items that are **TUI plugins** or standalone TUIs, not herdr-app mods
[doc: their READMEs]:

- `persiyanov/herdr-reviewr`
- `smarzban/herdr-file-viewer`
- `alexarthurs/herdr-sidebar`
- `paulbkim-dev/vim-herdr-navigation`
- `lmilojevicc/herdr-splits.nvim`
- `iurysza/termscope`
- `NathanFlurry/herdr-plugin-jj-workspace`
- `andrewchng/herdr-sessionizer`

herdr-nvim and herdr-gitview ship both a TUI plugin and an app mod from one binary.

## Ranked list

**Borrow as-is** (plain JS, no binary, no layout rewrite of Phil's own layout, no hardcoded
worktree path):

1. **vytasgavelis/herdr-reviewer**: a better Changes panel for reviewing agent diffs and
   sending comments. `git` + `hc send` only.
   - Caveat: it can't open nvim, so wire that later through the jump API.
2. **hongmono/herdr-nested-diff**: only **if** the task-folder model wins. It is the
   multi-repo Changes view for free.
   - Caveat: it ships as a cloned 0.1.11 `main` layout. Take the mod and add its block to
     Phil's own layout rather than switching layouts.

**Fork** (right mechanism, wrong shape or install for Phil):

1. **ChmaraX/herdr-nvim**: the reference implementation of ADR-0013 option (A). Fork, or
   build to its recipe, for these changes:
   - per **space** (or per repo-tab) instead of per tab;
   - nvim at the centre;
   - a space-level opt-in;
   - no curl installer or layout patch: chezmoi places the binary and owns the layout.

   Keep its `hc events` reconciler, park/keep display and `open --tab file:line` CLI.
2. **oguzhan-arslan/herdr-helm**: fork the **task-folder model** (`checkout.rs`,
   `agent_files.rs`, `projects.json` shape), not the window. Its editor-connector contract is
   ready for an nvim connector.

**Idea only:**

- **gitview**: the editor-choice cascade on Enter, and the `serverstart` socket for an nvim it
  starts.
- **visible-files**: the `$HC_TERMINAL_ID` socket convention. It is also the cheapest way to
  make agent-printed paths open in nvim.
- **herdr-app-wtm**: an external worktree tool's event stream → inbox folder → space sync.
  This is the pattern for Phil's worktree-provisioning.
- **herdr-layout-worktree-bootstrap**: per-repo setup/teardown scripts and files to copy.
- **madtocc/herdr-workspaces**: per-workspace `AGENTS.md` and `--add-dir` for agents spanning
  repos.
- **Opsord `project-changes`**: the repo dropdown, if one-space-per-repo wins instead.
- **herdr-ttt**: the smallest worked example of `terminal.park`/`keep`.
- **splits-nav**: nvim-aware pane navigation, until [#679] lands.

**Ignore:**

- **Editor-look layouts**: herdrdev `code` (static mock), EmmanuelVernet/herdr-neovim,
  yama-lei editor layout, herdrobe vscode, zed-layout.
- **Native-editor viewers**: herdr-ide, file-editor, file-tabs. They use read-only gpui
  `EditorState`, with no vim or LSP.
- **herdr-lazyvim-files**: keystroke injection.
- **session-changes**: auto-sends diffs to Claude.
- **pulls-review**: needs an external daemon.
- **Whole-window sidebar replacements** cloned from old shipped mods (orca, herdr-max,
  paddock, space-folders, hive), and kiosk, project-presets and kickoff: all hardcode
  `~/.herdr/worktrees`, or freeze a 0.1.10–0.1.13 clone.

## What this changes in our assumptions

1. **Option (A) of ADR-0013 already exists in the community, working.**
   - herdr-nvim is a headless nvim per tab, shown via `--remote-ui` in a terminal pane.
   - It answers dotfiles **#71** (the lifecycle owner is an `hc events` reconciler run as a named core
     terminal, plus startup GC; not a mod `close()`).
   - It answers dotfiles **#74** (`--remote-ui` in a terminal pane, hidden with `terminal.park` and
     shown again with `terminal.keep` in ~30 ms).
   - dotfiles #71 and #74 should cite it rather than re-derive.
   - Its granularity is **per tab**, not per space. That is worth re-deciding in light of
     multi-repo tasks.
2. **The tab-bar button problem is upstream-blocked.** Every editor-mode mod that adds a Files,
   Editor or Changes button clones the tabs mod or patches the layout ([#246], open). A
   chezmoi-owned layout is the clean answer for Phil: put the blocks there yourself.
3. **Cmd+click on a path can't be routed to nvim yet** ([#228], open). "Agent output →
   nvim" needs a picker, as herdr-nvim's `cmd-o` and visible-files do, or the agent calling a
   CLI.
4. **The multi-repo shape decides which panels work.** Choose between "one task folder
   holding N worktrees" and "one space per repo worktree" before building panels.
5. **The shipped worktree path is a de facto standard** in the ecosystem
   (`~/.herdr/worktrees`). Phil's `~/worktrees/<owner>/<repo>/<name>` means most community
   worktree mods need changes.
6. The "Code" look and gpui `EditorState` assumptions hold. The installable `code` layout
   example is also a static mock.

[herdrdev/herdr-app#71]: https://github.com/herdrdev/herdr-app/issues/71
[#228]: https://github.com/herdrdev/herdr-app/issues/228
[#246]: https://github.com/herdrdev/herdr-app/issues/246
[herdrdev/herdr-app#246]: https://github.com/herdrdev/herdr-app/issues/246
[#289]: https://github.com/herdrdev/herdr-app/issues/289
[#610]: https://github.com/herdrdev/herdr-app/issues/610
[#679]: https://github.com/herdrdev/herdr-app/issues/679
[herdrdev/herdr-app#679]: https://github.com/herdrdev/herdr-app/issues/679
