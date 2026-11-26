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

## Addendum (2026-11-25): finishing conflicts, then hunks

### Decided
- **Conflicts group.** Conflicted files leave the tree and are listed by full path in a
  **Conflicts · N** group pinned above it, with a divider. Folder boxes and Stage all only
  cover the tree, so they never touch a conflict. A file joins the tree once marked resolved.
  This is the only time a file moves between lists. We chose it over VS Code's three lists
  (Merge Changes / Staged / Changes) because those list a part-staged file twice and move
  files on every stage.
- **No automatic resolve.** "Resolved" means staged, and staging takes the whole file, so it
  always takes a click. When a file has no markers left its red `!` box becomes an empty box
  (nothing is staged yet, so no tick) with a green **ready** tag after its name; ticking it
  marks the file resolved.
- **The viewer header's stage control** is one click target: the box plus a word for it,
  *Staged*, *Part staged*, *Not staged*, *Conflicted*, or, for a ready conflict, *Mark
  resolved* with a green outline. The old "changes" label is gone.
- **Nothing staged is hidden.** Once a conflicted file has no markers left, the viewer shows a
  single green **Resolved · will be staged (compared with last commit)** section in place of
  the Conflicted one, hunks labelled "line N" like the conflict view (`git diff HEAD --
  <path>`): exactly what Mark resolved stages, including the merge's clean changes outside the
  blocks. It's hidden while markers remain, when it would only repeat the blocks with the
  markers as numbered added lines.
- **Line numbers** are the line's position in the version a section ends at: Conflicted and
  Resolved both use the working file, so they agree; Staged uses the staged version, so
  it can differ from Not staged. Marker lines in the conflict view take a line but show no
  number. Deleted lines show their old-version number (one gutter column, not GitHub's two).
- **Resolved to the same as the last commit.** Such a file drops out of `git status` (VS Code
  does the same). Whichever way it was resolved (sidebar, viewer, terminal), the sidebar
  notices a conflicted file leaving status and shows a muted note: "<path>: resolved · same as the last commit,
  so nothing to stage".
- **Merge commits.** While merging (`MERGE_HEAD` exists) Commit is allowed with nothing staged,
  since a merge commit is valid even when the result matches HEAD. The button reads "Commit
  merge".
- **Hunk buttons (built).** On each `@@` row: Staged hunks get **Unstage**; Not staged hunks get
  **Stage** and **Discard**. Discard is two clicks: it turns into **Really discard?** for a few
  seconds (option A, over one-click-with-Undo and no Discard). Untracked files stage whole only.
  No splitting hunks or picking lines yet. Conflicted files keep their conflict buttons only.
  The hunk's patch (file header plus that one hunk) goes to `git apply [--cached] [-R]`
  through `sh -c 'printf %s "$1" | git apply …'`, since `exec` has no stdin. git refuses a
  patch that no longer applies, and the viewer then reloads with the error. Checked against
  real git with two hunks: each button moves only its own hunk.
  **Limit:** the patch is one process argument. Linux caps a single argument at about 128 KB,
  so a huge hunk fails there (shown as an error, nothing lost). macOS allows far more.

## Addendum (2026-11-26): diff signs and colours

### Decided
- **`-`/`+` signs.** A one-character column between the line number and the code. It's a
  margin decoration (VS Code style), not part of the text. Red `-` on removed lines, green `+` on added
  lines (Resolved sections included). It's blank on context lines, `@@` rows, section headers and every
  conflict row, because a conflict side hasn't been added or removed yet and its side bar
  already says which side it is. The diff's min width counts the sign column.
- **Stronger colours.** Phil compared the options side by side, rendered in his theme. A
  table of alpha values didn't let him judge.
  - Added and removed rows: `48` (was `18`).
  - Conflict content rows: `4c` (was `1c`).
  - Conflict marker rows (`<<<<<<<`, `=======`, `>>>>>>>`): `b3` (was `30`). They act as
    strong headers around each block.
- **Contrast rule.** Text on a strongly tinted row must not share the tint's hue. Phil's
  `ansi4`/`ansi5` are pastel, so blue text on a blue tint, and the dim grey line numbers, both
  disappeared as the tint grew. On marker rows the text, line numbers and the current/incoming
  tag are near-white (`t.foreground`, the number at `b3` and the tag at `cc` alpha). Current and
  incoming content rows get near-white line numbers too. The `|||||||` original marker and its
  lines stay dim on purpose, so the original recedes.
