# Research: herdr-app config and key surface

Issue: [bearmoth/dotfiles#72](https://github.com/bearmoth/dotfiles/issues/72) (child of map #65,
"herdr-app desktop as my daily outer dev shell").
Tested on herdr-app **0.1.13** (0.1.14 is waiting to install), herdr-core `hc` 0.1.18, gpui-shell
0.7.1, nvim 0.12.5, macOS (Apple Silicon). Date: 2026-11-09.

**herdr-app is not the herdr TUI.** Nothing here comes from the TUI's docs.

## Question

1. What are the shape, location and scope of `capabilities.fs.write`, and what other
   `capabilities.*` exist?
2. Does the app write `~/.config/herdr-app/settings.json` and `keys.json` itself? This decides
   whether chezmoi can own them.
3. How are keybindings defined? Can app bindings (`cmd-*`) be unbound or passed to the focused
   pane?
4. Can a terminal pane be opened with a given command, cwd and env? How faithful is the terminal
   (cursor shapes, mouse, true colour, OSC 52, kitty keyboard)? Is nvim in a terminal pane a
   full-fidelity editor?

## Method and evidence labels

Sources, in order of trust:

- **Local docs and help:** `~/.config/herdr-app/AGENTS.md`, which the app rewrites on every start
  and which is its own manual. Also `herdr.d.ts`, `gpui-kit.d.ts`, `herdr-app --help`,
  `herdr-app commands`, `hc --help` and `hc schema`.
- **Shipped mod source:** `frame/settings/main.js`.
- **The binary's strings:** `strings` on `~/Applications/Herdr.app/Contents/MacOS/Herdr`.
- **Experiments:** run in a throwaway space `research-config`, with mods named
  `research-config-*`. All were removed afterwards.

herdr.dev was not needed. Every question was settled locally.

Each claim is labelled:

- **[verified]**: observed on this machine by experiment.
- **[doc]**: stated in local primary docs, help text or shipped source.
- **[binary]**: read from strings compiled into the app.
- **[inferred]**: reasoned from the above but not observed.

### Correction to BRIEF.md "Verified facts: herdr-app"

Two brief facts are wrong or misleading.

**1. "Settings: font JetBrains Mono 14, zoom 1.2, theme graphite."** Only `zoom` is in
`settings.json`. The file holds exactly `zoom 1.2`, `sounds.enabled`, `font_ligatures false`,
`minimum_contrast 1` and `appearance "dark"`.

- JetBrains Mono 14 is the app's built-in default, used because neither the `main` layout nor
  settings sets a font [doc: AGENTS.md "The look"; `frame/settings/main.js` `DEFAULT_FONT`].
- graphite is the built-in dark default for a layout with no theme [doc]. `layouts/main.json`
  has no `theme` key.

**2. "A mod may write only into its own folder."** This is wrong for non-symlinked mods.

- `fs.writeFile` from a mod succeeded into a *sibling* mod folder and into the root of
  `~/.config/herdr-app` [verified].
- The write root is the whole of `~/.config/herdr-app`, as AGENTS.md says: "`fs/promises` (read in
  home, write under `~/.config/herdr-app`)".
- The brief's failure was probably the symlinked-folder case. A symlinked path resolves outside
  the root, which the brief already records.

## Findings

### 1. `capabilities.fs.write`, and the capabilities block in general

**What it belongs to.** The error text comes from **gpui-shell**, the JS runtime vendored into
herdr-app, not from herdr itself [binary: `vendor/gpui-kit/crates/shell/...`]. gpui-shell is also
a standalone app runtime. Its manifest is a file called **`gpui-shell.json`**, not `mod.json`
[binary].

**Manifest fields.** The manifest has exactly the fields `id`, `name`, `version`,
`shell-version`, `entry`, `dependencies` and `capabilities` [binary + verified by the `check`
parser]. Field meanings, quoted from the binary:

- `id`: reverse-DNS, lowercase, `.-_`. It is the namespace for panels, storage and permissions.
- `name`: a human-readable name "shown in menus and in the permission prompt".
- `entry`: e.g. `"main.js"`.
- `shell-version`: "the oldest compatible gpui-shell semantic version".
- Quoted rule: "Commands, panels, keybindings, settings and themes are registered in script, not
  declared here."

**Capabilities shape.** `herdr-app check` validates the shape, so it was probed directly
[verified]:

```json
{
  "capabilities": {
    "fs": {
      "read":    ["<dir>", "..."],
      "write":   ["${pluginDir}/x", "${dataDir}", "/abs/dir"],
      "execute": ["/bin/ls"]
    },
    "network": { "hosts": ["example.com"], "http": [ /* {scheme, host, port?, path(s)/path_prefixes, methods} */ ] },
    "storage": true,
    "clipboard": { "read": true, "write": true },
    "process": { "exit": true }
  }
}
```

- `fs.read`, `fs.write` and `fs.execute` must be **arrays of strings**. A map or a bare string
  is rejected with "invalid type: map/string, expected a sequence".
- The only placeholders are **`${pluginDir}`** and **`${dataDir}`**. `${home}` is rejected:
  "unknown placeholder ... the manifest may use ${pluginDir} and ${dataDir}".
- Unknown keys are rejected: "expected one of `fs`, `network`, `storage`, `clipboard`,
  `process`".
- `network.http` entries carry `scheme` (http/https), `host`, `port`, path or path-prefix entries
  that must start with `/`, and a non-empty `methods`. This shape is [binary] only and was not
  exercised.
- Other gated features, from the binary's error strings:
  - `localStorage` needs `storage`.
  - `cx.read_from_clipboard` / `cx.write_to_clipboard` need `clipboard.read` / `clipboard.write`.
  - `process.exit()` needs `process.exit`.
  - `fetch`, `WebSocket` and TextView images need `network` grants.

**Herdr mods ignore it** [verified]. Three probe mods tried `fs.writeFile` into a directory
outside `~/.config/herdr-app`, each on a fresh load:

| Variant | `herdr-app check` | `fs.writeFile` outside the root |
|---|---|---|
| no capabilities | pass | denied: "outside every granted write root; add its directory to capabilities.fs.write in the manifest" |
| `"capabilities": {"fs": {"write": [dir]}}` in **`mod.json`** | pass (key silently accepted) | **denied** |
| same block in a **`gpui-shell.json`** beside `main.js` | pass (the file *is* parsed and validated) | **denied** |

The directory was a real path. `/tmp` was also tried as `/private/tmp`, because writes resolve
symlinks.

Herdr supplies its own grants to its mods:

- read: home [doc];
- write: `~/.config/herdr-app` [doc + verified];
- `exec` and `fetch`: unrestricted ("Mods are trusted code") [doc].

A mod can't widen its fs write root. The error message is gpui-shell's generic advice and does
not apply to herdr mods.

**The way out is `herdr.writeTextFile`** [verified]. `writeTextFile(path, text, expected)` from
the `herdr` module wrote to a path outside the root, in all three variants.

- It works on this machine only ("here only").
- It is compare-and-swap: `expected` must match the current content (`null` means create). On a
  mismatch it rejects with "The file changed outside Herdr. Reload before saving" [verified].
- Writes are atomic replaces [doc].
- The shipped Settings screen uses this API to write `settings.json` [doc: `frame/settings/main.js`].

**Side finding: `check` runs timers.** `herdr-app check` blocks writes in `init`. It did not
block `writeTextFile` from a 1.5 s `cx.timer.after`: those files appeared at check time
[verified]. `check` is not side-effect-free.

**Side finding: a write-reload loop.** A mod that writes a non-hidden file into its own folder
from `init` makes a reload loop [verified]. Hot reload fires on any saved file except hidden
files, `.d.ts`, `jsconfig.json` and `node_modules` [doc]. The probe re-ran about every 1.6 s
until it wrote `.result.json` instead.

### 2. Does the app write `settings.json` and `keys.json`?

#### `settings.json`: yes, routinely

Evidence [verified + doc]:

- **Zoom.** `herdr-app do app.zoom_in` (the same command as cmd-= and cmd--) rewrote
  `settings.json` within 2 s. A `find -newer` marker found no other config file written.
- **Re-serialisation.** The app re-serialises the whole file:
  - `"minimum_contrast": 1` came back as `1.0`;
  - zooming in then out did **not** restore the original bytes (135 vs 133 bytes);
  - the **inode changed** on every write, so it is an atomic replace (write a temp file, then
    rename).
- **The Settings UI.** `frame/settings/main.js` `change()` reads `settings.json`, applies an edit,
  and writes back with `JSON.stringify(next, null, 2)` through `writeTextFile`, retrying up to
  3 times on a stale read. Its calls cover:
  - appearance;
  - terminal and interface font, and font size;
  - `option_as_alt`;
  - sounds;
  - telemetry.
- **Restoring by hand works.** Copying the original bytes back was picked up live, with no
  error, and the app did not rewrite it. `cmp` was identical afterwards and `status` showed zoom
  1.2.

The theme does **not** go to `settings.json` [verified]:

- `app.theme {name}` (the theme picker) wrote `layouts/.state/main.json`, adding
  `"theme": {"light": "paper", "dark": "ink"}`.
- AGENTS.md says the same: "Clicks (sizes, shown/hidden, stack child, floating spots, theme picks,
  ...) live in `layouts/.state/`. Don't edit those files."
- Picking graphite back left `"dark": "graphite"` pinned. The file was then restored
  byte-identically.

Other files the app writes during normal use [doc: AGENTS.md "The files"]:

- `view.json`
- `shared.json`
- `data/`
- `seen.json`
- `installed.json`
- `window.json`
- `layouts/.state/`
- `telemetry/`
- `frame/` (rewritten on every start)
- the shipped `mods/*` and `layouts/{main,terminals,win98}.json`, which are replaced whole on
  every start. An edited shipped file is moved aside to `<name>-edited`.

#### `keys.json`: only in three narrow cases

- **Fresh install.** The app writes the defaults. The mtime here is the install minute (7 Nov
  19:58) and has not changed through two days of use, zoom and theme changes [verified].
- **Upgrade, only if untouched.** "On upgrade, an untouched keys file from an earlier release gets
  the current shortcuts. Any edit, even whitespace, keeps the entire file as yours; new default
  shortcuts must then be added by hand" [doc].
  - `installed.json` holds content hashes for shipped mods and layouts but none for keys, so
    "untouched" is presumably judged by comparing content against shipped versions [inferred].
- **Escape hatch.** `ctrl-alt-shift-escape`, which nothing can rebind, moves `keys.json` (and the
  shown layout) aside to `keys.json.reset-<time>` and returns to defaults [doc].

No UI path edits keys.json. Settings → Keyboard only writes `option_as_alt` to `settings.json`
[doc: `frame/settings/main.js`].

#### Error handling for both files

An invalid edit is not applied. The app keeps the last good version and writes the reason to
`keys.error` / `settings.error`. `herdr-app status` lists errors [doc].

### 3. Keybindings

**Format** [doc: AGENTS.md "Keys"; current file read]:

```json
{
  "global":           { "cmd-d": "pane.split:right", "ctrl-1": "space.select:1" },
  "terminal":         { "cmd-c": "terminal.copy", "alt-left": "send:\u001bb", "ctrl-1": "terminal" },
  "layout:terminals": { "...": "..." },
  "mod:editor":       { "ctrl-s": "editor.save" }
}
// typed args, inside any section, e.g. global:
//   "ctrl-shift-r": {"command": "layout.resize", "args": {"id": "sidebar", "px": 240}}
```

**Sections.**

- The sections are `global`, `layout:<name>` (while that layout shows), `terminal` (a terminal
  has focus) and `mod:<name>`.
- **The more specific section wins:** `layout:*` beats `global`, and `terminal` beats both.

**Actions.** An action is one of:

- a command (`name`, or `name:value` to fill its first argument);
- `{command, args}` for typed arguments;
- `send:<text>` to type bytes into the terminal;
- `<mod>.<command>`, delivered to that mod's `nextCommand()`;
- the literal **`"terminal"`**, which gives the key to the program.

**Defaults.** The current `keys.json` is the shipped default, about 60 bindings:

- the `global` section:
  - **cmd-** keys: q, h, alt-h, t, w, n, p, shift-p, comma, d, shift-d, shift-w, shift-enter,
    b, /, shift-/, shift-l (`layout.switch`), =, +, -, 0, 1–9, [, ], shift-[, shift-]
  - **cmd-alt-** keys: arrows, shift-arrows, [, ]
  - **ctrl-** keys: tab, shift-tab, 1–9
  - **function keys:** f2, shift-f2
- the `terminal` section:
  - **clipboard and search:** cmd-f, cmd-c, cmd-v, ctrl-v (paste image)
  - **readline edits:** alt-left/right/backspace and cmd-left/right/backspace, sent as readline
    bytes

Note **ctrl-1…9 = `space.select`**, which takes those keys away from programs.

**ctrl-v** is bound to `terminal.paste_image`, but locally on macOS it reaches the program [doc].
It intercepts only to paste an image into a terminal on *another machine*, and on Windows it
pastes text. "Otherwise Ctrl+V goes to the program, which reads the clipboard itself." So
nvim's ctrl-v (visual block) works in local panes.

**Unbinding and passthrough.**

- **Pass a key to the focused terminal:** bind it to `"terminal"` in the `terminal` section, e.g.
  `"terminal": {"cmd-d": "terminal", "ctrl-1": "terminal"}`.
  - The `terminal` section beats `global`, so this overrides the app binding only while a
    terminal is focused [doc; AGENTS.md's own example is `"ctrl-1": "terminal"`].
- **Unbind entirely:** delete the entry. The file is wholly "yours" once edited and is not merged
  with defaults [doc, so deleting should unbind: inferred, not tested].
- **What the program then receives for a `cmd-` key:** unverified. "Terminal keys honor the
  program's negotiated Kitty mode" [doc]. Without kitty flags, legacy encoding has no Super
  modifier, so `cmd-x` likely arrives as nothing or as plain `x` [inferred]. With kitty
  progressive enhancement nvim *could* see `<D-x>`. Needs the manual check below.
- **Mods** never see herdr's own bindings (brief, verified earlier). The supported route for a mod
  to get a `cmd-` key is a `mod:<name>` section mapping it to `<mod>.<command>`, read via
  `nextCommand()`. Only shown copies receive it [doc]. Whether an *unbound* `cmd-` key reaches a
  focused mod's `on_key_down` was not tested.
- **Cannot be rebound:** `ctrl-alt-shift-escape` [doc]. On macOS, `app.quit` / `app.hide` are
  also app-menu items, so cmd-q / cmd-h may survive removal from keys.json [inferred].
- **Not testable from here.** Pressing real cmd- keys in the GUI isn't possible. `hc keys`
  bypasses the app's key routing, and osascript would hit whatever window is frontmost. A
  2-minute manual check for Phil:
  1. Add `"terminal": {"cmd-d": "terminal"}`.
  2. In a pane, run `nvim --clean`, then `:nmap <D-d> :echo "got D-d"<CR>`, then press cmd-d.
  3. Separately, run `cat -v` and press cmd-d to see the raw bytes.

### 4. Terminal panes

#### Opening a terminal with a command, cwd and env

| Command | argv | cwd | env |
|---|---|---|---|
| `terminal.open {argv?, folder?, place: "tab"\|"right"\|"down", name?}` | yes | **yes** (`folder`, for tabs and splits) | no |
| `tab.new {name?, space?, folder?, argv?, task?}` | yes | yes | no |
| `space.new {name?, folder?, tab?, argv?, task?, machine?}` | yes | yes | no |
| `pane.split {direction, pane?, argv? \| mod?, props?}` | yes | **no** (inherits) | no |

Source: [doc: `herdr-app commands`].

- **No app command takes env** [doc].
- **For env**, wrap the argv [verified]:
  - `herdr-app do tab.new '{"space":"<id>","name":"envtest","folder":"/Users/phil","argv":["env","FOO=bar","sh","-c","echo FOO=$FOO PWD=$PWD; sleep 6"]}'`
    printed `FOO=bar PWD=/Users/phil`.
  - `terminal.open` has no `space` argument, so **`tab.new --space` is the scriptable route** for
    "nvim in space X".
- **Or use the core API directly.** `hc` API `terminal.run` takes an `env` object ("Clients pass
  their terminal identity here (TERM, TERM_PROGRAM, COLORTERM)"), plus `cwd` and labels
  [doc: `hc schema`].
  - Labelling it `herdr.space=<id>` and `herdr.tab=<id>` makes the app adopt it into that tab
    [doc: AGENTS.md].
  - The `hc run` CLI has `--cwd` and `--label` but no `--env`.
- **How argv runs** [verified via `hc get`]. The core's argv is
  `fish -lic 'command $argv[2..]; exec $argv[1] -li' fish <argv...>`:
  - it runs in a login, interactive fish;
  - `command` means fish *functions* named like the program are bypassed;
  - when the program exits, **the pane stays open as a fresh `fish -li` shell** in the same cwd.
    So quitting nvim leaves a shell pane rather than closing it.
  - The terminal reports `identity: "ghostty"` and `keep: true`.
- **Quick failures surface.** A nonzero exit within 2 s shows an error toast with the last output
  [doc].
- **Layouts** can also place terminal blocks (`{terminal: "t7"}`) [doc], but they reference
  existing terminals rather than spawning them.

#### Rendering fidelity

The emulator is **libghostty** (Ghostty's VT core) inside herdr-core [binary + verified: XTVERSION
answers `ghostty`]. The app draws the cells with GPUI.

Probe results from a terminal pane in the `research-config` space, using a raw-mode Python
script that queried the terminal and logged its replies [verified]:

| Capability | Result |
|---|---|
| Identity env | `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=ghostty` (no `TERM_PROGRAM_VERSION`), `HC_TERMINAL_ID=t16` |
| DA1 / XTVERSION | `CSI ?62;22c` / `DCS >\|ghostty ST` |
| True colour | `COLORTERM=truecolor`. XTGETTCAP `RGB=8`; `Tc` not reported. nvim 0.12 auto-enabled `termguicolors=1` |
| Cursor shape (DECSCUSR) | DECRQSS reports default `2 q` (steady block). After `CSI 6 q` it reports `6` (bar), after `CSI 4 q` it reports `4` (underline). Screenshot: **nvim `--clean` insert mode draws a thin bar cursor** (`herdr-app shot`) |
| Underline styles | XTGETTCAP `Smulx` = `\E[4:%p1%dm` (curly and other styles supported) |
| Mouse reporting | DECRQM recognises 1000/1002/1003/1006 (SGR) and 1004 (focus events). Docs: "Programs that track the mouse still get their mouse events (hold Shift to select text instead)". `terminal.right_click {to: "program"\|"menu"}` routes right-click; Shift+right-click is always Herdr's menu |
| Bracketed paste / sync output | 2004 and 2026 recognised. 2027 (grapheme clustering) reports set |
| Kitty keyboard protocol | Supported: `CSI ?u` gives `?0u`; after push `>1u` it gives `?1u`. Docs: "Terminal keys honor the program's negotiated Kitty mode" |
| Kitty graphics | Query answered `OK`. Docs: Kitty graphics incl. Unicode placeholders (yazi) |
| OSC 52 | **Write only.** Read (`52;c;?`) got no reply [verified]. Docs: base64 UTF-8 up to 1 MiB; `c` system clipboard, `p` Linux primary; reads never allowed; `settings.json` `clipboard_write: false` disables writes. XTGETTCAP `Ms` is advertised |
| Colour queries | OSC 10/11/12 answered (fg `#d2d4d9`, bg `#171a1d`) |
| Size reports | CSI 14t/16t/18t answered. The cell is 10×26 px at zoom 1.2 |
| nvim defaults seen | `mouse=nvi`, `has('clipboard')=1`, `TERM=xterm-256color` |
| Glyphs (font JetBrains Mono, the default) | Screenshot: **Powerline** separators (U+E0B0/E0B2), **Nerd Font icons** (U+F07B, U+F0219, U+E7C5), box drawing, braille and colour emoji all render. Box, block and Powerline are drawn as sprites (`minimum_contrast` never adjusts them [doc]). Icons come from fallback, either Ghostty's embedded symbols or the installed MesloLG* Nerd Fonts in `/Library/Fonts` [inferred]. There's no need to set a Nerd Font for LazyVim icons |

Other documented terminal behaviour [doc]:

- `font_ligatures` is off by default.
- `minimum_contrast` 1 means no colour adjustment.
- `pane_scrollbars` shows on the main screen only.
- `terminal.scroll` does nothing on the alternate screen.
- The find bar is cmd-f.
- "You can't ... change how a terminal itself draws text" from a mod.

**Verdict:** nvim in a terminal pane gets a modern Ghostty-class terminal (checked with
`nvim --clean`, not LazyVim):

- true colour;
- cursor shapes;
- SGR mouse;
- focus events;
- bracketed paste;
- synchronised output;
- the kitty keyboard protocol and graphics;
- styled underlines;
- OSC 52 copy;
- Nerd/Powerline glyphs.

The gaps are **OSC 52 paste** (by design) and the open question of **`cmd-` keys** reaching nvim,
which depends on keys.json passthrough plus kitty encoding.

## Residue

**Restored byte-identically and verified with `cmp`:** `settings.json`, `keys.json`,
`layouts/.state/main.json`.

**Removed:**

- the `research-config` space, created twice. `hc ls` confirms its terminals (t16, t18, t19) are
  gone. The originally active space was reselected;
- `mods/research-config-*`;
- `data/research-config-*`;
- probe files in `~/.config/herdr-app`.

**Left behind**, in app-written bookkeeping that should not be hand-edited:

- `research-config` in `view.json` `recent`;
- the probe mod names in `seen.json`;
- the probe mod names in `telemetry/today.json`.

The telemetry entry lists personal mod names locally. AGENTS.md says the person's own mods are
never *sent*, so presumably they are filtered before sending [inferred].

**In-memory state:** the app may still hold `"dark": "graphite"` as an in-memory theme pick for
`main`, and could write it back on the next layout click. That looks the same as the default, but
**a pinned pick overrides a `settings.json` theme**, which the chezmoi plan relies on. Before
relying on a managed theme, check `layouts/.state/main.json` for a `theme` key. If one is there,
remove it with the app closed, or run `layout.reset {name: "main"}`, which also resets clicks.

## Implications

### chezmoi owning settings.json and keys.json

**`settings.json`: don't manage it as a plain file or a symlink.**

- The app rewrites it on zoom keys and every Settings-UI change.
- It re-serialises the contents (`1` becomes `1.0`, 2-space JSON).
- It atomic-renames the file, which replaces a chezmoi symlink with a regular file [inferred from
  the inode change].
- A plain `chezmoi apply` would fight the zoom keys and the UI.

Options:

- (a) a `modify_settings.json` script that merges only the keys Phil cares about (font,
  font_size, theme, appearance, `clipboard_write`, `option_as_alt`, telemetry) into whatever is
  there;
- (b) `create_` to seed it once;
- (c) own it and accept `chezmoi diff` noise after zooming.

(a) fits best. Note that `zoom` itself is per-machine display state and should stay unmanaged.

**`keys.json`: chezmoi can own it.**

- The app never writes it in normal use.
- An owned (edited) file is never auto-upgraded.
- The trade-offs:
  - new default shortcuts in future releases must be merged by hand;
  - the escape hatch moves the file aside, and the next `chezmoi apply` restores it;
  - a symlink is probably fine, since only the reset path renames it [inferred].
- To catch new defaults on upgrade, diff against the app's defaults: `keys()` in a mod, or a
  fresh `HERDR_APP_HOME`.

**Theme.** Theme picks are UI state in `layouts/.state/`, which is not chezmoi material. Set the
theme declaratively with `theme` in `settings.json` (main has no theme of its own).
`settings.json`'s `theme` is only used where the layout and the picker leave it unset, so avoid
the picker once it's managed.

### The keybindings grilling

Key collisions to decide, by type:

- **Collide with nvim/shell muscle memory:**
  - ctrl-1…9 (`space.select`)
  - ctrl-v, but only for terminals on remote machines (`paste_image`); local panes get it
  - ctrl-tab / ctrl-shift-tab
- **Hold most cmd- keys:**
  - cmd-d, cmd-w, cmd-t, cmd-p, cmd-b, cmd-f, cmd-[ and cmd-]
  - cmd-1…9, cmd-=, cmd--, cmd-0
  - cmd-alt-arrows

The mechanism for "give X back to nvim" is a `terminal`-section entry `"<key>": "terminal"`. It
is scoped to terminal focus, so app navigation from mods and sidebars keeps working.

Open questions:

- Is the `terminal` section scoped by *program*? No: it applies to every terminal [doc]. So
  giving cmd-d to nvim also takes it from shells.
- Does a passed-through `cmd-` key reach nvim as `<D-…>`? This needs the manual check in §3
  before any plan relies on it.
- Mods get bound `cmd-` keys only through `mod:<name>` → `nextCommand()`. Bound keys never
  reach `on_key_down`. Unbound `cmd-` keys reaching `on_key_down` is untested.

### The rendering prototype: terminal pane or mod

**A terminal pane is high-fidelity out of the box.** Running real nvim there means:

- the app owns none of the editor's rendering;
- persistence comes free from herdr-core (`keep`, reattach);
- `tab.new --space --folder` gives per-space cwd;
- `["env", ...]` argv gives env.

**The mod route rebuilds what libghostty already does.** It means grid rendering, cursor shapes,
mouse and IME. It also hits known mod limits:

- a whole-window redraw per mod redraw;
- no cmd- keys;
- the focus gap;
- the bridge-process requirement;
- 250 ms close.

It is only worth it for something a terminal can't do, such as GUI-native widgets over the
buffer.

**Recommendation:**

1. Prototype the terminal-pane path first.
2. Spend the remaining risk budget on the `cmd-`/kitty passthrough check and on OSC 52 paste (use
   `pbpaste` via nvim's clipboard provider locally; remote paste will need another route).
3. If a mod is still wanted for side panels, it can write anywhere with `writeTextFile`, or under
   `~/.config/herdr-app` with `fs`. `capabilities` will not widen this.
