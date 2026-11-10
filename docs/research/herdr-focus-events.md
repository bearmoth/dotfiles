# Research: focus events in herdr-app panes, and a reload trigger for the space's nvim

Issue: [bearmoth/dotfiles#89](https://github.com/bearmoth/dotfiles/issues/89) (part of map #65).
Tested: herdr-app **0.1.14**, herdr-core `hc` 0.1.18, nvim **0.12.5**, macOS, 2026-11-10.

## Question

Prototype #74 found that nvim's `FocusGained`/`FocusLost` never fired in a herdr-app pane on
space switch or cmd-tab. So `autoread` only happens on a manual `:checktime`. Why? What is a
safe reload trigger for the one-headless-nvim-per-space design?

## Evidence tags

- **[verified]**: observed on this machine in an experiment.
- **[doc]**: first-party local docs (`~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`,
  `update-notes-cache.md`, `herdr-app commands`) or nvim's `$VIMRUNTIME/doc`.
- **[source]**: upstream source or PR text.
- **[issue]**: a GitHub issue or PR thread.
- **[inferred]**: my reasoning, not tested.

## Short answers

1. Herdr sends `CSI I` / `CSI O` to a program that enabled mode 1004, **but only when focus moves
   between panes**. Tab switch, space switch and (by prototype #74) cmd-tab produce nothing.
   Cmd-tab itself is untested here and needs a human (see "Manual check").
2. nvim's TUI client enables 1004 in both modes and forwards focus. `FocusGained`/`FocusLost`
   fired in plain nvim and in the `--remote-ui` server on every pane-to-pane focus change.
3. No upstream issue, setting or changelog note about focus reporting to terminals. Mods can
   see window focus (`window().active`, #350), terminals get no such event that I could find.
4. Recommend a **timer `checktime` in the headless server**, gated so it only runs in the
   herdr-driven server. Keep native `FocusGained` as it is. Details in section 5.

## 1. Does herdr-app send focus-in/out to a program that enabled 1004?

Probe: a throwaway perl script (`stty raw -echo`, writes `ESC[?1004h`, logs each read with a
timestamp). Run in a throwaway space `research-focus-a`: tab 1 had two panes (A1, A2), tab 2
had one (A3), tab 3 had two nvims (section 2). Driven with `herdr-app do ...`.

| Action | Result |
|---|---|
| `pane.split` (new pane A2 takes focus) | A1 got `1b 5b 4f` (`CSI O`) [verified] |
| `pane.focus` A1 | A1 got `1b 5b 49` (`CSI I`), A2 got `CSI O`, same millisecond [verified] |
| `pane.focus` A2 | the reverse, same millisecond [verified] |
| `tab.new` then `tab.select` 1, 2, 1, 2 | no bytes to any probe, although `herdr-app status` showed the focused pane changing [verified] |
| `space.select` to `chezmoi`, back to A, to `chezmoi` | no bytes to any probe [verified] |
| cmd-tab away and back | not tested here; no focus bytes in prototype #74 [verified there, with nvim as the program] |

Reading: herdr reports focus per pane inside the app's own model. It does not report that a
tab or space became visible, and the log shows no window-level report. [inferred]

The probe also confirms 1004 is accepted, matching the earlier DECRQM probe in the
`herdr-app-config` research [doc, that file §4].

## 2. Does nvim enable 1004 and forward focus?

Setup, in two panes of one tab: plain `nvim -u NONE`, and `nvim --headless --listen SOCK` plus
`nvim --remote-ui --server SOCK` (server and client both `-u NONE` / default). Both
logged `FocusGained`/`FocusLost` from an autocmd. `XDG_*` pointed at a temp dir. Each client ran
under `script -q` to capture its output. `TERM` in the pane was `xterm-256color` [verified].

- **Plain nvim:** output has `ESC[?1004h`. `pane.focus` N1/N2/N1 gave
  `FocusLost, FocusGained, FocusLost, FocusGained` [verified].
- **`--remote-ui` client:** output has `ESC[?1004h` (and `?1004l` on exit). The *server* logged
  `FocusLost, FocusGained, FocusLost` for the same pane moves [verified]. The `?1004h` was not
  in the first buffer flush, so it shows up only after the client exits.
- So the TUI client forwards focus to the server with `nvim_ui_set_focus` (RPC only, since
  0.9.0 [doc `api.txt`]). [neovim#20082](https://github.com/neovim/neovim/issues/20082), "remote
  UI cannot trigger timestamp check like TUI", is closed as a duplicate [issue]. The earlier
  note "remote UIs have had gaps" in `nvim-server-modes` is no longer true for the builtin TUI client.
- `FocusGained` is documented to run `:checktime`-style timestamp checks when buffers changed
  (`autocmd.txt`, FileChangedShell: "FocusGained") [doc].
- Space switch: with the same two nvims, `space.select` away and back gave no new
  `FocusGained`/`FocusLost` in either [verified]. This is the whole prototype #74 finding.

**Why #74 saw nothing:** herdr only emits focus on a pane focus change. In a space whose one
nvim pane stays "focused", nothing changes when the space is hidden or shown. [inferred]
Moving between panes in the same tab does work.

## 3. Upstream: issues, changelog, settings

- `gh search issues --repo herdrdev/herdr-app` for "focus reporting", "FocusGained",
  "focus-events", "mode 1004", "CSI I", "autoread", "tmux focus", "focus in out": **no issue
  about focus reporting to terminal programs** [issue]. Hits are about focus rings, IME, and
  `pane.focus`. The repo's code search found "1004" only in `Cargo.lock` [source]; the terminal
  core is a separate library.
- `AGENTS.md` and `update-notes-cache.md` do not mention focus events or a setting for them.
  Relevant notes: 0.1.13 "Mods see when the window loses and gets focus. (#350)" and "The pane
  focus ring shows only where the keyboard really is." [doc]
- PR #350 text: mods read `window().active`, and the app polls the window state and refreshes
  mods immediately on a change [source]. This is the only app-focus signal I found, and it is for mods.
- Related open items: #616 (dim border while window inactive), #574 (acknowledge agents only with
  terminal focus). Neither adds terminal focus reporting [issue].

Gap: a feature request to send `CSI I/O` on window activation and on tab/space show does not
exist yet. I did not file one.

## 4. Options for the reload trigger

| Option | Works for | Cost | Verdict |
|---|---|---|---|
| Native `FocusGained` | pane-to-pane focus changes | free | keep, but does not cover space/tab switch or probably cmd-tab |
| Mod sees space switch and runs `nvim --server SOCK --remote-expr 'execute("checktime")'` | space switch, tab switch (via `focused()`), window focus (`window().active`) | a new mod to write and own; a mod gets a `render` ~40 ms after each switch [doc/verified in `herdr-app-lifecycle`]; `exec()` can run nvim; mod must know the socket | works, most moving parts |
| `checktime` timer in the server | everything, including edits while looking at the pane | one `stat` per loaded buffer each tick | simplest, covers all cases |
| File-watcher plugin (e.g. libuv fs_event per buffer) | edits | extra plugin or code, one watcher per buffer, still needs `checktime` | more code than the timer for no gain here |

I verified the mechanics on a headless server with a file edited from outside
(`$S` = scratch dir):

- Before `checktime`, `getline(1)` still returned the old text.
- `nvim --server SOCK --remote-expr 'execute("checktime")'` then returned the new text.
- A `vim.uv.new_timer()` at 500 ms running `silent! checktime` also picked up a further external
  edit with no client interaction [verified].
- `autoread` is on by default in nvim, so reload needs no extra option [doc `options.txt`, not re-read here; observed].

## 5. Recommendation

Use a **server-side `checktime` timer**, started only in the herdr-driven headless server.

- Start it from the launcher, not from `~/.config/nvim`. For example the launcher passes
  `--cmd 'lua ...'` or sets an env var that a small config snippet checks. Plain `nvim` in
  Ghostty has no timer and keeps native `FocusGained`. That satisfies the standing constraint
  that Ghostty + herdr TUI + nvim do not change. [inferred from the tests above]
- Interval 1-2 s. `silent! checktime` avoids errors. Modified buffers still get the usual W12
  prompt; that is existing nvim behaviour, same as a manual `:checktime`.
- Keep native focus: it already works for pane moves inside a tab, and it is what Ghostty uses.
- Do **not** build the mod unless the timer shows a problem. If the timer is too coarse or
  wasteful, the mod is the next step: it sees space switch, and can add `window().active` for
  cmd-tab. Add `exec("nvim", ["--server", sock, "--remote-expr", 'execute("checktime")'])`.
- If Phil wants real focus events, file an upstream request: send `CSI I`/`CSI O` on window
  activation and on tab/space show (there is no existing issue).

Open risk: a timer in a server with no UI attached (parked, hidden space) keeps ticking.
It is a `stat` per buffer, so I treat it as negligible, but I did not measure it. [inferred]

## Manual check for Phil (about 1 minute): does cmd-tab send focus?

1. In any herdr-app terminal pane, paste:

   ```
   perl -e 'system("stty raw -echo");$|=1;print "\e[?1004h";while(sysread(STDIN,$b,16)){print join(" ",map{sprintf"%02x",ord}split//,$b),"\r\n";last if $b eq "q"}print "\e[?1004l";system("stty sane")'
   ```

2. Cmd-tab to another app, wait a second, cmd-tab back.
3. Read the output. `1b 5b 4f` is focus-out and `1b 5b 49` is focus-in. Press `q` to quit.
   - Both lines appear: app activation does send focus, so native `FocusGained` covers cmd-tab
     (then only space/tab switch needs the timer).
   - Nothing appears: it does not. Expected, given prototype #74.
4. Optional: press ctrl-1 / ctrl-2 to switch space and back. Expected: nothing.

## Residue

Created, all removed or outside the repo:

- Space `research-focus-a` (3 tabs, 5 terminals: three probes and two nvims):
  closed. `herdr-app ls` now lists only `chezmoi` and `dotfiles-74-prototype-editor-pane` as
  open spaces; the closed one remains in herdr's own "recent" list (written by the app).
- Headless nvim server and its socket: killed. `pgrep` shows no probe, `nv.sh`, `script` or
  nvim process left.
- No mod created. No change to `~/.config/nvim`, `~/.config/herdr-app`, keys.json or settings.json.
  Terminal t1b and the `chezmoi` space were not touched.
- Active space at start and end: `chezmoi`. Space switching was done three times.
- Scratch (probe script, logs, typescripts, temp `XDG_*` dirs) is in `$CLAUDE_JOB_DIR/tmp/focus`,
  outside the repo.
- This file is the only repo change; not committed.
