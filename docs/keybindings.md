# Keybindings — cross-OS reference

## Architecture overview

Two non-overlapping modifier namespaces run side-by-side:

| Namespace | Modifier | Owns | Platform |
|---|---|---|---|
| **Ghostty splits** | Hyper (`Ctrl+Alt+Cmd`) | In-terminal nav | macOS + Linux |
| **AeroSpace / WM** | Option (⌥) on Mac · Super on Linux | Between-window nav | macOS (AeroSpace) · Linux (Hyprland / Pop Shell) |

These namespaces cannot collide — they share no chord. No toggle, no mode-switch, no daemon-disable is required for coexistence. AeroSpace's `enable toggle` (bound to `Option+Esc`) exists only for orthogonal reasons: screen-sharing, demos, or troubleshooting.

### Why Option on Mac, Super on Linux?

Option (Mac) and Super / Windows key (Linux) sit in the **same physical position** on their respective keyboards: second-from-left modifier. The muscle memory for `Option+hjkl` (Mac) and `Super+hjkl` (Linux) is identical — same finger, same motion, different label. This is not a coincidence to preserve; it's a constraint to design around.

### Why not Cmd?

`Cmd+letter` has critical system-wide collisions on macOS:

| Chord | Taken by |
|---|---|
| `Cmd+H` | Hide focused app (system, un-remappable) |
| `Cmd+K` | Command palette in VS Code, Zed, Slack, Linear, and others |
| `Cmd+L` | Focus URL bar in every browser |
| `Cmd+digit` | Tab switching in browsers; file switching in IDEs |

### Why not bare Option for everything?

AeroSpace binds **per-chord**, not per-modifier. So `Option+hjkl` and `Option+1..9` are bound to AeroSpace, while `Option+Left` and `Option+Right` (word navigation in text fields) are deliberately left untouched. AeroSpace claiming the Option modifier does not mean Option+anything goes to AeroSpace.

### Why Hyper for Ghostty?

`Ctrl+Alt+Cmd` (3-of-4 modifiers, no Shift) is a synthetic "Hyper" key. No application binds three-modifier chords, so Ghostty's namespace is unconditionally collision-free. Dropping Shift from the Hyper definition also frees `Hyper+Shift+X` as a genuine second layer (used for resize bindings).

---

## App launch

Hyper (`Ctrl+Alt+Cmd`) + letter. Focuses the existing window if the app is already running; launches it if not. Defined in `dot_config/aerospace/aerospace.toml` via `exec-and-forget open -a`.

| Chord | App |
|---|---|
| `Hyper + t` | Ghostty |
| `Hyper + b` | Google Chrome |
| `Hyper + n` | Obsidian |
| `Hyper + s` | Slack |
| `Hyper + v` | Visual Studio Code |

> These use `open -a` (not `-na`). `open -a` activates the existing process, preventing orphaned app instances. On macOS, if the app is already open, it raises the most recent window.

---

## Ghostty splits

Hyper = Caps Lock (hold). Tap Caps Lock alone = Escape.

| Chord | Action |
|---|---|
| `Hyper + \|` | New split right |
| `Hyper + -` | New split down |
| `Hyper + h/j/k/l` | Navigate to split left/down/up/right |
| `Hyper + Shift + h/j/k/l` | Resize split left/down/up/right |
| `Hyper + w` | Close split |
| `Hyper + z` | Zoom / unzoom split |
| `Hyper + =` | Equalize splits |
| `Hyper + `` ` | Toggle quick terminal (global hotkey — works outside Ghostty) |

Config file: `dot_config/ghostty/config.tmpl`

---

## AeroSpace (macOS)

Option (⌥) modifier throughout.

### Focus + move

| Chord | Action |
|---|---|
| `Option + h/j/k/l` | Focus window left/down/up/right |
| `Option + Shift + h/j/k/l` | Move window left/down/up/right |

### Workspaces

| Chord | Action |
|---|---|
| `Option + 1..9` | Switch to workspace N |
| `Option + Shift + 1..9` | Move focused window to workspace N |
| `Option + Tab` | Toggle between two most recently used workspaces |

### Layout

| Chord | Action |
|---|---|
| `Option + /` | Toggle layout: tiles ↔ accordion |
| `Option + ,` | Toggle orientation: horizontal ↔ vertical (within current layout) |
| `Option + f` | Fullscreen toggle |
| `Option + Shift + Space` | Toggle float ↔ tile for current window |

### Daemon control

| Chord | Action |
|---|---|
| `Option + Esc` | Pause / resume AeroSpace (`enable toggle`) |
| `Option + Shift + ;` | Enter service mode |

**Service mode bindings** (after `Option+Shift+;`):

| Key | Action |
|---|---|
| `Esc` | Reload config + exit service mode |
| `r` | Flatten workspace layout tree — the "reset everything" key |
| `Shift + h/j/k/l` | Join focused container with neighbour (merge containers) |

> Service mode is a leader-key layer where every keypress runs a command immediately. Keep bindings here conservative — accidental keypresses have no undo.

### Preserved (NOT bound to AeroSpace)

- `Option + Left / Right` → word navigation in any text field (browser URL bars, editors, terminals)
- `Hyper + anything` → Ghostty only

### Behaviour notes

**`Option+f` is AeroSpace fullscreen, not macOS fullscreen.**
AeroSpace's `fullscreen` command zooms the focused window to fill the entire workspace within AeroSpace's layout — it does not invoke macOS native fullscreen (the green button / `Cmd+Ctrl+F`). If a window enters macOS native fullscreen, AeroSpace loses control of it entirely. Exit macOS native fullscreen with `Cmd+Ctrl+F` or the green button.

**`Cmd+H` (hide) is safe.** `automatically-unhide-macos-hidden-apps = true` is set in the config — AeroSpace will automatically unhide an app the moment it focuses one of its windows. Hide and switch away freely.

**`Cmd+M` (minimise) breaks the layout.** Minimise sends the window to the Dock and removes it from AeroSpace's layout tree. AeroSpace cannot recover minimised windows automatically. If you accidentally minimise, click the window in the Dock to restore it, then use service mode `r` to flatten and re-tile.

**The layout is a tree, not a grid.** Moving a window "into" another creates a nested container (a split within a split), which causes unequal sizes. Service mode `r` (`flatten-workspace-tree`) collapses the entire tree back to a flat row — always safe to run when the layout looks wrong.

**macOS Spaces must be collapsed to one.** AeroSpace manages virtual workspaces on a single macOS Space. Multiple Spaces cause AeroSpace to lose windows and produce erratic jumping behaviour. The `run_once_after_macos-spaces-settings.sh.tmpl` script disables the two worst offenders (`mru-spaces` and `AppleSpacesSwitchOnActivate`) but you must manually delete extra Spaces in Mission Control.

### Recovery sequence

When confused about current state:

1. `Option+Shift+;` → `r` — flatten layout, back to clean even split
2. `Option+f` — exit AeroSpace fullscreen if a window is zoomed
3. `Cmd+Ctrl+F` — exit macOS native fullscreen if AeroSpace can't see the window
4. Reopen any window that disappeared (it was likely minimised — check the Dock)

Config file: `dot_config/aerospace/aerospace.toml`

---

## Linux WM — future state

When AeroSpace is proven on Mac, the same chord shape ports to Linux with `Super` replacing `Option`.

| Mac chord | Linux chord | Action |
|---|---|---|
| `Option + h/j/k/l` | `Super + h/j/k/l` | Focus window |
| `Option + Shift + h/j/k/l` | `Super + Shift + h/j/k/l` | Move window |
| `Option + 1..9` | `Super + 1..9` | Switch workspace |
| `Option + Shift + 1..9` | `Super + Shift + 1..9` | Move to workspace |

**Hyprland** defaults already live at `Super+hjkl` and `Super+1..9` — no remapping needed, just keep defaults.

**Pop Shell (GNOME)** uses `Super+arrows` by default. If adopting it, remap to `Super+hjkl` for consistency (Pop Shell supports custom bindings).

Linux config files are out of scope for the current change (tracked under a future `features.hyprland` flag).

---

## Activation gate (AeroSpace)

AeroSpace is opt-in per machine. Deploying the config requires both:

1. `features.aerospace = true` in `~/.config/chezmoi/chezmoi.toml` (local override, not in repo)
2. OS = darwin (`.chezmoiignore` double-gates — Linux machines cannot accidentally deploy it)

**Enable on a Mac:**

```toml
# ~/.config/chezmoi/chezmoi.toml — add this block:
[data.features]
aerospace = true
```

```sh
chezmoi apply
open -a AeroSpace
```

**Disable / rollback:**

```sh
# Remove [data.features] block from chezmoi.toml (or set aerospace = false)
chezmoi apply --remove   # --remove required: chezmoi doesn't delete ignored files by default
killall AeroSpace
```

**Note:** `chezmoi apply` runs `run_once_after_macos-spaces-settings.sh.tmpl` which automatically disables the two macOS settings that conflict with AeroSpace (`mru-spaces` and `AppleSpacesSwitchOnActivate`). You must still manually delete extra Spaces in Mission Control (swipe up → hover Space → click ×) until only one remains.

---

## Float-by-default apps

These apps auto-float in AeroSpace rather than tiling:

- 1Password (`com.1password.1password`)
- System Settings (`com.apple.systempreferences`)
- Calculator (`com.apple.calculator`)
- Activity Monitor (`com.apple.ActivityMonitor`)
- Karabiner-Elements (`org.pqrs.Karabiner-Elements.Settings`)
- Raycast (`com.raycast.macos`)

To force any other app to float temporarily: `Option + Shift + Space`.
