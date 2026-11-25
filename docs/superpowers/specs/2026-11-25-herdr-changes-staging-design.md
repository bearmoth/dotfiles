# herdr-app Changes: staging with checkboxes — design

Refs bearmoth/dotfiles#65. Mods live in `~/.config/herdr-app/mods/` (tracked under
`dot_config/herdr-app/mods/`): `changes-view` (sidebar tree), `viewer` (diff pane).

## Why

The Changes sidebar is meant for a keyboard-driven review → stage → commit flow. Today it
can't stage anything, and **Commit runs `git add -A` first, so it commits everything** no
matter what is staged. That's the bug this fixes. Staging should be visible and
controllable from both the sidebar and the open diff, with no surprises about what a
commit will contain.

## Goals

- Stage and unstage per file and per folder from the sidebar (click or space).
- Stage and unstage the open file from the diff pane (click).
- Show part-staged files truthfully: what's staged and what isn't, in the diff.
- Commit only what's staged. Never commit a part-staged file whole.
- Tab between the tree and the commit message, so the whole flow works from the keyboard.

## Non-goals (for now)

- Staging individual hunks or lines (the sectioned diff is designed so this can come later:
  every hunk belongs to exactly one section).
- Restyling diff rows (hollow vs filled, as in Zed). We tried it in the spike and dropped it.
- VS Code-style "Staged" and "Changes" lists in the sidebar, where files move between lists.
- Keyboard shortcuts for staging while the diff pane is focused.

## Anti-goals

- Committing something you didn't stage, or committing silently when nothing is staged.
- A checkbox-like control that isn't clickable.

## Approaches considered

For how the diff shows a part-staged file:
- **A. Two sections in one diff (picked).** "Staged" is last commit to index (`git diff
  --cached`), and "Not staged" is index to working file (`git diff`). Each is exact and
  needs no merging logic. The cost is that nearby staged and unstaged edits appear in
  different places. Sticky headers make it clear at a glance which section you're in.
- **B. One diff from the last commit with each change labelled (Zed's way).** It reads in
  file order, but git gives no such diff. Interleaved edits merge into one block, and a
  line edited after staging loses its staged version. Rejected.

For Commit when nothing is staged: **disabled (picked)** over "Commit all" fallback, which
is too easy to trigger by mistake.

## Design

### Sidebar (changes-view)

- **Tri-state checkbox per row**, files and folders: ✓ staged, ☐ not staged, – part
  staged. A folder's state comes from every file under it.
- **Toggle rule:** ✓ unstages. ☐ or – stages *everything* under the row (whole file or
  whole folder). The same rule applies on click and on **space**, which acts on the cursor
  row.
- **Two status letters**, in the lazygit style. The first is the index side, in green, and
  the second the working-tree side, in red. Each comes straight from git's `XY` status, so
  `M ` is staged, ` M` unstaged and `MM` part staged.
  *(My call: untracked shows a red `?`, and a conflict shows a red `U` on both sides.)*
- **Commit** runs `git commit -m` only, with no `add`. The button reads "Commit N files",
  N being the files with anything staged. It's disabled when N is 0.
- **Tab / shift-tab** move the keyboard between the tree and the commit message box, both
  ways.

### Diff pane (viewer)

- **Sections:** "Staged" first, then "Not staged". A section is shown only if it has
  changes. An untracked file shows only "Not staged · new file". Line numbers restart per
  section. The spike already does this, in `mods/viewer/main.js`.
- **Sticky header:** the current section's header stays pinned at the top of the diff. It
  is plain text, green for Staged and yellow for Not staged, with no checkbox in it.
- **Checkbox in the pane's top-right header** for the whole file, with the same three states
  and toggle rule as the sidebar. Clicking it is the only way to stage from the pane.

### git commands (my calls)

- Stage a file or folder: `git add -A -- <path>`. This covers edits, deletions and new files.
- Unstage: `git restore --staged -- <path>`. In a repo with no commits:
  `git rm --cached -r -q -- <path>`.
- Writes don't pass the read-only flags (`READ`). Reads keep them.

## Constraints

- No polling. Refreshes come from folder watches and focus, as today.
- Keep the three mods separate (explorer-view, changes-view, viewer).
- Every `setShared` re-renders every mod, so use it sparingly and don't create new keys
  per file.
- Keys go in `keys.json.tmpl` (using `$cmd`), and live edits get copied back into the branch.

## Left to the builder

- **Refreshing after staging from the viewer.** Staging writes `.git/index`, which the
  sidebar's folder watch should pick up. Verify this first. If it doesn't, the viewer
  needs a cheap way to nudge the sidebar (one shared timestamp key), and the sidebar the
  viewer, since the viewer re-reads its diff on its own watch.
- **The sticky header lags when dragging the scrollbar.** It only redraws on wheel or
  keyboard input today. Fix it without polling, or accept the lag if there's no event to
  hook.
- **Tab in the message box.** Find out whether the Input consumes Tab. If it does, route
  Tab through a `mod:changes-view` key binding.
- **Errors.** Show a failed stage or commit as the existing one-line note in the sidebar.
