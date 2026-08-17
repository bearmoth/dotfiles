# Keybindings — cross-OS reference and intent

Last major revision: 2026-07-14 (Hyper-collapse era — supersedes the
brief four-layer scheme from earlier the same day, which split herdr
actions across Hyper *and* Cmd/Alt. That split turned out to cost more in
layer-switching decisions ("is this a pane thing or a tab thing?") than it
gained from browser-convention muscle memory, so every herdr action now
lives on one modifier).

Amended 2026-08-17: `close_pane` moved off Hyper+w to herdr's own default
`prefix+x` — see "The reversibility line" below. Nothing else changed.

## Architecture: three layers

The guiding principle: **each modifier layer owns one kind of concern**, and
the physical key position (not the label) carries the muscle memory across
OSes.

| Layer | Mac | Linux | Owns |
|---|---|---|---|
| **System / WM** (2nd modifier from left) | Option (⌥) via AeroSpace | Super via Pop Shell/GNOME | Window focus/move, **WM** workspaces, app launchers — anything that works from anywhere |
| **Hyper** (Caps Lock hold = `Ctrl+Alt+Super`, no Shift) | herdr | herdr | **Everything herdr, high-frequency *and reversible*:** pane nav/swap/splits/zoom/resize, tabs, herdr workspaces, agents — plus Ghostty's equalize/quick-terminal |
| **prefix** (`Ctrl+B`, tmux-style) | herdr | herdr | Everything occasional **or destructive**: renames (except tab), sidebar, goto, worktrees, pickers, pane close, whole-tab close |

Cmd (mac) / Alt (linux) carry **no herdr bindings at all** — they're left
entirely to Ghostty and macOS/GNOME's own native shortcuts (new window,
quit, settings, reload-config). Since Hyper is the identical chord
(`ctrl+alt+super`) on both OSes, herdr's config needs almost no per-OS
templating anymore — a side benefit of the collapse, not the reason for it.

vim keeps its own modal namespaces and never collides: `Ctrl+hjkl`
(smart-splits pane nav), `Shift+H/L` (buffer nav), `Space` leader.

The layers are **nested** — nvim runs inside a herdr pane — so "the split"
has two referents, and the namespaces are what disambiguate them in the
hand: `<leader>` sequences act *inside* nvim (window/buffer), `prefix`
sequences act *on* herdr (pane/tab). Note `Ctrl+hjkl` does **not** fall
through into an adjacent herdr pane: `dot_config/nvim/lua/plugins/smart-splits.lua`
configures no multiplexer backend (smart-splits ships tmux/wezterm/kitty
backends, not herdr), so it stays inside nvim. `Hyper+hjkl` is how you
leave the pane.

### The frequency line

Only actions used constantly get direct chords. Occasional actions
deliberately stay on herdr's default `prefix` bindings — a two-keystroke
cost that doesn't matter at low frequency, and it avoids a whole class of
key-forwarding bugs (see Gotchas). When adding a herdr binding, first ask:
is this high-frequency? If not, leave it on prefix.

### The reversibility line

Frequency is necessary but not sufficient. Hyper's premise is "fire without
thinking", which only holds if every action on it is **reversible or
additive** — nav, swap, split, zoom, resize, tab/workspace switch, popups
all are. Closing a pane is not: a pane is a live process, and herdr has no
buffer layer to fall back on. `prefix+x` maps to vim's `<leader>wd` in
*geometry* but to `<leader>bD` ("Delete Buffer and Window") in
*consequence* — there is no non-destructive pane close.

That asymmetry is why `close_pane` came off Hyper+w (2026-08-17, after
repeated accidental fires) rather than being relocated to another chord:
the fix wasn't the key, it was the gating. It also restores LazyVim parity,
which the original Hyper+w binding was reaching for but inverted — nvim
closes with `<leader>wd` / `<leader><tab>d`, leader-gated multi-key
sequences, never a one-shot chord. There is no `<leader>w` that closes
anything on its own; `w` and `b` are which-key *groups*. herdr's `prefix`
**is** that leader.

So: **high-frequency AND reversible → Hyper. Otherwise → prefix.**

## Current bindings

### Hyper layer (all herdr high-frequency actions)

| Chord | Action |
|---|---|
| `Hyper+h/j/k/l` | Focus pane left/down/up/right |
| `Hyper+Shift+h/j/k/l` | Swap pane left/down/up/right |
| `Hyper+-` / `Hyper+\` | Split down / split right (LazyVim `<leader>-`/`\|` mnemonic) |
| `Hyper+z` | Zoom/unzoom pane (herdr) |
| `Hyper+r` | Resize mode (modal: `h/l` width, `j/k` height, `Esc` exits) |
| `Hyper+t` | New tab |
| `Hyper+Shift+T` | Rename tab |
| `Hyper+[` / `Hyper+]` | Previous / next tab |
| `Hyper+1..9` | Switch herdr workspace |
| `Hyper+Shift+1..9` | Focus agent |
| `Hyper+n` | New herdr workspace |
| `Hyper+Shift+n` | Rename herdr workspace |
| `Hyper+g` | lazygit in a popup (herdr `type = "popup"`, via `lazygit-popup`) |
| `Hyper+c` | cheat wiki fuzzy popup (herdr `type = "popup"`, via `cheat-popup`) |
| `Hyper+=` | Equalize splits (Ghostty — only remaining Ghostty split action) |
| `` Hyper+` `` | Quick terminal (Ghostty global hotkey) |

`Hyper+w` is deliberately **unbound** — see "The reversibility line". An
unbound Hyper chord falls through to its `Ctrl+` equivalent (Gotcha #3), so
`Hyper+w` now lands on `Ctrl+W` (kill-word-backwards) in the shell, which is
harmless. Verified for `Hyper+c`→`Ctrl+C`; assumed, not tested, for `w`.

**Popups** (herdr 0.7.4+, installed 0.8.0): `[[keys.command]]` with `type = "popup"` opens a
session-modal floating terminal centred over the *whole tab* (not the active
pane), leaving the tiled layout frozen beneath; it closes when its command
exits. Both binds call wrapper scripts in `dot_local/bin` rather than the tool
directly — a popup starts in a default cwd (not the active pane's), so
`lazygit-popup` cd's into `$HERDR_ACTIVE_PANE_CWD` first, and `cheat-popup`
needs a real shell for its fzf picker. `c` is safe here *because* herdr owns
the chord: an **un**bound `Hyper+c` degrades (via fall-through) to `Ctrl+C` and
clears your input — Gotcha #3 — but a bound one is intercepted by herdr first.

Both closes — pane (`prefix+x`) and whole-tab (`prefix+shift+x`) — stay on
herdr's own defaults rather than Hyper. See "Still on prefix" below.

`Cmd+Shift+W` is Ghostty's default `close_window`, deliberately left bound
(mac only): it's the way to close an empty Ghostty window when no herdr
client is attached. Closing the window never kills panes — the herdr
server is a daemon (PPID 1) and all pane shells are its children.

### System / WM layer (AeroSpace on Mac; Linux pending)

| Chord (Mac) | Action |
|---|---|
| `Option+h/j/k/l` | Focus window |
| `Option+Shift+h/j/k/l` | Move window |
| `Option+1..9` / `Option+Shift+1..9` | Switch / move-to WM workspace |
| `Option+Tab` | Previous workspace toggle |
| `Option+t/b/s/v/n` | Launch-or-focus Ghostty / Chrome / Slack / VSCode / Obsidian |
| `Option+/` `Option+,` `Option+f` `Option+Shift+Space` `Option+Esc` `Option+Shift+;` | Layout toggles, fullscreen, float, daemon pause, service mode |

`Option+Left/Right` deliberately unbound (word navigation in text fields).

### Still on prefix (`Ctrl+B`) — deliberate

`close_pane` (prefix+x — one pane at a time; the tab auto-closes with its
last pane), `close_tab` (prefix+shift+x — one-shot close of a whole
multi-pane tab), `close_workspace` (prefix+shift+d), `goto` (session
navigator), pane rename, `toggle_sidebar`, `workspace_picker` (prefix+w),
copy mode (prefix+[), cycle panes (prefix+Tab), detach (prefix+q), worktree
actions. All are herdr's own defaults — nothing here is configured. They are
low-frequency **or destructive** by design; do not migrate them without
reconsidering the frequency *and* reversibility lines.

Note `prefix+w` is `workspace_picker`, not a close — the close verbs are the
`x` family.

### The nvim ↔ herdr model

The two nest, and closing behaves the same at both depths (last child takes
its parent with it):

| nvim | herdr | close |
|---|---|---|
| window (split) | **pane** | `<leader>wd` ↔ `prefix+x` |
| tabpage | **tab** | `<leader><tab>d` ↔ `prefix+shift+x` |
| buffer | *— no analogue —* | `<leader>bd` ↔ nothing |
| *— no analogue —* | workspace | — ↔ `prefix+shift+d` |

The missing buffer row is the whole asymmetry: a herdr pane is a live
process, not a swappable document, so there is no "put it away, keep it
running". Untested: what happens when the cascade reaches the last pane of
the last tab in a workspace (vim refuses with `E444`; herdr may close the
workspace, or refuse). `[ui] confirm_close` defaults to `true` but its own
comment scopes it to closing a *workspace* — do not assume it backstops a
pane cascade until you have seen it fire.

## Gotchas (hard-won — read before changing anything)

1. **Reload is manual/scripted, never automatic.** `chezmoi apply` reloads
   nothing by itself. herdr is auto-reloaded by
   `run_onchange_after_reload-herdr.sh.tmpl` (hashes the config template);
   AeroSpace by `run_onchange_after_reload-aerospace.sh.tmpl`. Ghostty has
   **no CLI/signal reload** — press `Cmd+Shift+,` (mac) / `Ctrl+Shift+,`
   (linux) after any Ghostty config change.
2. **Ghostty ships defaults that silently eat keys.** Before giving herdr
   any chord, check `ghostty +list-keybinds --default` and unbind matches.
   Digits are double-registered (`super+1` AND `super+digit_1`) — unbind
   both spellings. Verify with `ghostty +list-keybinds` (no `--default`).
3. **Direct herdr bindings need printable base keys.** Ghostty's `unbind`
   only forwards printable keys to the child; `Ctrl+Tab` can never reach
   herdr (verified: plain unbind, `unconsumed:+ignore`, `unconsumed:+unbind`
   all fail). herdr's key parser also lacks page keys entirely. Letters,
   digits, punctuation work; Tab/PageUp/etc. don't.
4. **`Cmd+H` is macOS Hide** — menu-level, fires before Ghostty sees it.
   Never bind it.
5. **`herdr server reload-config` returning clean diagnostics ≠ the key
   works.** It proves parsing only. Test the actual keypress. Invalid key
   *names* do error loudly; hijacked dispatch (e.g. a default Shift-companion
   overriding an explicit binding) does not.
6. **`herdr --default-config` is not the full schema.** `swap_pane_*` and
   others are valid but undocumented — check `strings $(which herdr)` before
   declaring a config key nonexistent.
7. **User vocabulary:** "super" in conversation means **Hyper** (Caps Lock),
   not the config-syntax `super` (which is Cmd on mac). Config syntax:
   `super`=Cmd(mac)/Super(linux), `alt`=Option(mac)/Alt(linux). Now that
   herdr owns nothing on Cmd/Alt, this trap mostly only matters when
   editing `dot_config/ghostty/config.tmpl`'s own unbind blocks.

## Linux TODO (for the agent doing the Linux-side setup)

1. **Launchers not yet migrated.** GNOME custom keybinding `custom0`
   (`<Super>t` → ghostty) already exists in the dconf dump. Add
   `custom1..4` for Chrome/Slack/VSCode/Obsidian via `gsettings` on the
   live machine, then re-capture: `chezmoi add ~/.config/dconf/user`.
   `dot_config/dconf/user` is a **binary GVariant database — never
   hand-edit**.
2. **Check Pop Shell's claimed keys first:**
   `gsettings list-recursively org.gnome.shell.extensions.pop-shell` —
   the dconf dump only shows non-default keys, so Pop Shell's real keymap
   is invisible in the repo. Since herdr no longer uses any Alt chords,
   this is now purely about WM-layer collisions (Super+arrows etc.), not
   herdr ones.
3. **Verify Ghostty's Linux defaults for the Hyper chords.** herdr's config
   now uses the same `ctrl+alt+super+*` chords on both OSes; confirm none
   of them collide with a Linux-only Ghostty default via
   `ghostty +list-keybinds --default` on the actual Linux build.
4. **Pop Shell remap to hjkl** (from the original plan): Pop Shell defaults
   to `Super+arrows`; remap to `Super+hjkl` for parity with AeroSpace.

## AeroSpace operational notes (Mac)

- **Activation gate:** deploys only when `features.aerospace = true` in
  `~/.config/chezmoi/chezmoi.toml` AND os = darwin (`.chezmoiignore`
  double-gate).
- **Service mode** (`Option+Shift+;`): `Esc` reloads config + exits, `r`
  flattens the layout tree (the "reset everything" key), `Shift+hjkl`
  joins containers.
- **`Cmd+M` (minimise) breaks the layout** — AeroSpace can't recover
  minimised windows; restore from Dock, then service-mode `r`.
- **macOS Spaces must be collapsed to one.**
  `run_once_after_macos-spaces-settings.sh.tmpl` disables the worst
  settings; delete extra Spaces manually in Mission Control.
- **Recovery sequence:** service-mode `r` → `Option+f` (exit AeroSpace
  fullscreen) → `Cmd+Ctrl+F` (exit macOS fullscreen) → check Dock for
  minimised windows.
- **Float-by-default apps:** 1Password, System Settings, Calculator,
  Activity Monitor, Karabiner-Elements, Raycast. Temporary float:
  `Option+Shift+Space`.

## Config files

| File | Owns |
|---|---|
| `dot_config/herdr/config.toml.tmpl` | All herdr bindings (almost entirely untemplated — Hyper is the same chord on both OSes) |
| `dot_config/ghostty/config.tmpl` | Ghostty unbinds (keep Cmd/Alt off Ghostty's unused native tab/split system) + its 3 remaining Hyper actions |
| `dot_config/aerospace/aerospace.toml` | Mac WM + launchers |
| `dot_config/private_karabiner/private_karabiner.json` | Caps→Hyper/Esc (mac) |
| `dot_config/keyd/default.conf` | Caps→Hyper/Esc (linux) |
| `dot_config/dconf/user` | GNOME/Pop Shell state (binary — never hand-edit) |
