# PROTOTYPE findings: how the (A) pane shows the space's nvim (dotfiles#74)

Throwaway. Branch `prototype/dotfiles-74-editor-pane`, never merged. herdr-app 0.1.14, nvim 0.12.5, the
real LazyVim config (state and cache redirected to `$TMPDIR/pep`). Run on 2026-11-10 by driving the
pane with `hc keys` and capturing it with `herdr-app shot`.

Run it: `prototypes/editor-pane/proto.sh up 1` (or `2`, `3`), `proto.sh reopen 1`, `proto.sh peek 1`,
`proto.sh down all`.

## Agent pre-checks

| Check | (1) headless server + `--remote-ui` pane | (2) plain `nvim --listen` pane |
|---|---|---|
| LazyVim starts, dashboard on attach | yes ([shot](shots/v1-dashboard.png)): snacks dashboard drawn although `VimEnter` ran headless | yes (it's ordinary nvim) |
| fzf-lua picker | right size and position, icons and preview ([shot](shots/v1-fzf.png)) | same renderer; not re-shot (inferred: it's the same builtin TUI) |
| noice `:` cmdline popup | drawn, text visible ([shot](shots/v1-noice.png)) | n/a (same) |
| which-key (`<space>`) | clean borders and icons ([shot](shots/v1-whichkey.png)) | n/a (same) |
| `K` hover (lua_ls) | full hover float ([shot](shots/v1-hover.png)) | n/a (same) |
| Insert-mode cursor | thin bar ([shot](shots/v1-insert.png)) | n/a (same) |
| `termguicolors` / `'background'` | `tgc=true` (LazyVim forces it), `bg=dark`. The 0.12.5 bug only bites if the OS/terminal theme is light: bg won't follow it | detected normally |
| OSC 52 | `g:termfeatures.osc52 = true` after attach | same |
| Hide with `terminal.park`, show with `terminal.keep` (herdr-nvim's and the cmd-w soft-close's mechanism) | survives: same PID and buffer; the client **stays attached while parked** (1 UI), so it keeps setting the grid size | **survives too**: same PID and buffer, and it redraws cleanly ([shot](shots/v2-kept.png)) |
| Close the editor pane (`pane.close`) | **server survives** (0 UIs, buffer kept); `proto.sh reopen 1` re-attaches to the **same PID** with the same buffer | **editor dies**, socket gone |
| `:q` on the last window | quits the server; the pane drops to a fish shell (see wrapper below) | quits nvim; same fish fallback |
| Focus events on space switch | **none** (`FocusGained`/`FocusLost` never fired), so an external edit was not reloaded | **none** either, so it's not a remote-ui problem |

**Pane argv wrapper.** herdr-app runs every pane command as
`fish -lic 'command $argv[2..]; exec $argv[1] -li' …`. So the editor pane is a child of an
interactive fish: Ctrl-Z would stop it under job control, and when nvim exits the pane becomes a
shell instead of closing.

**Focus.** Neither variant got focus events when switching spaces with `space.select`. The window
may not have been the OS key window, since this ran from a background session. Phil needs to check
this with the app in front. If herdr-app never reports focus on space switch, autoread needs another
trigger. Options: a `checktime` timer in the server, or the lifecycle owner sending `:checktime`.

## Variant (3): bridge-drawn mod

Not rebuilt. The 2026-11-08 spike already answers it (`~/.local/share/herdr-experiment/spike/FINDINGS.md`):

- noice text isn't drawn;
- fzf-lua is sized for the whole editor;
- which-key is jagged;
- `K` shows nothing;
- there's a focus gap.

Making it real means writing an nvim GUI inside herdr. `proto.sh up 3` restarts the spike if a
side-by-side look is wanted.

## Verdict (agent's recommendation, revised after the park/keep test)

Rendering doesn't separate (1) from (2). Both are the builtin TUI in a libghostty pane. Hide/show
doesn't separate them either, because both survive `terminal.park`/`keep`. The real trade-off:

- **(1) buys:**
  - the editor survives `pane.close`, `terminal.kill`, a crashed pane and (inferred, not tested) a
    herdr-core restart, since the setsid'd server lives outside the core;
  - more than one UI on the same editor;
  - env and cwd chosen at spawn, not taken from the pane;
  - a socket that exists before any pane does, so panels and agents can address it while it's hidden.
- **(1) costs:**
  - a lifecycle owner to stop servers when the space closes, plus orphan risk;
  - the launcher;
  - the 0.12.5 `'background'` gap.
- **(2) gives:** survival across hide/show, with herdr-core as the only owner. But any real close,
  kill or crash loses the editor, and unsaved buffers survive only through swap files.

Recommendation: **(1)**. The destination wants a *persistent* editor that panels and agents talk to,
and (2) ties its life to one terminal. Pick (2) if one owner matters more to you than surviving a
close. (3) stays out: it needs a GUI rebuild.

**Untested:**

- two clients shrinking the grid to the smaller one (a (1)-only risk if a stale or parked client
  lingers);
- the `up 3` path (not run);
- herdr-core restart;
- mouse;
- IME.

## Phil's hands-on checklist (what an agent can't judge)

Run `prototypes/editor-pane/proto.sh up 1` from this worktree, then do a few minutes of real
editing. Finish with `proto.sh down all`.

1. **Feel.** Typing latency, scrolling with held `j`/`k`, and the picker against Ghostty. Run
   `proto.sh up 2` beside it as the "plain nvim" control.
2. **Mouse.** Click to place the cursor, drag-select, scroll the wheel, resize splits, click in
   neo-tree.
3. **IME / dead keys.** Any composed input you use, e.g. option-e e → é.
4. **Focus.** Switch to another space and back with ctrl-1..9, and cmd-tab out and in. Then check
   two things:
   - Does the keyboard land in nvim without a click?
   - Does `proto.sh peek 1` now list `FocusGained`/`FocusLost`?

   Edit the open file from another pane and come back. Does it reload?
5. **cmd- keys.** Do your passed-through `cmd-` bindings still reach nvim under `--remote-ui`?
6. **Habits.**
   - `<leader>qq` and `:q` kill the space's editor, and the pane drops to fish. Is that acceptable,
     or should `:q` on the last window `:detach` instead?
   - Close the pane with cmd-w, then `proto.sh reopen 1`. Is the reattach good enough?
7. **Light theme**, if you ever use one. `'background'` stays dark under (1) in 0.12.5.
