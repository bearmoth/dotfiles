# Keybindings — cross-OS reference and intent

Last major revision: 2026-07-14 (herdr era — supersedes the pre-herdr version
of this doc, which described Ghostty-owned splits and Hyper launchers).

## Architecture: four layers

The guiding principle: **each modifier layer owns one kind of concern**, and
the physical key position (not the label) carries the muscle memory across
OSes.

| Layer | Mac | Linux | Owns |
|---|---|---|---|
| **System / WM** (2nd modifier from left) | Option (⌥) via AeroSpace | Super via Pop Shell/GNOME | Window focus/move, **WM** workspaces, app launchers — anything that works from anywhere |
| **Hyper** (Caps Lock hold = `Ctrl+Alt+Super`, no Shift) | herdr | herdr | Pane-level work inside the terminal: nav, swap, splits, close pane, zoom, resize, plus Ghostty's equalize/quick-terminal |
| **OS-native app conventions** (3rd modifier from left) | Cmd (⌘) | Alt / Ctrl (per app convention) | Browser-style tab & container actions in herdr: tabs, herdr workspaces, agents |
| **prefix** (`Ctrl+B`, tmux-style) | herdr | herdr | Everything occasional: renames, sidebar, goto, worktrees, pickers |

vim keeps its own modal namespaces and never collides: `Ctrl+hjkl`
(smart-splits pane nav), `Shift+H/L` (buffer nav), `Space` leader.

### Position parity (why the layers differ by OS label)

Mac Option and Linux Super are the **same physical key** (2nd from left);
Mac Cmd and Linux Alt are the same physical key (3rd from left, next to
Space). So "2nd key + digit = WM workspace" and "3rd key + digit = herdr
workspace" hold on both OSes with identical finger motion, even though the
key labels differ. Exception: new/close tab follow each OS's *browser*
convention (Cmd+T/W on mac, Ctrl+T/W on linux) rather than strict position
parity, because that muscle memory already exists per-OS.

### The frequency line

Only actions used constantly get direct chords. Occasional actions
deliberately stay on herdr's default `prefix` bindings — a two-keystroke
cost that doesn't matter at low frequency, and it avoids a whole class of
key-forwarding bugs (see Gotchas). When adding a herdr binding, first ask:
is this high-frequency? If not, leave it on prefix.

## Current bindings

### Hyper layer (herdr pane management)

| Chord | Action |
|---|---|
| `Hyper+h/j/k/l` | Focus pane left/down/up/right |
| `Hyper+Shift+h/j/k/l` | Swap pane left/down/up/right |
| `Hyper+-` / `Hyper+\` | Split down / split right (LazyVim `<leader>-`/`\|` mnemonic) |
| `Hyper+w` | Close pane |
| `Hyper+z` | Zoom/unzoom pane (herdr) |
| `Hyper+r` | Resize mode (modal: `h/l` width, `j/k` height, `Esc` exits) |
| `Hyper+=` | Equalize splits (Ghostty — only remaining Ghostty split action) |
| `` Hyper+` `` | Quick terminal (Ghostty global hotkey) |

### OS-native layer (herdr tabs / workspaces / agents)

| Action | Mac | Linux |
|---|---|---|
| New tab | `Cmd+T` | `Ctrl+T` |
| Close tab | `Cmd+W` | `Ctrl+W` ⚠ see Linux TODO |
| Prev / next tab | `Cmd+[` / `Cmd+]` | `Alt+[` / `Alt+]` |
| Switch herdr workspace | `Cmd+1..9` | `Alt+1..9` |
| Focus agent | `Cmd+Shift+1..9` | `Alt+Shift+1..9` |
| New herdr workspace | `Cmd+Shift+N` | `Alt+Shift+N` |
| Close Ghostty window (escape hatch) | `Cmd+Shift+W` | Ghostty default |

`Cmd+Shift+W` is Ghostty's default `close_window`, deliberately left bound:
it's the way to close an empty Ghostty window when no herdr client is
attached (`Cmd+W` belongs to herdr). Closing the window never kills panes —
the herdr server is a daemon (PPID 1) and all pane shells are its children.

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

`goto` (session navigator), tab/workspace/pane renames, `toggle_sidebar`,
`close_workspace` (prefix+shift+d), `workspace_picker` (prefix+w), copy
mode (prefix+[), cycle panes (prefix+Tab), detach (prefix+q), worktree
actions. These are low-frequency by design — do not migrate them without
reconsidering the frequency line.

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
   `super`=Cmd(mac)/Super(linux), `alt`=Option(mac)/Alt(linux).

## Linux TODO (for the agent doing the Linux-side setup)

1. **⚠ `close_tab = "ctrl+w"` shadows delete-word-backward** in fish/bash
   and vim insert mode — a heavily-used editing key. Confirm the user wants
   this before applying on Linux; `ctrl+shift+w` is the collision-free
   alternative. (`ctrl+t` shadows transpose-chars; nobody cares.)
2. **Launchers not yet migrated.** GNOME custom keybinding `custom0`
   (`<Super>t` → ghostty) already exists in the dconf dump. Add
   `custom1..4` for Chrome/Slack/VSCode/Obsidian via `gsettings` on the
   live machine, then re-capture: `chezmoi add ~/.config/dconf/user`.
   `dot_config/dconf/user` is a **binary GVariant database — never
   hand-edit**.
3. **Check Pop Shell's claimed keys first:**
   `gsettings list-recursively org.gnome.shell.extensions.pop-shell` —
   the dconf dump only shows non-default keys, so Pop Shell's real keymap
   is invisible in the repo. Verify `alt+[/]`, `alt+1..9`, `alt+shift+n`
   aren't taken before trusting the herdr bindings.
4. **Verify Ghostty's Linux defaults.** The `alt+1..9` unbinds in
   `config.tmpl`'s linux block are speculative (written from a mac, where
   those defaults don't exist). Run `ghostty +list-keybinds --default` on
   Linux and adjust.
5. **Pop Shell remap to hjkl** (from the original plan): Pop Shell defaults
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
| `dot_config/herdr/config.toml.tmpl` | All herdr bindings (templated per OS) |
| `dot_config/ghostty/config.tmpl` | Ghostty unbinds + its 3 remaining Hyper actions |
| `dot_config/aerospace/aerospace.toml` | Mac WM + launchers |
| `dot_config/private_karabiner/private_karabiner.json` | Caps→Hyper/Esc (mac) |
| `dot_config/keyd/default.conf` | Caps→Hyper/Esc (linux) |
| `dot_config/dconf/user` | GNOME/Pop Shell state (binary — never hand-edit) |
