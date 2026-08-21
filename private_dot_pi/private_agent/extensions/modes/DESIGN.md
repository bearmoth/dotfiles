# Modes extension — visual grammar

The extension's UI surfaces (dispatch blocks, footer, future overlays)
share one visual grammar. New rendering follows this file.

## Icons

Prefer plain Unicode glyphs where a good one exists. Nerd Font glyphs
(PUA codepoints) need a Unicode-safe fallback, driven by `nerdFont: true`
in `~/.pi/agent/settings.json` (read via `nerdFontEnabled()` in
`fence.ts`; absent/false/invalid → fallback). Keep each icon in a small
helper next to its renderer (see `DISPATCH_ICON` in `dispatch.ts`) so
future icons follow the same pattern.

| Surface | Glyph | Codepoint | Fallback | Status |
|---|---|---|---|---|
| Dispatch block |  paper_plane | U+F1D8 | ⧈ (U+29C8) | implemented |
| AI reply |  robot | U+EE0D | ● | implemented* |
| AI thinking |  brain | U+E28C | ○ | implemented* |
| User prompt |  user_large | U+ED35 | › | implemented* |

\* Implemented as a first-line prefix via a markdown transformer in
`ui-plus.ts` (display-only; never enters model context or session files).
Hanging indent for wrapped continuation lines is blocked on an upstream
hook — transformers run pre-wrap, so extensions cannot indent them.

Rejected: arrow-decision U+F09BB for the dispatch block — it was
mislabeled during selection and rendered the wrong glyph. The earlier
⧈-as-primary choice is superseded by paper_plane U+F1D8, whose codepoint
was chosen by eye from a rendered line-up and echoed back for
confirmation (per the record-the-codepoint rule); ⧈ remains as the
non-Nerd-Font fallback.

## State glyphs

Status glyphs are plain Unicode (no Nerd Font dependency):

- `◐` / `◓` — running (500ms pulse alternation)
- `✓` — ok
- `✗` — error / timeout
- `◼` — killed

## Color

- **Cyan** (raw ANSI `\x1b[36m`; the theme's token set has no cyan) marks
  orchestration surfaces: the Orchestrate footer dot, and future
  orchestration chrome.
- **Dim** is metadata: titles, durations, usage, session paths, report
  previews.
- Theme tokens elsewhere: `accent` for dispatch headers, `success`/`error`
  for terminal states.

## Nerd Font dependency (decision)

Dotfiles-managed machines get a Nerd Font installed and set
`nerdFont: true` in settings; the fallback flag covers everything else
(SSH from unmanaged clients, minimal installs). Fail closed: no flag →
Unicode-safe glyphs, never boxes.
