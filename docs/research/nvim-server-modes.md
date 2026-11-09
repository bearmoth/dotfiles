# Research: nvim 0.12 server/client modes for one editor per space

Issue: [bearmoth/dotfiles#73](https://github.com/bearmoth/dotfiles/issues/73) (part of map #65,
"herdr-app desktop as my daily outer dev shell").
Tested with nvim **0.12.5** (Homebrew, macOS), LazyVim with fzf-lua and noice. Date: 2026-11-09.

## Question

Phil wants one persistent nvim (LazyVim) per herdr-app *space*. It should show in a pane, survive
the pane closing and reopening, and shut down when the space closes. The questions: which nvim
mode does that, how to name and find the socket, how to exit cleanly, what breaks under
`--remote-ui`, and what long-lived servers do to swap, shada, sessions and cwd.

## Method and evidence labels

- **[doc]**: `$VIMRUNTIME/doc/*.txt` for 0.12.5 (`starting.txt`, `remote.txt`, `gui.txt`, `tui.txt`,
  `api.txt`, `vimfn.txt`, `autocmd.txt`, `provider.txt`, `options.txt`, `news.txt`,
  `news-0.11.txt`, `vim_diff.txt`). `$VIMRUNTIME` is
  `/opt/homebrew/Cellar/neovim/0.12.5_1/share/nvim/runtime`.
- **[src]**: shipped runtime Lua in the same tree: `lua/vim/_core/defaults.lua`,
  `lua/vim/_core/editor.lua` (`vim._cs_remote`), `plugin/osc52.lua`,
  `lua/vim/ui/clipboard/osc52.lua`.
- **[local]**: verified by experiment on this Mac. Each test used throwaway sockets in
  `/tmp/nvexp/run`, `--clean -i NONE -n` unless stated, and a Python pty harness that answers DA1
  and OSC 11 queries like a real terminal. Experiment scripts: `/tmp/nvexp/scripts/e*.py`.
  Two tests ran real LazyVim with `XDG_STATE_HOME`/`XDG_CACHE_HOME` redirected to `/tmp`. Afterwards
  `~/.config/nvim` was checked and nothing in it had changed.
- **[issue]**: neovim GitHub issues/PRs (fetched with `gh`).
- **[inferred]**: reasoning from the above, not directly tested.

## 1. Which mode gives a persistent per-space server in a pane?

| Mode | What it is | Survives pane close? |
|---|---|---|
| `nvim --listen S` (plain, in pane) | Since 0.10 the TUI is a **client** that spawns a child `nvim --embed --listen S` server [doc `tui.txt` *startup-tui*]. | **No.** The pane close (SIGHUP) killed both processes and removed the socket [local e5]. `--embed` exits when its stdio channel closes, "except by `:detach`" [doc `starting.txt` *--embed*]. You *can* `:detach` by hand, so it survives a deliberate detach but not an accidental close. |
| `nvim --embed` | stdio RPC for GUIs. | Exits on channel close (already verified in the ticket). |
| `nvim --headless --listen S` | Server with no UI. Startup does not wait for a UI. | **Yes**, *if spawned outside the pane's session* (see 1a). It ran happily with 0 UIs across many client attach/detach cycles [local e1, e7]. |
| `nvim --remote-ui --server S` | The builtin TUI as a pure client of S. "Fully interactive: keyboard and mouse input are forwarded" [doc `remote.txt` *--remote-ui*]. It registers as `client.name = "nvim-tui"`, `stdout_tty = true` [local e1]. | The client dies with the pane. The server keeps running with 0 UIs and fires `UILeave` [local e1]. |
| `nvim --server S --remote{,-tab,-silent} files` / `--remote-send` / `--remote-expr` | One-shot RPC helpers. `--remote` sends `:drop <files>` [src `vim._cs_remote`]. | n/a. These are control commands. Note that `--remote` with no server **edits locally** (warning only), and `--remote-silent` does so silently [doc, src]. Don't use them as an "attach" primitive. `--remote-wait*` is not implemented (E5600) [doc]. |

**Answer:** run one `nvim --headless --listen <space-socket>` per space as the server, started
detached from any pane. Each pane runs `nvim --remote-ui --server <space-socket>`. Use
`--remote-expr`/`--remote-send` (or a msgpack client) for control: health checks, "unsaved?" checks,
shutdown. [local e1, e7, e15]

### 1a. Spawning the server from inside a pane: what survives pane close

Closing a pty sends SIGHUP to the session. nvim treats SIGHUP as a deadly signal and installs its
own handler, so `nohup` does not protect it. Results from starting the server in the pane's
shell, attaching, then SIGHUP-closing the pane [local e14, e15]:

| How the server was started | bash | fish |
|---|---|---|
| `nvim --headless --listen S &` | dead | dead |
| `nohup nvim --headless --listen S &` | dead | dead |
| `... & disown` | **alive** | **alive** |
| `perl -MPOSIX -e 'fork and exit; setsid; exec @ARGV' nvim --headless --listen S` (new session) | **alive** | **alive** |
| Launcher script run *as the pane command* (no interactive shell), `nvim ... &` then `exec nvim --remote-ui` | dead | n/a |
| Same launcher with the fork+setsid spawn | **alive**; reopening attached to the same single server | n/a |

The `setsid` must come after a `fork`. A background job is already a process-group leader, so a
plain `setsid()` call fails silently [local; first e14 run without `fork` died]. macOS has no
`setsid(1)`. On Linux `setsid -f` does the same job. Herdr or launchd spawning the server would
avoid all of this [inferred].

## 2. Socket naming and discovery

- **`v:servername` / `--listen`.** `--listen S` sets the primary address [doc]. Without it, nvim
  still creates a default socket at `stdpath("run").."/nvim.<pid>.0"` [doc `vimfn.txt`
  *serverstart()*]. On this Mac `stdpath('run')` = `$TMPDIR/nvim.phil/<random6>`, e.g.
  `/var/folders/…/T/nvim.phil/tllDwX`. The random part **differs per process** [local], so
  default sockets cannot be predicted. Don't use them for per-space naming.
- **`serverlist()`** returns only the addresses this instance started.
  `serverlist({peer = true})` also scans for other servers' default sockets [doc]. Locally it listed
  the other running nvims' default `nvim.<pid>.0` sockets but not the TCP spike server on
  `127.0.0.1:47010` [local e1]. Since the scan is of `stdpath('run')`-style default sockets
  [doc], custom `--listen` paths are presumably not found either [inferred]. Discovery of custom names is therefore up to us: a predictable path.
- **`$NVIM`**: jobs and `:terminal` started by the server get `NVIM=<v:servername>` [doc
  `lua.txt` vim.system / jobstart; local e17]. `vim.fn.system()` did **not** set it [local e17].
  `$NVIM_LISTEN_ADDRESS` is deprecated [doc `deprecated.txt`]. Don't run
  `nvim --remote-ui --server "$NVIM"` inside the same server's terminal; it creates a feedback loop
  ([#24395](https://github.com/neovim/neovim/issues/24395)).
- **Pipes vs TCP.** "localhost TCP sockets are generally less secure than named pipes, and can lead
  to vulnerabilities like remote code execution" [doc `api.txt` *rpc-connecting*]. Any local
  process can connect to a TCP port. Unix sockets get filesystem permissions. Use Unix sockets
  (`127.0.0.1:0` does give a random port [local] if TCP is ever needed). The existing spike on
  `127.0.0.1:47010` is fine as a spike but should not be the per-space design [inferred].
- **Path length.** macOS `sockaddr_un.sun_path` is **104 bytes** (SDK `sys/un.h`: `char
  sun_path[104]`). A 130-char path fails with `Failed to --listen: invalid argument` [local e8].
  `$TMPDIR` alone is about 49 chars here. A per-space name should use a short id or a hash, e.g.
  `${XDG_RUNTIME_DIR:-$TMPDIR}nvim-spaces/<space-id>.sock`. Make the directory `0700` [inferred].
- **Built-in single-instance lock.** `--listen` on a path where a **live** server is listening fails
  fast: `Failed to --listen: address already in use`, exit 1. A **stale** socket file (left by
  `kill -9`) is silently reclaimed [local e8, e9; [#30123](https://github.com/neovim/neovim/issues/30123),
  [#36581](https://github.com/neovim/neovim/issues/36581); `news-0.11.txt`: "Nvim will fail if the
  --listen … address is invalid"]. So "try to attach, else spawn" can't produce two servers for
  one space. The loser of a race gets EADDRINUSE and should just attach. `--remote-ui` to a missing
  or stale socket exits 1 at once with "Remote ui failed to start: connection refused" [local].
- **Clean exit removes the socket** (`:qa`, SIGTERM) [local e8, e10]. `kill -9` leaves it behind,
  which is harmless given the reclaim above.

## 3. Exiting cleanly when no UI remains

**Events** [doc `autocmd.txt`]: `UIEnter`/`UILeave` fire per UI with `v:event.chan`.
`nvim_list_uis()` gives the current set, including `stdout_tty`, `term_name`, `width`/`height` and
`chan` [doc; local e1]. A headless server that no UI ever attached to fires **no** `UILeave`, so it
never auto-exits on its own [local e7-B].

**Observed sequences** [local e1–e3]:

| Client action | Server events |
|---|---|
| attach | `UIEnter chan=N` (uis=1) |
| pane closed (SIGHUP to client) | `UILeave` (uis=0). Server stays up. |
| `:detach` | `UILeave`. The client process exits about 1–1.5 s later. Server stays up. |
| Ctrl‑Z (client under a job-control shell) | `VimSuspend`, then **`UILeave`** (uis=0). The client process is stopped (`T`). |
| `fg` | **`UIEnter`** (same chan), then `VimResume` |
| `:q` on the last window / `:qa` from any client | **The server quits** for every attached UI (QuitPre→VimLeave). All clients exit. |
| `:restart` | Old server exits. The new server is `nvim --embed <same v:argv minus --headless> --listen S` with a **new PID**, reparented to PID 1, and the UI is re-attached [local e12, e16; doc `gui.txt` *:restart*]. |

**Grace-timer pattern (works)** [local e7, e16], `/tmp/nvexp/scripts/autoexit.lua`:

```lua
local GRACE = 1500 -- ms
local timer, suspended = vim.uv.new_timer(), false
vim.api.nvim_create_autocmd('VimSuspend', { callback = function() suspended = true end })
vim.api.nvim_create_autocmd('VimResume',  { callback = function() suspended = false end })
vim.api.nvim_create_autocmd('UIEnter',    { callback = function() timer:stop(); suspended = false end })
vim.api.nvim_create_autocmd('UILeave', { callback = function()
  timer:stop()
  timer:start(GRACE, 0, vim.schedule_wrap(function()
    if #vim.api.nvim_list_uis() > 0 or suspended then return end
    pcall(vim.cmd, 'qall')   -- refuses (E37) if a real buffer is modified
  end))
end })
```

- Close and reopen within the grace period: the server survived. A final close followed by the
  grace period: the server exited with rc 0 [local e7-A].
- After `:restart` the replacement server inherits the `--cmd` hooks through `v:argv`, and it
  auto-exited correctly after its pane closed [local e16].
- **Races and holes:**
  - The timer callback re-checks `nvim_list_uis()`, so an attach that lands after `UILeave` but
    before the timer fires is safe. `UIEnter` also stops the timer.
  - Ctrl‑Z looks exactly like a detach (`UILeave`). Without the `suspended` guard the server would
    quit under a stopped client.
  - With the guard, two holes remain. (a) If the client has **no job-control shell** (pane command
    is nvim itself), Ctrl‑Z detaches the UI but the client cannot stop. The pane looks frozen and
    the server sees 0 UIs [local e2; first run, before the harness answered terminal queries, so
    treat as indicative]. (b) If the pane is closed while suspended, no further `UILeave` arrives
    and `suspended` stays true. The server never auto-exits [inferred].
  - So: map `<C-z>` to `<Nop>` or `:detach` in server mode. Treat auto-exit as a **convenience**,
    and make explicit teardown on space close the source of truth [inferred].
  - Teardown must target the **socket**, not a stored PID. `:restart` changes the PID and
    reparents the process [local e12].
  - Orphaned, still-busy servers are a known class of problem
    ([#39501](https://github.com/neovim/neovim/issues/39501): `--embed` orphan at 80% CPU from a
    plugin feedkeys loop).

**Unsaved buffers on shutdown** [local e7, e13]:

- `:qall` refuses with `E37: No write since last change`. The server stays up.
- **Terminal buffers report `bufmodified=1`** in `getbufinfo()` but do **not** block `:qa`. Running
  jobs are just killed. An "anything unsaved?" probe should filter `buftype == ''`:
  `nvim --server S --remote-expr 'len(filter(getbufinfo({"bufmodified":1}), "getbufvar(v:val.bufnr, \"&buftype\") == \"\""))'`.
- **SIGTERM** gives exit 1. `VimLeavePre`/`VimLeave` still fire with `v:dying=1`, the file is
  **not** written, and the **swap file is kept**, so it can be recovered on next open [local e7-C;
  doc `autocmd.txt`: VimLeavePre not triggered only if `v:dying >= 2`].
- **SIGHUP with `'autowriteall'`** set writes all modified buffers, then exits. This is new in 0.12
  [doc `news.txt`: "'autowriteall' writes all buffers upon receiving SIGHUP, SIGQUIT or SIGTSTP";
  local e7-D]. It is also used for `:q`/`:qa`, so it is a blunt instrument [doc `options.txt`].
- `--remote-expr 'execute("qa")'` makes the helper report "channel closed" with rc 2 when the server
  does quit. Use `--remote-send '<C-\><C-N>:qa<CR>'` (fire-and-forget) or an RPC notify, then poll the
  socket [local e13].
- **Safe options, ranked** [inferred]:
  1. On space close, probe for modified real buffers. If there are any, surface them (refuse, or
     attach a UI and prompt) instead of killing.
  2. Otherwise `:qa`.
  3. Hard fallback: SIGTERM. The swap file preserves the edits.
  4. Only use `:wall`/`autowriteall` if Phil explicitly wants silent saves.

## 4. `--remote-ui` vs a local TUI

| Area | Finding |
|---|---|
| **Where things run** | Everything except drawing and input runs in the server: plugins, jobs, `:terminal`, clipboard tools, env. The client is only the TUI renderer [doc `tui.txt`; inferred from architecture]. |
| **Clipboard** | Clipboard providers run **in the server**. On this Mac `provider#clipboard#Executable()` = `pbcopy` and LazyVim sets `clipboard=unnamedplus` (unless `$SSH_CONNECTION`) [local e6; LazyVim `config/options.lua:57`]. Local spaces need nothing extra. **OSC 52**: since 0.12 it goes through `nvim_ui_send()` to UIs with `stdout_tty`, i.e. the client's terminal [src `ui/clipboard/osc52.lua`; doc `api.txt`; fixes [#28792](https://github.com/neovim/neovim/issues/28792)]. Detection re-runs on **every** `UIEnter` via DA1/XTGETTCAP and resets on `UILeave` [src `plugin/osc52.lua`]. With a remote-ui attached, `g:termfeatures` became `{osc52 = true}` [local e1]. It is only *used* if no other clipboard tool is found and `'clipboard'` is empty [doc `provider.txt`]. |
| **`termguicolors` / `'background'`** | In 0.12.5 detection runs **once at server startup, only if a TTY UI is attached** [src `_core/defaults.lua` ~L790–1100]. A headless server never runs it: `--clean` server + remote-ui gave `tgc=0`, while a local TUI in the same pty gave `tgc=1` [local e1, e5]. LazyVim forces `termguicolors = true` (`options.lua:107`) and that held under remote-ui [local e6]. The remaining gap is that `'background'` won't follow the terminal or OS theme. Fixed on master by [#40175](https://github.com/neovim/neovim/pull/40175) (merged 2026-06-21, re-detects on UI attach, "last attached wins"). **Not in 0.12.5**: the shipped `defaults.lua` has no UIEnter hook for it [src]. Colors and highlights are global, so differing clients can't differ [issue #30320 discussion]. |
| **`$TERM`, terminfo, cursor shapes** | The **client's** `$TERM` picks terminfo (`term_name: "ghostty"` reported by the server when the client had `TERM=xterm-ghostty`) [local e1]. The server's own `$TERM` is whatever it was spawned with (`xterm-256color` here). It matters only to the server's children [local e1]. Cursor shape comes from `'guicursor'` via mode info sent to the UI. The client wrote DECSCUSR (`ESC[2 q`, `ESC[0 q`) [local e2 output]. |
| **`:terminal` / fzf-lua / noice** | Under LazyVim + remote-ui, `require('fzf-lua').files()` opened a floating terminal window running `fzf` (job in the server), `mode()=t`. Esc closed it cleanly [local e6]. noice's cmdline popup appeared as two `noice` float windows on `:` [local e11]. These all live in the server (`vim.ui_attach`/jobs), so the client type doesn't matter [inferred]. A `jobstart`/`:terminal` child sees `NVIM=<socket>` [local e17]. |
| **Environment** | The server's env and cwd are frozen at spawn time: `HERDR_*`, `SSH_*`, `$TERM`, `PATH`. A remote-ui client's env and cwd are ignored [local e10]. Plugins that read pane identity from env (e.g. smart-splits.nvim multiplexer detection, which is installed) will see the *spawner's* env, not the current pane's [inferred]. |
| **`:q` / `:qa`** | Quits the **server** for everyone. `:detach` detaches only this UI. `:connect {addr}` moves this UI to another server, and `:connect!` also stops the old one if no other UI remains [doc `gui.txt`; local e1, e11]. LazyVim's `<leader>qq` (quit all) will kill the space's editor [inferred]. |
| **Suspend (Ctrl‑Z)** | Under a job-control shell the client stops. The server sees `VimSuspend`+`UILeave`, then `UIEnter`+`VimResume` on `fg` [local e3]. With no job control the client cannot stop (see §3) [local e2]. |
| **Resize** | A pty resize (SIGWINCH) of the client changed the server's `&columns x &lines` to 120x40 [local e1]. With several UIs the grid is the **smallest** client: 80x20 with a 140x40 and an 80x20 attached [doc `nvim_ui_attach`; local e11]. A stale second client in a hidden space would shrink the visible one [inferred]. |
| **Focus / autoread** | `FocusGained`/`checktime` relies on the UI forwarding focus (`nvim_ui_set_focus`). Remote UIs have had gaps here ([#20082](https://github.com/neovim/neovim/issues/20082)). Not tested [issue]. |
| **Known open issues** | [#42669](https://github.com/neovim/neovim/issues/42669) event queue grows while parked at a hit-enter prompt in a UI-attached session. [#25377](https://github.com/neovim/neovim/issues/25377) redraw can happen before UIEnter. [#36448](https://github.com/neovim/neovim/issues/36448) `--headless` silently ignores `--server`. [#39501](https://github.com/neovim/neovim/issues/39501) orphan servers. [#38456](https://github.com/neovim/neovim/issues/38456) `--embed --listen` exit-on-stdio-close, fixed on master. No issues found that are specific to LazyVim or fzf-lua under remote-ui (search: `gh search issues --repo neovim/neovim "remote ui in:title"` and others). |
| **Startup in headless LazyVim** | The server started with no errors in `:messages`. At attach the buffer list was a single unnamed buffer [local e6]. Whether the snacks dashboard renders on a later attach was not checked. It hooks `VimEnter`, which fires before any UI is attached [inferred]. |

## 5. Long-lived servers: swap, shada, sessions, cwd

- **Swap files.** Swap is on by default in `stdpath('state')/swap`. If two space servers open the
  same file, the default `SwapExists` autocmd **silently picks (E)dit** with a `W325: Ignoring
  swapfile from Nvim process <pid>` notice, because the owner is a live nvim of the same user
  [src `_core/defaults.lua` *nvim.swapfile*; doc `vim_diff.txt`, `news-0.10.txt`]. Two worktrees
  rarely share paths, but shared files like dotfiles or notes can be edited in two spaces without a
  real prompt [inferred]. After SIGTERM the swap file survives, so recovery works [local e7-C].
- **ShaDa.** Each server reads shada at start and merges it at **exit**: history by timestamp,
  registers/search last-writer-wins, marks merged [doc `starting.txt` *shada-merging*]. Long-lived
  servers therefore don't share `:oldfiles`, registers or history with each other until one exits.
  To share them, call `:wshada`/`:rshada` on `FocusLost`/`FocusGained` or `UILeave`/`UIEnter`
  [inferred]. 0.12 also excludes `/tmp/` and `/private/` from oldfiles [doc `news.txt`].
- **Sessions.** LazyVim's persistence.nvim saves `:mksession` on `VimLeavePre`. The session is keyed
  by `getcwd()` plus the git branch unless main/master [src `persistence.nvim/lua/persistence/init.lua`
  L11–19, L39–55]. It has no `v:dying` guard, and `VimLeavePre` fires on SIGTERM (`dying=1`)
  [local e7-C]. So a SIGTERM teardown should still save a session [inferred; not run with
  persistence loaded]. `:restart` saves and restores a session itself unless `!` [doc `gui.txt`].
- **cwd.** The server's cwd is the directory it was spawned in. It's global to all clients
  (`:cd`/`:tcd`/`:lcd` apply server-side). The client's cwd is irrelevant [local e10]. **Gotcha:**
  `nvim --server S --remote rel.txt` sends a literal `:drop rel.txt`, so relative paths resolve
  against the **server's** cwd, not the caller's. A file opened from `b/` landed at
  `/private/tmp/nvexp/run/a/rel.txt` [local e10; src `vim._cs_remote`]. Always pass absolute paths.
  Spawn the server with cwd = the space's worktree root, which also gives persistence.nvim the
  right session key [inferred].

## Implications

### For the rendering prototype

1. Use `nvim --headless --listen <sock>` per space, plus `nvim --remote-ui --server <sock>` as the
   pane command. This is the only combination that survived pane close in testing.
2. The server must be spawned outside the pane's session. Have herdr spawn it if it can. Otherwise
   use a launcher that does fork+`setsid` (`perl -MPOSIX -e 'fork and exit; setsid; exec @ARGV'`
   on macOS, `setsid -f` on Linux). Don't rely on `&` or `nohup`, which both died.
3. Launcher shape, verified in e15:
   - probe with `--remote-expr 1`;
   - if absent, spawn detached;
   - wait for the socket;
   - `exec nvim --remote-ui`.
   EADDRINUSE on a live socket makes a double spawn harmless.
4. Before judging fidelity, set these in the server config:
   - `<C-z>` → `<Nop>` (or `:detach`);
   - optionally `q`-style quits → `:detach`, so habits don't kill the space;
   - `termguicolors` is already forced by LazyVim.
5. Things to look for in the prototype: `'background'` not tracking theme (0.12.5); an
   old, hidden client shrinking the grid (detach clients on space switch, or ensure one client per
   space); focus/autoread behaviour.
6. ext_multigrid is not needed for the TUI route. `--remote-ui` uses the builtin TUI (`ext_multigrid=false`)
   [local e1].

### For the per-space lifecycle grilling

1. **Identity is the socket path**, derived from a short space id under a `0700` runtime dir and
   kept under 104 bytes. Not a PID, because `:restart` changes it.
2. **Space close is authoritative.**
   - Probe for modified real buffers (filter `buftype==''`).
   - If clean, send `:qa`. If dirty, decide: refuse/prompt, or SIGTERM and rely on swap.
   - Then wait for the socket to disappear.
3. **Auto-exit on no-UI** (`UILeave` + grace timer + suspend guard) is an optional backstop, with
   known holes: Ctrl‑Z without job control, close-while-suspended, never-attached servers. Decide
   whether to keep it at all. With an authoritative space close it is mostly useful for crash
   recovery.
4. **Decide the semantics of `:q`/`:qa` inside a space editor.** Today they kill the server
   for all panes.
5. **Env and cwd are captured at spawn.** Spawn with cwd = worktree root and the env the plugins
   should see.
6. **Cross-space state** (shada, swap W325) needs a policy if spaces can share files or history.
