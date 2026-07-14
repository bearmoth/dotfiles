# Keybindings — cross-OS reference and intent

Last major revision: 2026-07-14 (Hyper-collapse era — supersedes the
brief four-layer scheme from earlier the same day, which split herdr
actions across Hyper *and* Cmd/Alt. That split turned out to cost more in
layer-switching decisions ("is this a pane thing or a tab thing?") than it
gained from browser-convention muscle memory, so every herdr action now
lives on one modifier).

## Architecture: three layers

The guiding principle: **each modifier layer owns one kind of concern**, and
the physical key position (not the label) carries the muscle memory across
OSes.

| Layer | Mac | Linux | Owns |
|---|---|---|---|
| **System / WM** (2nd modifier from left) | Option (⌥) via AeroSpace | Super via Pop Shell/GNOME | Window focus/move, **WM** workspaces, app launchers — anything that works from anywhere |
| **Hyper** (Caps Lock hold = `Ctrl+Alt+Super`, no Shift) | herdr | herdr | **Everything herdr, high-frequency:** pane nav/swap/splits/close/zoom/resize, tabs, herdr workspaces, agents — plus Ghostty's equalize/quick-terminal |
| **prefix** (`Ctrl+B`, tmux-style) | herdr | herdr | Everything occasional: renames (except tab), sidebar, goto, worktrees, pickers, whole-tab close |

Cmd (mac) / Alt (linux) carry **no herdr bindings at all** — they're left
entirely to Ghostty and macOS/GNOME's own native shortcuts (new window,
quit, settings, reload-config). Since Hyper is the identical chord
(`ctrl+alt+super`) on both OSes, herdr's config needs almost no per-OS
templating anymore — a side benefit of the collapse, not the reason for it.

vim keeps its own modal namespaces and never collides: `Ctrl+hjkl`
(smart-splits pane nav), `Shift+H/L` (buffer nav), `Space` leader.

### The frequency line

Only actions used constantly get direct chords. Occasional actions
deliberately stay on herdr's default `prefix` bindings — a two-keystroke
cost that doesn't matter at low frequency, and it avoids a whole class of
key-forwarding bugs (see Gotchas). When adding a herdr binding, first ask:
is this high-frequency? If not, leave it on prefix.

## Current bindings

### Hyper layer (all herdr high-frequency actions)

| Chord | Action |
|---|---|
| `Hyper+h/j/k/l` | Focus pane left/down/up/right |
| `Hyper+Shift+h/j/k/l` | Swap pane left/down/up/right |
| `Hyper+-` / `Hyper+\` | Split down / split right (LazyVim `<leader>-`/`\|` mnemonic) |
| `Hyper+w` | Close pane (closing a tab's last pane auto-closes the tab — verified via herdr's pane/tab API 2026-07-14) |
| `Hyper+z` | Zoom/unzoom pane (herdr) |
| `Hyper+r` | Resize mode (modal: `h/l` width, `j/k` height, `Esc` exits) |
| `Hyper+t` | New tab |
| `Hyper+Shift+T` | Rename tab |
| `Hyper+[` / `Hyper+]` | Previous / next tab |
| `Hyper+1..9` | Switch herdr workspace |
| `Hyper+Shift+1..9` | Focus agent |
| `Hyper+n` | New herdr workspace |
| `Hyper+Shift+n` | Rename herdr workspace |
| `Hyper+=` | Equalize splits (Ghostty — only remaining Ghostty split action) |
| `` Hyper+` `` | Quick terminal (Ghostty global hotkey) |

Whole-tab close (all panes at once, not just the last one) deliberately
stays on herdr's own default `prefix+shift+x` rather than Hyper — see
"Still on prefix" below.

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

`goto` (session navigator), pane rename, `toggle_sidebar`, `close_tab`
(prefix+shift+x — one-shot close of a whole multi-pane tab; `Hyper+w`
only closes one pane at a time), `close_workspace` (prefix+shift+d),
`workspace_picker` (prefix+w), copy mode (prefix+[), cycle panes
(prefix+Tab), detach (prefix+q), worktree actions. These are low-frequency
by design — do not migrate them without reconsidering the frequency line.

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
