# herdr-app Changes staging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage and unstage from the Changes sidebar and the diff pane using tri-state checkboxes, and commit only staged changes.

**Architecture:** The git staging logic lives in a pure ES module, `staging.js`, with no herdr
imports, so it's unit-testable with `node --test`. It's kept byte-identical in
`mods/changes-view` and `mods/viewer`, the same way as `open.js`, because mods can't import
across folders. The viewer's diff parsing, sections included, moves into a pure `diff.js`.
UI code calls these modules and runs git through `exec`. Refreshes come from the existing
folder watches: on macOS `watchFolder` is recursive and includes `.git`, so a staging write
triggers them.

**Tech Stack:** herdr-app JS mods (gpui-kit, gpui-base, herdr), git CLI, and `node --test` for the pure modules.

**Spec:** `docs/superpowers/specs/2026-11-25-herdr-changes-staging-design.md`

## Global Constraints

- No polling. Refreshes come only from the folder watch, focus, and the stock 10s timer.
- Three mods stay separate. Shared code is duplicated byte-identically: `open.js` and `staging.js`.
- Reads keep the `READ` flags. Writes (`add`, `restore`, `rm --cached`, `commit`) don't use them.
- Live mods are at `~/.config/herdr-app/mods/`. After each task, copy the changed files to
  `dot_config/herdr-app/mods/` in the worktree, check `chezmoi --source=<worktree> diff
  ~/.config/herdr-app` is empty, and commit.
- Each task's check is: `node --test mods/changes-view mods/viewer`, then `herdr-app check
  mods/<mod>`, then `herdr-app status`, which must show `errors: []`. Then try it by hand
  against `/tmp/staging-demo`.

## Review Focus

- A part-staged file (`MM`): Commit must commit only the staged part. Task 1 tests that
  `stageState("MM")` returns `"partial"`, and that no commit path runs `add`.
- A repo with no commits: unstaging must use `git rm --cached`, because `restore --staged`
  fails without a HEAD. Tested in Task 1 through `stageArgs(..., hasHead=false)`.
- Staging a deleted file (` D`) or an untracked file (`??`): `git add -A -- path` covers
  both. Tested in Task 1.
- Paths with spaces or a leading `-`: always pass `--` before paths. Tested in Task 1.
- A click while a refresh is loading: the result must not be lost. After a write, Task 2
  sets `this.again`, and the load's `finally` runs `refresh` again.

---

### Task 1: Pure staging module

**Files:**
- Create: `mods/changes-view/staging.js`, and an identical copy at `mods/viewer/staging.js`
- Test: `mods/changes-view/staging.test.js`

**Interfaces — Produces:**
- `stageState(xy: string): "staged" | "unstaged" | "partial"`. `xy` is git porcelain's
  two status characters. An index side of `' '` or `'?'` means unstaged. A working-tree side
  of `' '` means staged. Anything else is partial. Conflicts (`U`, `AA`, `DD`) count as
  unstaged.
- `combine(states: string[]): "staged" | "unstaged" | "partial"`. Every entry the same gives
  that state. A mix gives `"partial"`. An empty list gives `"unstaged"`.
- `wantStage(state): boolean`, true unless the state is `"staged"`.
- `stageArgs(paths: string[], stage: boolean, hasHead: boolean): string[]`, the git argument list:
  - stage: `["add", "-A", "--", ...paths]`
  - unstage with a HEAD: `["restore", "--staged", "--", ...paths]`
  - unstage without one: `["rm", "--cached", "-r", "-q", "--", ...paths]`
- `stagedCount(files: {xy: string}[]): number`, the number of files whose index side isn't
  `' '` or `'?'`.

- [ ] **Step 1: Write the failing tests** (`node:test`, `node:assert/strict`):
  - `stageState`: `"M "` → staged, `" M"` → unstaged, `"MM"` → partial, `"??"` → unstaged,
    `"A "` → staged, `"AM"` → partial, `" D"` → unstaged, `"D "` → staged, `"UU"` → unstaged.
  - `combine`: `["staged","staged"]` → staged, `["staged","unstaged"]` → partial, `["partial"]`
    → partial, `[]` → unstaged.
  - `wantStage`: staged → false, partial → true, unstaged → true.
  - `stageArgs(["a b","-x"], true, true)` deep-equals `["add","-A","--","a b","-x"]`.
    `stageArgs(["d"], false, true)` deep-equals `["restore","--staged","--","d"]`.
    `stageArgs(["d"], false, false)` deep-equals `["rm","--cached","-r","-q","--","d"]`.
  - `stagedCount([{xy:"M "},{xy:"MM"},{xy:" M"},{xy:"??"}])` → 2.
  - The two copies are identical: `readFileSync` of `./staging.js` equals `../viewer/staging.js`.
- [ ] **Step 2:** Run `node --test mods/changes-view`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Implement `staging.js`, then copy it to `mods/viewer/`.
- [ ] **Step 4:** Run `node --test mods/changes-view`. Expected: all tests pass.
- [ ] **Step 5:** Sync and commit: `feat(herdr-app): pure staging helpers`.

### Task 2: Sidebar: commit staged only, checkboxes, space, Stage all, Tab

**Files:** Modify `mods/changes-view/main.js` (`refresh`, `rows`, `key`, `commit`, `render`).
Create `mods/changes-view/check-{on,off,part}.svg` (12px, `currentColor`).

**Interfaces — Consumes:** everything Task 1 produces.
**Produces:** each entry in `this.files` gains `xy` and `stage` (from `stageState`).
New methods:
- `stage(paths: string[], stage: boolean, cx)` runs one write.
- `toggleRow(row: {path, dir}, cx)` applies the toggle rule from the spec.
- `stageAll(cx)`.

- [ ] **Step 1: Commit.** Remove `["add","-A"]` from `commit()` so it runs only
  `git commit -m <message>`. Enable it only when `stagedCount(this.files) > 0` and there's a
  message. The label is `Commit N file(s)`, or `Commit` when N is 0. Check it by hand: in the
  demo, commit with `src/app.js` part staged, then confirm `git -C /tmp/staging-demo diff` still
  shows the unstaged part. Restore the demo afterwards with `git reset --soft HEAD~1`.
- [ ] **Step 2: Data.** In `refresh`, store `xy` and `stage: stageState(xy)` on each file. Add
  `dirState(node)`, which runs `combine` over every file under a tree node, using memoised node
  states rebuilt on each `tree()` call.
- [ ] **Step 3: Checkbox.** Draw it in every row, folder or file, at the left, before the
  chevron or spacer. It's an `svg(check-on|off|part)` sized 14. A click runs `toggleRow` with
  `cx.stop_propagation()`, so it doesn't open the row.
- [ ] **Step 4: Writes.** `stage` runs `exec("git", stageArgs(...), {cwd: root, on})`. A
  failure goes in `this.note`. Afterwards it calls `this.refresh(cx)`. If a load is already
  running, it sets `this.again = true`, and the load's `finally` re-runs `refresh`. For a folder
  row, `toggleRow` passes the folder path; for a file row, the file path. The direction comes
  from `wantStage` of that row's state.
- [ ] **Step 5: Keys.** `space` runs `toggleRow` on the cursor row. `tab` and `shift-tab` from
  the tree call `this.input.focus()`. In the input, Tab returns to the tree with
  `this.handle.focus()`. If the Input swallows Tab before `on_key_down` sees it, add
  `"{{ $cmd }}…"`-free bindings, `"tab"` and `"shift-tab"` → `changes-view.cycle-focus`, under
  `mod:changes-view` in `keys.json.tmpl` and the live `keys.json`. Handle `cycle-focus` in the
  `nextCommand` loop.
- [ ] **Step 6: Stage all.** Add a header button, "Stage all", to the right of the file
  count. It reads "Unstage all" when `combine` of all files is `"staged"`, and is hidden
  when there are no files. It calls `stage(["."], ...)`.
- [ ] **Step 7:** Run the checks from Global Constraints. By hand in the demo: click the
  `src/ui` checkbox while it's part staged, and it becomes ✓. Press space on `src/ui` and it
  becomes ☐. Press space on `README.md`. Stage all, then Unstage all. Tab moves into the
  message box and back.
- [ ] **Step 8:** Sync and commit: `feat(herdr-app): stage from the Changes tree; commit staged only`.

### Task 3: Viewer: pure diff module, sticky header, file checkbox

**Files:**
- Create: `mods/viewer/diff.js` (moved out of main.js: `SECTION`, `diffRows`, `untab`,
  `countLines`, plus a new `sectionAt`)
- Test: `mods/viewer/diff.test.js`
- Modify: `mods/viewer/main.js`

**Interfaces — Produces:**
- `diffRows(lines: string[]): Row[]`. A Row is `{kind: "#"|"@"|"+"|"-"|" "|"", text, number?, staged?}`.
- `sectionAt(rows: Row[], index: number): Row | null`, the nearest `"#"` row at or above `index`.

- [ ] **Step 1: Write the failing tests:**
  - `diffRows([SECTION+"Staged","@@ -3,2 +3,2 @@","-a","+b"," c"])` gives kinds
    `["#","@","-","+"," "]`, with numbers `[_, _, 3, 3, 4]` and `staged` true on every row.
  - A second section resets the numbering, and its rows have `staged` false.
  - `sectionAt(rows, 0)` is the header. `sectionAt(rows, last)` is the second header.
    `sectionAt([], 0)` is null.
- [ ] **Step 2:** Run `node --test mods/viewer`. Expected: FAIL, because the module is missing.
- [ ] **Step 3:** Move the functions into `diff.js` and import them in `main.js`. Replace
  `stickyHeader` with `sectionAt(this.rows, topRow)`. Remove the spike comments.
- [ ] **Step 4:** Run `node --test mods/viewer`. Expected: all tests pass.
- [ ] **Step 5: Scrollbar-drag lag.** Also redraw on `on_mouse_move` while the left button is
  pressed (`e.pressed_button === "left"`, or whatever field gpui-kit's MouseMoveEvent has)
  over the diff. That's an event, not polling. If there's no such field, accept the lag and
  note it in the spec.
- [ ] **Step 6: Checkbox.** When `diffLines` runs, store `this.stage = stageState(xy)`.
  Draw the checkbox in the header's right corner, using the same three svgs, copied into
  `mods/viewer/`, at size 14. A click runs `exec("git", stageArgs([it.rel], wantStage(this.stage),
  hasHead), {cwd: it.root, on: it.on})`. The viewer's own repo watch then reloads it, and the
  sidebar's watch refreshes the sidebar.
- [ ] **Step 7:** Run the checks. By hand: open `src/app.js`. The checkbox shows –. Click it
  and it becomes ✓, the diff becomes Staged only, and the sidebar row also shows ✓. Click
  again and it becomes ☐, with Not staged only.
- [ ] **Step 8:** Sync and commit: `feat(herdr-app): staged/unstaged diff sections and file checkbox in viewer`.

### Task 4: Wrap-up

- [ ] Update the spec's "Left to the builder" with what was found: whether the watch fires on
  index writes, whether Tab needed a binding, and whether the scrollbar lag was fixed.
- [ ] Run `chezmoi --source=<worktree> diff ~/.config/herdr-app`, and check it's empty.
- [ ] Dispatch one fresh reviewer over the branch diff from `5b7ff03..HEAD`, then fix
  anything that must be fixed before telling the user it's done.
