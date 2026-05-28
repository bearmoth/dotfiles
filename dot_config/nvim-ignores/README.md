# nvim-ignores

Per-repo personal hide lists for the neo-tree sidebar. Files in this directory
are only deployed on the work machine (gated by `.isWork` in chezmoi config).

## Usage

Create a file named `<slug>.list` where `<slug>` is derived from the repo's
`origin` remote URL:

```
git remote get-url origin
# git@github.com:easygo/monorepo.git → github.com-easygo-monorepo
```

## File format

One entry per line. Lines starting with `#` are comments.

- Exact name: goes into neo-tree's `hide_by_name` (exact match against entry name)
- Lua string pattern (contains `/` or `*`): goes into neo-tree's `hide_by_pattern`
  (note: neo-tree uses Lua pattern matching, not glob — `/generated/` hides any path
  containing that substring)

```
# github.com-easygo-monorepo.list
mobile
payments-team
legacy
```

## Toggle

Press `Shift+H` in the neo-tree sidebar to reveal all hidden entries
(dotfiles, gitignored, and personal hides) at once. Press again to re-hide.
