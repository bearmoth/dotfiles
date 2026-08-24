# Modes extension — rolling journal

Operational log for issues, surprises, and improvement ideas observed while
using this extension. Newest entries first. Rollout points = git history of
this directory in the chezmoi repo (`git log -- private_dot_pi/private_agent/extensions/modes/`).

Entry format:

```
## YYYY-MM-DD — short title
What happened / what was observed. What (if anything) was changed.
```

---

## 2026-08-24 — Dispatch toggle: rounds 3–5, settled on ctrl+d
Third–fifth live tests, all key-related. Findings worth keeping:
- **User was pressing ctrl+cmd+d** (macOS Look Up), not ctrl+option+d — on
  Mac keyboards nothing is labeled "alt". In key hints for this user, say
  **option**, never alt.
- Added `/dispatches key`: one-shot raw-input capture that notifies
  `parseKey` + escaped bytes for the next keypress. Kept — cheap, and it
  ended three rounds of guessing in one test.
- **Kitty keyboard protocol sends press+release events** (`\x1b[100;7:1u` /
  `:3u`). Raw `onTerminalInput` listeners run *upstream* of the TUI's
  release filter, so a naive toggle fires twice per tap. Guard with
  `!isKeyRelease(data) && !isKeyRepeat(data)`.
- Chord ergonomics: user vetoed three-modifier chords (dygma defy thumb
  clusters) and F-keys. Two-key audit: pi built-ins claim every ctrl+letter
  except q (i/m are Tab/Enter-ambiguous). Tried ctrl+q; user then chose to
  **pinch ctrl+d** ("ctrl+d doesn't quit nvim").
- Final binding: **ctrl+d toggles the panel, orchestrate mode only**,
  consumed in the raw listener before pi's exit binding. Carve-out: detail
  pane focused ⇒ pass through (stays nvim page-down). Other modes keep pi's
  clear/exit behavior.
Status: toggle confirmed working live. Split presentation still untested.

---

## 2026-08-24 — Dispatch sidebar live-test fixes (round 2)
Second test: ctrl+alt+d dead, /dispatches opened but nothing could close it
(had to kill the herdr pane). Root causes, from reading the input pipeline
(tui.js handleTerminalInput → focused component):
- **Extension shortcuts only fire when the editor has focus** — they hang
  off `defaultEditor.onExtensionShortcut` inside the editor's handleInput.
  Once the overlay took focus, ctrl+alt+d went to the pane, not the
  shortcut. And in EDIT mode the editor never even saw it if another
  binding claimed it. Fix: toggle now uses `ctx.ui.onTerminalInput` (raw
  listener, runs *before* focus dispatch, consume:true) — works regardless
  of what has focus. registerShortcut removed.
- **`setFocus(null)` drops all input** — round 1's close() "fallback" was
  itself a lockout: a null-focused TUI sends keys nowhere (the editor is
  not a default target). Fix: overlay `handle.hide()` already restores its
  own preFocus; close() only re-sets focus for the split mounting, never
  null.
- Panes now treat ctrl+c/ctrl+q (list also ctrl+d) as close — interrupt-ish
  keys must never be swallowed by a pane.
Also confirmed: `tuiMode: fullscreen` in settings.json requires a full pi
restart (not /reload, which only reloads extensions).

---

## 2026-08-24 — Dispatch sidebar live-test fixes (round 1)
First interactive test found two lockouts:
- `alt+d` never fired: it collides with built-in `tui.editor.deleteWordForward`
  and pi *skips* conflicting extension shortcuts (runner.getShortcuts
  diagnostics). Rebound to **ctrl+alt+d** (matches ctrl+alt+m style).
- `/dispatches` "cursor disappears, can't return": the overlay's
  `visible: w >= 80` predicate hid the pane while it kept keyboard focus —
  focused-but-invisible = input lockout. Removed all visible() predicates;
  `close()` now always restores focus (setFocus(null) fallback) and pane
  handleInput/render are try/caught so an exception can't wedge input.
  /dispatches with no arg now force-closes when open. Split presentation is
  opt-in only (`/dispatches split`); default auto = overlay.

---

## 2026-08-24 — Dispatch sidebar + detail pane + widget strip
Designed via grilling session; implemented `dispatch-log.ts` (in-memory
DispatchLog, rebuilt from session entries on start) and `dispatch-panel.ts`
(sidebar list, detail pane, widget strip). Wired: alt+d toggle, /dispatches
command (overlay|split|auto presentation), strip above editor in Orchestrate.
Split presentation wraps the fullscreen layout root via undocumented
`ViewportTUI.setLayoutRoot` + private `layoutRoot` read — guarded, falls
back to overlay; may break on pi upgrades. Not yet live-tested in an
interactive TUI (needs an orchestrate session with real dispatches);
type-check via ad-hoc tsconfig only (pre-existing AgentToolResult typing
quirk in dispatch.ts noted, unrelated).

---

## 2026-02 (2026-08-20 local) — Orchestrate mode v1 shipped
Implemented per ORCHESTRATE-SPEC.md: orchestrate mode, `dispatch_task`,
`--op-mode` process-locked worker modes, reviewer gh pairs, gerund footer,
orchestrating skill. Live-tested end-to-end (implementor dispatch created a
file, result shape correct; explore/orchestrate mutation blocking verified;
dispatch_task absent outside orchestrate). Known gaps:

- Gerund footer not visually verified in an interactive TUI session yet.
- `~/.pi/agent/orchestrator-sessions/` grows unbounded; no cleanup policy.
- Worker session files are found by globbing the pinned `--session-dir` for
  a single `.jsonl`; would break if pi ever writes extra files there.
