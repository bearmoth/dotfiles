# A per-machine supervisor owns per-space nvim shutdown

ADR-0013 made the editor one persistent headless nvim per herdr-app space,
shown in a terminal pane with `nvim --remote-ui` (prototype #74). That nvim
outlives its pane, so something has to stop it when its space closes.
Stopping it is a hard requirement: a leaked server holds LSPs, memory and a
socket indefinitely.

Decided 2026-11-10 (#75): **one supervisor per machine, watching herdr-core's
`herdr-app` document.** It stops a space's server **without writing any
files**, and it is built as a **fresh Rust crate**.

## The principle

- **Only the core's document can tell "space closed" from "app quit".**
  herdr-app has no space hooks (#71). The structural truth is the core's
  `herdr-app` document, announced by `doc` events on `hc events`. A closed
  space disappears from that document. An app quit leaves the document as it
  is. Any owner inside the app sees both cases the same way.
- **Reconcile, don't just react.** Events can be missed: the supervisor may be
  down, the laptop asleep, or the process may crash. So the supervisor also
  reconciles on startup: it diffs the live space ids against the sockets
  present and stops orphans. A missed event becomes a delay, not a leak.
  herdr-nvim's `app-watch` uses the same pattern (#86).
- **Closing a space is not a decision about unsaved work.** The supervisor
  neither saves nor discards. It stops nvim with SIGHUP, which leaves nvim's
  swap files in place. Those live in the user's normal state dir, so any later
  nvim offers recovery (`nvim -r`). If buffers were modified, a notification
  names them.

## Shape

- **Start:** lazily, from the editor pane's command (`herdr-editor pane`).
  - It probes the space's socket. If no server answers, it spawns a detached
    headless server (setsid), waits for the socket, then runs
    `exec nvim --remote-ui`.
  - That single path covers first open, reopening after `:q`, app restarts
    and crashes.
  - It also ensures the supervisor is running, idempotently.
- **Folder:** `git rev-parse --show-toplevel` of the space folder, falling
  back to the folder itself, canonicalised with realpath. In a linked
  worktree this is the worktree's root.
- **Socket:** derived, not registered: `<dir>/<space-id>.sock`. `<dir>` is
  `$XDG_RUNTIME_DIR/herdr-editor` on Linux and `~/.local/state/herdr-editor`
  on macOS, mode 0700. `herdr-editor sock` resolves it for any caller and
  defaults to the caller's own space (`HC_TERMINAL_ID` → `herdr.space`
  label).
- **Supervisor:** `herdr-editor watch`.
  - It runs as a named herdr-core terminal. It carries **no** `herdr.space` or
    `herdr.tab` label, because those make herdr-app adopt a terminal into a
    pane. The same rule applies to the headless servers.
  - On each `doc` event it fetches the document and diffs space ids against
    sockets. For each space that has gone:
    1. it lists the space's modified buffers;
    2. it notifies and logs if there are any;
    3. it sends SIGHUP, then SIGKILL after about 3 s;
    4. it removes the socket.

## Considered options

- **A mod's `close()`.** Rejected:
  - it gets at most 250 ms;
  - it isn't called after a crash;
  - it fires the same way on app quit, so it would kill every editor on each
    app restart or update.
- **nvim exits when no UI clients remain.** Rejected:
  - a parked pane keeps its client attached, so the count never reaches zero
    while the space lives;
  - closing a pane must *not* stop the server.
- **Save on close (`wall | qa!`), or SIGHUP with `autowriteall`.** Rejected:
  it assumes intent. Discarding (`qa!`) is rejected for the same reason.
  Refusing to stop while buffers are modified is rejected because it leaks
  servers.
- **Fork ChmaraX/herdr-nvim.** Rejected:
  - it keys by tab, not space;
  - about 20k lines carry a layout-patching curl installer that conflicts with
    chezmoi's ownership of `~/.config/herdr-app`.

  Its ideas (reconcile on doc events, startup GC, park/keep) are adopted, and
  its MIT modules may be lifted with attribution.
- **TypeScript on node.** Rejected on measured cost, not on language: about
  135 ms of startup per call (twice nvim's own headless start of about 60 ms)
  and about 39 MB resident for the supervisor. The code is agent-maintained,
  so the language follows performance. Rust starts in a few milliseconds and
  stays a few MB resident.

## Consequences

- The production server uses the default nvim state dir, unlike the
  prototype, which set `XDG_STATE_HOME` per server. Swap files, shada and undo
  are therefore shared with Ghostty's nvim. The 1–2 s `checktime` timer (#89)
  runs only in servers that `herdr-editor pane` starts.
- `:q` quits the server. The next pane open restarts it.
- The socket path layout becomes a contract for mods and agents. `herdr-editor
  sock` is where it lives.
- There is no Rust toolchain on the Mac yet. How the binary reaches each
  machine is decided separately.
- Per space rather than per tab assumes that multi-repo work is sibling
  worktree spaces, one per repo (#76).

Record ticket: #75. Inputs: #71, #73, #74, #86, #89.
