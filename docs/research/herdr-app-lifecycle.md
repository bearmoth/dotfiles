# Research: herdr-app space lifecycle surface (events, folder, focus) as of 0.1.14

Issue: [bearmoth/dotfiles#71](https://github.com/bearmoth/dotfiles/issues/71) (part of map #65,
"herdr-app desktop as my daily outer dev shell").
Tested: herdr-app **0.1.13** (installed), herdr-core `hc` **0.1.18** (protocol generation 1),
macOS, 2026-11-09. 0.1.14 is described from its changelog only (see §4).

## Question

What do herdr-app and herdr-core expose about a space's lifecycle and context that an
**external owner of a per-space headless nvim** could use? A mod's `close()` gets at most
250 ms, so something else has to own starting and stopping each space's nvim.

## Evidence tags

- **[verified]**: observed on this machine in an experiment or a read-only query.
- **[documented]**: stated in a first-party local source: `~/.config/herdr-app/AGENTS.md`
  and `herdr.d.ts` (both written by the app on every start), `herdr-app --help`,
  `herdr-app commands`, `herdr-app --skill`, `hc --help`, `hc <cmd> --help`, or `hc schema`
  (the OpenRPC document for the core API). The 0.1.14 notes come from the app's
  `~/.config/herdr-app/update-notes-cache.md`.
- **[inferred]**: my reasoning from the above; not tested.

I did not consult herdr.dev web docs. The local sources are written by this exact build,
match its version, and covered every question.

## Method

- **Read-only:** I read the files above, ran `herdr-app ls/status/commands`, `hc ls/get`, and
  `hc connect` with JSON-RPC `hello` and `doc.get`, and fetched
  `releases.herdr.dev/app/latest.json`.
- **Experiments**, all in a throwaway space `research-lifecycle` (`--folder /tmp/rl/space`),
  created and closed three times, with a throwaway pane mod
  `mods/research-lifecycle-probe` (`focusable: true`):
  - `hc events --json` was logged for the whole session.
  - `~/.config/herdr-app/view.json` was polled every 0.3 s.
  - The probe logged `focused()`, `panes()`, `spaces()` and its focus handle's state to a
    hidden file in its own folder.
  - Children were started with `hc run --bg`, with and without `--parent`.
- **Cleanup:** the probe mod is deleted and every test terminal is killed. The space is gone
  but stays in the app's "recent" list in `view.json`, which only Herdr writes.

## 1. Events on space create / close / switch

### There are no space events, but the core's doc stream tells you about structure

- **Where spaces live.** The app stores all spaces, tabs and splits in a herdr-core
  **document named `herdr-app`**.
  - "Each machine keeps its spaces, tabs and splits in its core's `herdr-app` document … Use
    commands to change structure; there is no `spaces.json`." [documented, AGENTS.md]
  - `doc.get {name:"herdr-app"}` over `hc connect` returned
    `{spaces:[{id, name, folder, tabs:[{id, name, root:<split tree with {terminal:"t1"}>}]}]}`
    with a version number. [verified]
- **Change events.** `hc events` / `events.subscribe` streams "every fact change in order
  (created, lost, restarted, keep, finished, removed, status, turn, title, labels, size,
  **doc**)", with a `heartbeat` every 15 s and a `missed` + fresh snapshot for a slow
  subscriber. [documented, `hc schema`]
- **Observed sequence.** [verified, events log]
  - `space.new`, then `pane.split` (adding a mod pane), then `space.close` produced
    `{"type":"doc","data":{"name":"herdr-app","version":N}}` once per structural change
    (versions 40, 41, 42).
  - The terminal events alongside them:
    - `created` for the space's first shell, labelled `herdr.space=<id>` and
      `herdr.tab=<id>`;
    - a `labels` event that adds `where: "research-lifecycle / 1"`;
    - on close, `finished` with `reason: "killed", signal: 1` (SIGHUP) for each of the
      space's terminals, about 30–40 ms after the doc bump.
- **Detecting create and close.** You subscribe to `doc` events, then `doc.get herdr-app`
  and diff the space ids. This is the only authoritative way. [verified mechanism]
  - Key on **ids, not names.** The doc stores `name: ""` for a space nobody named;
    "chezmoi" is only the name the app shows, taken from the first terminal's folder.
    [verified]
  - The `doc` event carries only the name and version. You must fetch the doc to see what
    changed. [verified]
  - The `hc` CLI has no `doc` subcommand. You have to speak JSON-RPC: `hc connect` (stdin
    and stdout) or the hc socket. `herdr-app ls` gives the same space list, but only
    with the window open. [verified / documented]
  - Terminal `created`/`finished` events with a `herdr.space=<id>` label back this up, but
    alone they are ambiguous: closing one pane also produces `finished`. [verified]
- **Space switch is invisible to herdr-core.** [verified]
  - Two `space.select` calls and switches the user made produced **no** `hc` event of any
    kind. The doc version did not change.
  - Focus, selection, zoom and recent spaces are per-screen state: "Focus, zoom, recent
    spaces, settled tabs and seen attention stay on this screen." [documented]
  - A switch is visible from outside the app only through
    `~/.config/herdr-app/view.json`, whose `active` key changed within about 0.2 s of each
    switch, or by polling `herdr-app status`.
  - `view.json` is listed as "written by Herdr", with no format promised. Treat it as an
    unstable, undocumented interface. [documented / inferred]
- **`herdr-app` has no event stream.** `herdr-app --help` lists `ls`, `do`, `status`,
  `commands`, `check`, `shot`, `feedback` and `--skill`, with no subscribe or watch.
  `herdr-app commands` has no event or hook command. [verified]
- **`hc` has no hooks or config hooks.** `~/.config/herdr-core/config.toml` settings are
  `notes`, `shell` and `wait_timeout`. There is no lifecycle hook. [documented, `hc --help`]

### Inside a mod

- `render` runs again "whenever Herdr's live data changes (spaces, agents, terminals, focus,
  theme, shared state). Don't poll those." [documented]
- A pane mod saw a `render` about 40 ms after each switch into its space. Its timers kept
  running while its space was hidden, and they saw `focused().space` change on every switch.
  [verified]
- **There is no space-create, space-close or switch callback.** A mod has to diff
  `spaces()` and `focused().space` itself. [verified by API surface: `herdr.d.ts` has no
  such hook]
- **`close(cx)`:**
  - It fires when the mod's pane, tab, layout slot or overlay goes, **and on app quit**.
  - It is **not** called for a hidden copy or an inactive tab, nor after a crash.
  - It gets at most 250 ms in total, shared across copies on quit.
  - [documented]
  - On `space.close` the probe's `close()` ran about 15 ms after the command and its awaited
    file write completed. [verified]
  - The documented cleanup pattern is `async close(cx) { await exec("hc", ["kill", id]); }`.
    That is the same code path for "space closed" and "app quit". A mod **cannot tell them
    apart**, so killing nvim in `close()` would also kill it on every app restart or update.
    [documented + inferred]
- **Hidden copies:**
  - "A copy starts the first time it shows." [documented]
  - A copy that has started "stays alive while its block is in the layout, shown or not …
    its timers keep running while hidden". [documented]
  - Observed: copy `yfg7xi` was the same copy before and after a round trip to another
    space, with no re-init. [verified]
  - **This contradicts spike finding #4 ("Mods restart on space switch").** That restart
    was probably the hot-reload loop described next, or a reload from saving files during
    the spike. [inferred]
- **Hot-reload gotcha** [verified]:
  - A mod that writes a **non-hidden** file into its own folder reloads itself, about every
    630 ms in a loop.
  - Dot-files are exempt: "not files the app writes: `jsconfig.json`, `.d.ts`, hidden ones,
    `node_modules`". [documented]

## 2. Reading a space's folder and identity

### From outside (CLI or API)

- **`herdr-app ls`** (needs the window open) [verified]:
  - For each space: `id`, `name` (the shown name), `folder`, `machine` and `active`, and
    `tabs[].terminals[]` with each `terminal`, `pane` and `sub_agents`.
  - `recent[]` lists closed spaces as `{name, folder}`.
- **`doc.get herdr-app`** (window not needed; the core holds it) [verified]:
  - For each space: `id`, `name` (`""` if unnamed), `folder`, and a split tree containing
    terminal addresses. It has no "active" field.
- **What `folder` means.** It is "where its new terminals start (on its machine; empty: that
  machine's home)". It is the folder the space was **made in**, not its live location.
  [documented, `SpaceInfo.folder`]
  - chezmoi's `folder` is `/Users/phil`, while its terminals sit in
    `~/.local/share/chezmoi`. [verified]
  - "Where a space is now is its terminals' live folders (`panes()[i].cwd`) … the default
    mods take a space's repo from its first terminal." [documented]
- **Live folder from outside.** Each terminal in `hc ls --json` / `hc events` has:
  - `cwd`: where it started;
  - `foreground.cwd`: the live folder of its foreground process;
  - labels `herdr.space`, `herdr.tab` and `where`.
  - [verified]
- **Path mismatch.** `/tmp/rl/space` (the space `folder`, and the terminal's `cwd`) was
  reported as `/private/tmp/rl/space` in `foreground.cwd` and the pane title. **Canonicalize
  with realpath before keying nvim by folder.** [verified]
- **Space id for a terminal.** Read the `herdr.space` label. Herdr sets it on every terminal
  it starts. [verified]
- **Warning: the `herdr.space` label is an adoption signal.** "A terminal with those labels
  shows up there, even one you start yourself" [documented]. Herdr gives it a pane. **Never
  put `herdr.space` or `herdr.tab` on a headless nvim**; use your own label, e.g.
  `nvim.space=<id>`. [documented / inferred]

### From inside a mod

- `spaces()` → `SpaceInfo {id, index, name, named, folder, machine, branch, active, status,
  tabs[]}`. [documented, verified]
- `focused()` → `{space, tab, pane, terminal, shown, agent, cwd}`. For a mod pane, `terminal`
  and `cwd` are null. [documented, verified]
- `panes()` → each pane's `{pane, terminal, mod?, tab, cwd, branch, focused, …}`. `cwd` is
  the terminal's live folder. [documented]
- **A pane mod doesn't know its own pane or space id.** `props()` was **null** for a mod
  added with `pane.split --mod` and no props. [verified] Two ways round it:
  - pass identity at creation: `pane.split {mod, props: {space: <id>}}` (props are stored
    with the tab) [documented];
  - or find it: `panes().filter(p => p.mod === NAME)` → `.tab` → the `spaces()` entry whose
    `tabs` contains that tab. This is ambiguous with more than one copy. [verified for one
    copy]
- `exec(cmd, args, {cwd})` runs commands; `hc(args)` runs `hc`. A mod can therefore start or
  kill core terminals itself (`hc run --bg …`). [documented]

## 3. Focus API

- **`"focusable": true` in `mod.json`** [documented]:
  - It lets `pane.go` move onto a shown copy, which then gets `"focus"` from
    `nextCommand()`. It must call `this.handle.focus()` itself.
  - "The copy gets `"focus"` again after a popup over it closes."
  - It does **not** send `"focus"` on `space.select`, `pane.split` or a click. The probe
    received no `"focus"` command on split or switch-in. [verified]
- **The gap, confirmed** [verified]:
  - After `pane.split --mod` and after `space.select` into the space, Herdr reports the mod
    pane as focused: `focused().pane` is the mod's pane, and `herdr-app status`
    `focused_pane` is the mod pane.
  - But the mod's GPUI focus handle reports `is_focused() === false`. Herdr's idea of
    "focused pane" and GPUI keyboard focus are separate.
- **Self-focus works, but only outside `render`** [verified]:
  - `this.h.focus()` inside `render` throws: *"FocusHandle.focus() cannot run during render
    or layout; mutate state from an event handler or task"* and the view shows "This view
    could not be re-rendered".
  - `cx.spawn(...)` started from `render` never ran the focus call. It took no effect within
    2 s.
  - **A `cx.timer.every(150, …)` callback works.** When `focused().pane === myPane &&
    !h.is_focused()`, it calls `h.focus()`, and `is_focused()` is true straight after. This
    happened 40–150 ms after switch-in. It worked both after `pane.split` and after
    switching back from another space.
- **Overlays.** A **level-triggered** grab, as described above, would fight overlays.
  [verified]
  - With the palette open (`app.palette`; `herdr-app status` overlays `["frame-palette"]`),
    `focused().pane` was **still the mod pane** and the handle was not focused.
  - So the grab condition held for the whole time the palette was open, and a level-triggered
    grab would have taken the keyboard back from the palette every tick.
  - An **edge-triggered** grab did not fire while the palette was open. It sets a flag only
    when `focused().space` changes to the mod's space, and the timer acts on the flag once.
  - After the palette closed, the mod still didn't have the keyboard. The documented fix is
    to listen for the `"focus"` command, which Herdr re-sends after a popup closes; the
    probe didn't listen for it.
  - **Recommended pattern:** an edge-triggered grab on space switch-in, plus handling the
    `"focus"` command from `nextCommand()`. [inferred from the two observations]
- **Limit of the evidence.** It is `is_focused()` returning true. **Keystroke delivery after
  the grab was not exercised:** no keys were injected, to avoid typing into the user's
  terminals. The spike already showed that keys reach a mod whose handle has focus. [stated]
- **0.1.14:** "mods see which terminal has the keyboard (#553, #554)" [documented, changelog].
  This concerns terminal blocks, not mod focus on space switch.

## 4. 0.1.13 → 0.1.14 (documented only; 0.1.14 is not installed)

- `latest.json`: `version: "0.1.14"`, `core_min: "0.1.11"`, targets linux x86_64/aarch64,
  macos aarch64, windows x86_64. [verified, fetched]
- The app's toast also says **"herdr-core 0.1.19 is ready"**. I have 0.1.18 and did not read
  the 0.1.19 notes. [verified toast text]
- 0.1.14 changelog items that matter here (`update-notes-cache.md`) [documented]:
  - **The top of a mod's file now runs once and is shared by all its copies;** keep per-copy
    state in the class. This makes a single in-app coordinator easier, e.g. a module-level
    registry of space → nvim shared across copies. It also means top-level side effects run
    once, not once per copy.
  - **`exec(cmd, args, { timeout })`, up to 10 minutes** (default 30 s). A mod can now wait
    for longer setup (e.g. `hc run` then a readiness check).
  - `pane.swap` by id from mods; mods see which terminal has the keyboard (#553/#554).
  - Fixed: mods all breaking with "could not be re-rendered" after a while (memory). Fixed:
    idle windows waking every mod 20×/s.
  - Fixed: new terminals start in the right folder when several open at once, and in home
    when the inherited folder is gone.
  - Fixed (macOS): `herdr-app check` no longer leaves a second Dock icon whose quit "ended
    every terminal".
- **Nothing in 0.1.14 adds space lifecycle events, a space-switch hook, `"focus"` on
  switch-in, or a longer `close()` budget.** [documented, by absence]

## 5. What happens to processes when a space closes [verified]

- **What `space.close` does.** It ends the space's terminals (`about`: "Close a space and end
  its terminals"). The space's shell (`t11`) finished with `reason: killed`, `signal: 1`.
- **A core child dies with the space.** `hc run --bg --parent <space shell> --no-notify
  --name rl-child -- sleep 900`:
  - the core recorded `die_with_parent: true`;
  - it showed as `sub_agents: ["t12"]` under that shell in `herdr-app ls`;
  - it got no pane;
  - it did not appear in the Agents sidebar (it reports no status);
  - it finished (`killed`) 10 ms after its parent.
  - The rule: "children end with their parent unless `outlive_parent`". [documented]
  - **The catch:** it is tied to **that one terminal**. Closing that pane or exiting that
    shell kills nvim too, even though the space lives on. [inferred from the documented
    rule]
- **A detached terminal survives.** `hc run --bg --no-parent --label rl.space=<id> -- sleep
  900` stayed live after its space closed (I killed it afterwards).
- **`hc run` picks a parent by default.** **Without `--no-parent`, `hc run` takes the calling
  terminal as its parent.** Run from inside a Herdr terminal, the child got `parent: t1`, the
  user's chezmoi terminal, and was labelled `where: "chezmoi / 1"`. An external owner started
  from a Herdr terminal must pass `--no-parent`. A launchd/systemd service has no
  `HC_TERMINAL_ID`, so it doesn't. [verified / inferred]
- **`hc kill` escalates.** It sends hangup, then terminate, then kill. [documented]
  - nvim handles SIGHUP by preserving swap files and exiting. [inferred; nvim behaviour, not
    tested here]
- **`--keep` is the wrong tool here.** `hc run --keep` replaces a *lost* program with a
  shell, never the original command. It does not supervise or restart nvim. [documented]

## Implications for the lifecycle grilling

**Where the facts point.**

- No first-party hook fires on space create, close or switch.
- **Structure changes** (create and close) are observable **outside the app**, through
  `hc events` `doc` notifications plus `doc.get herdr-app`.
- **Switches** are observable only **inside the app**, or through undocumented `view.json`.
- **Folder:** use `SpaceInfo.folder`, or the first terminal's live `foreground.cwd`, after
  realpath.

### Viable owners of starting and stopping nvim

| Owner | Start | Stop | Strengths | Weaknesses |
|---|---|---|---|---|
| **(a) External supervisor** (launchd/systemd user service) | Follows `hc events`. On a `doc` event, `doc.get herdr-app`, diff space ids, and `hc run --bg --no-parent --label nvim.space=<id> --cwd <folder> -- nvim --headless --listen …` | On a space id disappearing: `hc kill`. On startup: reconcile `nvim.space=*` terminals against the doc and kill orphans | Owns both ends. Survives app quit, update and crash. Doesn't depend on the window. Uses only the documented API. Can run on a remote machine via `--on` | One more process to install and supervise. Speaks JSON-RPC (`hc connect` or the socket) because `doc.get` has no CLI. Starts nvim for every space, not lazily (unless it starts on first use instead) |
| **(b) Core parent→child** (nvim as a child of a space terminal) | Something (mod or supervisor) runs `hc run --bg --parent <space's first shell> -- nvim …` | Automatic: dies with its parent, verified on `space.close` | No supervisor needed for shutdown. Core-enforced, so it holds after an app crash | nvim is tied to one terminal: closing that pane or `exit` in that shell kills the editor while the space lives on. Needs a restart policy anyway |
| **(c) Mod-owned, best effort** | The mod's `init` (or the first time its space is shown) runs `hc run --bg --no-parent --label nvim.space=<id> …` via `hc()`/`exec`. 0.1.14's shared module top level suits one coordinator | `close()` → `hc kill` (250 ms, best-effort) | No new process to install. Lazy: starts when shown | `close()` fires on app quit too, so nvim would die on every restart or update. It doesn't fire after a crash or for hidden copies. A hidden copy never starts, so a space that hasn't been shown has no nvim. Still needs a sweeper (a startup reconcile in the mod, or (a)) |

**Hybrids worth grilling:**

- (a) owns **stop** and orphan reaping, while the mod lazily **starts** nvim on first show,
  with idempotent naming such as `--name nvim-<spaceid>`.
- Or (a) owns both, and the mod is only a view that connects to whatever nvim carries its
  space's label.

**Focus is a mod concern whichever owner you choose.** Use an edge-triggered `h.focus()`
from a timer on switch-in, plus handling the `"focus"` command. Don't focus in `render`, and
don't grab on a level-triggered condition, because it fights the palette and other overlays.

**Identity.** Key nvim by space **id**, carried in a non-`herdr.*` label. Pass `{space}` in the
mod pane's props when you create it.

## Incidental observations

- During the session, two things happened while none of my commands were running:
  - terminal `t10`, a claude-code terminal in chezmoi, finished with `killed` (SIGHUP) at
    about 13:48:41 local time, right after a doc change consistent with a pane close;
  - a space `research-config` (folder `/tmp/herdr-research`) appeared.
  - Neither was mine.
- The app shows "Herdr 0.1.14 and herdr-core 0.1.19 are ready". I didn't update.
