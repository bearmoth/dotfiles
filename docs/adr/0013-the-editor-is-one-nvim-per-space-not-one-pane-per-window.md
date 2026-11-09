# The editor is one nvim per space, not one pane per window

herdr-app desktop is becoming the outer dev shell: one space per task, holding
the editor, claude/pi agents and scripts as tabs and splits (wayfinder map
#65). The editor has to live in that shell somehow. Two shapes were on the
table:

- **(A)** one persistent headless nvim per space, shown whole in a single
  pane, with nvim's own splits and buffers;
- **(B)** each nvim *window* drawn as its own herdr pane, via `ext_multigrid`
  and a bridge, so editor windows and terminals tile together as equals.

Decided 2026-11-08, after a spike: **B-lite.** Build (A). Park (B) behind
explicit revisit criteria rather than rejecting it.

## The principle

- **Editor-wide UI needs a single editor surface.** nvim places a lot of
  things relative to the *whole editor*, not to a window: the noice `:`
  cmdline, fzf-lua's floating-terminal picker, `K` hover, which-key, and
  messages. Under (A) that surface is the pane, and everything works as it
  does in Ghostty. Under (B) no single surface exists, so each of those needs
  a designed home. That is a GUI project, not a bug fix.
- **Feasible is not the same as worth it.** The spike passed every
  transport-level test for (B):
  - bytes go through a bridge process;
  - keys reach a focused pane;
  - p50 key→frame is 5–9 ms;
  - two panes can show two windows from one nvim.

  Nothing hit a hard wall. The cost is entirely in the editor-wide UI, plus
  column-accurate text, cursor shapes, mouse and IME. All of that (A) gets
  for free.
- **Keep the door open, cheaply.** (A)'s per-space headless nvim is also
  what (B) would sit on. Choosing (A) first throws nothing away. (B) stays
  parked with its bug list until a revisit criterion is met.

## Considered options

- **(B) now.** Rejected for now: it needs a small nvim GUI inside herdr. The
  spike found these breakages:
  - the cmdline text isn't drawn;
  - the picker is sized for the editor, not the pane;
  - hover is invisible;
  - which-key borders are jagged and overflow;
  - popups are positioned differently in each pane;
  - wide glyphs misalign, because text is drawn as one div per highlight run.

  Each of those is design work before any polish.
- **(A) only, ruling (B) out.** Rejected: the spike showed real promise, and
  upstream herdr-app or nvim UI changes could make (B) cheap later.
  Revisiting is governed by an explicit ticket, so parking costs nothing.
- **No embedded editor; keep nvim in Ghostty beside herdr-app.** Rejected:
  it defeats the goal of one cohesive shell per task.

## Consequences

- Each space needs a **lifecycle owner** for its nvim: start, folder, socket,
  and shutdown when the space closes. A mod's `close()` gets only 250 ms and
  also fires when the app quits, so an external supervisor is the leading
  candidate (#71).
- How the pane *shows* nvim is a separate question, prototyped next (#74):
  - a terminal pane running `--remote-ui`;
  - plain nvim in a terminal pane;
  - a bridge-drawn mod.
- The standing constraint holds: Ghostty + herdr TUI + nvim must not degrade.

Record ticket: #66. Spike: #67 (findings to `docs/research/` via #79).
