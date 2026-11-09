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
| fzf-lua picker | right size and position, icons and preview ([shot](shots/v1-fzf.png)) | same renderer; not re-shot |
| noice `:` cmdline popup | drawn, text visible ([shot](shots/v1-noice.png)) | n/a (same) |
| which-key (`<space>`) | clean borders and icons ([shot](shots/v1-whichkey.png)) | n/a (same) |
| `K` hover (lua_ls) | full hover float ([shot](shots/v1-hover.png)) | n/a (same) |
| Insert-mode cursor | thin bar ([shot](shots/v1-insert.png)) | n/a (same) |
| `termguicolors` / `'background'` | `tgc=true` (LazyVim forces it), `bg=dark`. The 0.12.5 bug only bites if the OS/terminal theme is light: bg won't follow it | detected normally |
| OSC 52 | `g:termfeatures.osc52 = true` after attach | same |
| Close the editor pane | **server survives** (0 UIs, buffer kept); `proto.sh reopen 1` re-attaches to the **same PID** with the same buffer | **editor dies**, socket gone |
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

## Verdict (agent's recommendation)

Go with **(1)**. (2) renders identically, because it is the same TUI in the same libghostty pane,
but it loses the editor whenever the pane closes. That is the "persistent nvim per space" the
destination asks for. (3) needs a GUI rebuild for what (1) gets for free.

(1)'s costs are known and small:

- a launcher (this `pane-remote-ui.sh`);
- server-mode guards (`<C-z>`, and maybe `:q` → `:detach`);
- the 0.12.5 `'background'` gap;
- a focus/autoread trigger.

All of these are lifecycle work, not rendering.

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
