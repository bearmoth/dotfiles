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
- **One status letter for the change type**, as today: `M`, `A`, `D`, untracked `?`, and a
  red `U` for a conflict. Whether it's staged is the checkbox's job. We considered two
  letters in the lazygit style and leaned against them, since they mostly repeat the
  checkbox. Revisit once it's on screen.
- **Stage all** button in the sidebar header. It stages every change. It reads "Unstage
  all" when everything is already staged.
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

## Found while building (2026-11-25)

- **Refresh after a write:** confirmed. On macOS `watchFolder` is recursive and includes
  `.git`, so a `git add` from anywhere, the viewer included, refreshes Changes. Checked by
  staging from the CLI while the panel was showing the demo repo. No shared nudge key needed.
- **Tab in the message box:** handled in the panel's `on_key_down`. Tab in the tree focuses
  the input, and Tab in the input focuses the tree. Not yet confirmed by hand that the Input
  passes Tab up. If it doesn't, add `tab` → `changes-view.cycle-focus` under
  `mod:changes-view`.
- **Pinned header while dragging the scrollbar:** repainted from `on_mouse_move` while the
  left button is held, which is an event, not polling. Not yet confirmed by hand.

## Addendum (2026-11-25): conflicts and long diffs

### Why
A conflicted file (`UU`, `AA`, `DD` and the other unmerged states) used to draw git's combined
diff wrongly. Worse, Stage all, or ticking its folder, staged it, which marks it resolved in
git even with conflict markers still in it. Separately, a 1,500-line cap copied from the stock
Changes mod could silently hide the whole Not staged section.

### Design
- **A fourth state, `conflict`.** A conflicted file shows a red `!` box instead of a checkbox,
  and keeps the red `U`.
- **Marking a file resolved.** Clicking the `!` box or pressing space on the file (or using
  the viewer header's box) re-reads the file. If it still has conflict markers (a line
  starting with `<<<<<<<`, `|||||||`, `=======` or `>>>>>>>` followed by a space or the line
  end), nothing is staged and a note says "Still has conflict markers". Otherwise the file is
  staged, which marks it resolved.
- **Folders and Stage all never stage a conflicted file.** Conflicted files are excluded from
  the write. A folder's state comes from its non-conflicted files, and a folder holding only
  conflicts shows `!` and does nothing. With conflicts present, the button reads
  "Stage all (N conflicts skipped)". Unstage writes exclude conflicted files too, so they stay
  unmerged.
- **Conflict view in the diff pane.** A single **Conflicted** section shows the working file's
  conflict blocks, with 3 lines of context and `@@` separators between blocks:
  - your side (between `<<<<<<<` and `=======`, or `|||||||`) in blue
  - their side (between `=======` and `>>>>>>>`) in magenta
  - the base (between `|||||||` and `=======`) dimmed
  - marker lines in a plain muted style
  With no markers left, the section reads "No conflict markers left · tick the box to mark
  resolved".
- **Paths.** Each path is written as `:(literal)<path>`. A bulk write (a folder, or Stage
  all) names the folder itself, or `.` for the whole repo, unless a conflicted file is under
  it. In that case it names every other listed file under it instead. Exclusions were tried
  first and don't work: on git 2.56, `git add -A -- . ':(exclude)f'` still stages an unmerged
  `f`. This was checked against a real merge conflict.
- **Long diffs.** Each section is capped separately at 20,000 lines and ends with a visible
  "… N more lines" row. The per-line cap (4,000 characters) stays. The overall 1,500-line cap
  is removed.

### Resolving conflicts (decided 2026-11-25: option C)
- **The conflict view shows the real marker lines**, coloured by side: `<<<<<<< HEAD` blue,
  `|||||||` grey, `=======` the split, `>>>>>>> feature` magenta. Each side's lines have a
  matching bar down the left. Marker lines carry no line number, and a small dim tag after
  the marker says *current*, *original* or *incoming*.
- **Original lines are shown (diff3).** git is set to `merge.conflictStyle = zdiff3` in the
  managed git config, so every conflict block includes the lines as they were before either
  side changed them. They're drawn grey and italic with a faint grey tint, for reference.
  Files conflicted before the setting can be redrawn with
  `git checkout --conflict=zdiff3 -- <path>`.
- **VS Code's wording, the same in every file.** Marker names vary (`HEAD`, a branch,
  `ours`), so buttons don't use them. "Current" is the branch you're on, "incoming" the one
  coming in.
- **Per-block buttons** on each `<<<<<<<` row: *Keep current · Take incoming · Keep both*.
  "Both" is current then incoming, with the original dropped. They rewrite that block through
  `writeTextFile(path, next, shownText)`, which refuses if the file changed since it was
  shown. Then the pane says "File changed since it was shown · reloaded" and reloads. Local
  folders only, since `writeTextFile` can't reach other machines.
- **Whole-file buttons** in the header: *Keep all current* and *Take all incoming*, which run
  `git checkout --ours/--theirs -- <path>`. These also work on remote machines.
- **No button marks the file resolved** by itself. Ticking the box does that, once the
  markers are gone. No keyboard shortcuts in the viewer.
- **Edits from elsewhere** (vim, say): the repo watch reloads the view on save. Resolved
  blocks disappear, and with none left the view reads "No conflict markers left · tick the
  box to mark resolved".
- **CRLF files:** markers are still recognised, and line endings are kept when a block is
  rewritten.
- **Open:** whether to add a "Compared with HEAD" section, so a conflicted file's other
  changes (clean merges, your own edits away from the blocks) are visible too.
