# Research: Obsidian multi-vault + concurrency constraints

Wayfinder research ticket: [bearmoth/dotfiles#7](https://github.com/bearmoth/dotfiles/issues/7) (child of map #3).

Question: what are the real constraints on AI agents writing to Obsidian vaults
externally, and is "a vault inside a git worktree is hazardous" true?

## TL;DR

- Obsidian vaults are just folders of Markdown; the app is built to tolerate
  external writes to note content. The danger isn't "external writes" in
  general, it's a handful of specific things: touching a note that's open with
  unsaved edits, touching `.obsidian/*` config, and doing a *bulk* filesystem
  swap (git checkout/pull/rebase) on the directory the app currently has open.
- The "no worktrees for vaults" hypothesis is **correct as a conclusion, but
  the mechanism Phil named ("index/conflict issues with a running app") is
  the wrong reason.** The real reason is **vault identity fragmentation**:
  Obsidian registers vaults by absolute path, so a worktree — a second path
  pointing at the same git history — is a second, disconnected vault (no
  shared graph/backlinks/search), not a safer or riskier copy of the same
  vault. See verdict below.
- Obsidian ships an official CLI (built into the app since v1.12, GA since
  v1.12.4) that addresses vaults by name/id and requires the app to be
  running. It is not enabled on this machine yet.
- All three existing vaults on this machine are plain git repos (not
  worktrees) with `.obsidian` present and tracked; none are under active
  iCloud "Desktop & Documents" sync (checked locally — see below).

## 1. How Obsidian's cache/index reacts to external file changes while running

Source: [How Obsidian stores data](https://obsidian.md/help/data-storage), [Vault File Refresh plugin](https://community.obsidian.md/plugins/vault-file-refresh), forum threads on stale reload.

- A vault is "a folder on your local file system, including any subfolders."
  Notes are plain Markdown; Obsidian expects external tools (git, editors,
  agents) to touch them and "automatically refreshes your vault to keep up
  with any external changes."
- Detection is via filesystem watchers (chokidar). This is reliable on a
  normal local APFS/macOS filesystem — the case for all three vaults here.
  It becomes unreliable on Flatpak/XDG-portal Linux installs, network/FUSE
  mounts, or when Linux inotify watch limits are exhausted. Not a concern on
  this Mac setup, but worth remembering if a vault ever moves to a network
  drive.
- Obsidian keeps a **metadata cache** (backlinks, tags, links, frontmatter
  index) separate from the files themselves, "though synchronization issues
  can occur." Settings → Files and Links → "Rebuild cache" is the escape
  hatch if it drifts. This is not vault corruption, just a stale-index
  annoyance, self-healing on next full parse.
- The genuinely lossy case, confirmed on the forum ("Obsidian doesn't reload
  the current file when it is changed outside of Obsidian", "'Reloading App
  without saving' should just save the files first"): if a note is **open in
  a leaf with unsaved edits** and an external process rewrites that same
  file, Obsidian does not always reload it live, and a later autosave/close
  can overwrite the external change — or the reverse, external write wins and
  the user's in-progress edit is silently lost. This is a real race, but it
  only applies to the *specific file currently open with dirty state* — not
  to the vault generally.
- Explicit documented warnings (not races, just rules): never nest a vault
  inside another vault (internal links are vault-scoped and won't resolve
  correctly across the boundary); never put a vault in an OS settings/profile
  folder.

**Safe vs corrupting, concretely:**
| Operation | Verdict |
|---|---|
| Agent creates/edits a `.md` note not currently open in the app | Safe — this is the normal use case Obsidian is designed for |
| Agent edits a `.md` note that IS open with unsaved changes in the live app | Hazardous — last-writer-wins race, possible silent data loss either direction |
| Agent writes/deletes many files at once (bulk import, `git checkout`, `git pull` with many changed files) while the app has that exact directory open | Hazardous — floods the watcher/cache with simultaneous events; higher chance of a stale or partial index and of clobbering an open, unsaved file caught in the sweep |
| Agent touches `.obsidian/workspace.json`, `workspace-mobile.json`, or plugin data files | Hazardous — these are the app's own live state, rewritten constantly while running; an external write here is fighting the app, not cooperating with it |
| Agent reads `.obsidian/*` for inspection | Safe (read-only) |

## 2. Multiple checkouts/worktrees of a vault repo — what actually breaks

Sources: local inspection of `obsidian.json` (below), [Vinzent03/obsidian-git#110](https://github.com/Vinzent03/obsidian-git/issues/110), [obsidian forum: "Multiple vaults in one git repository"](https://forum.obsidian.md/t/multiple-vaults-in-one-git-repository/61886), [obsidian forum: multi-window feature requests](https://forum.obsidian.md/t/multiple-windows-of-the-same-vault-repost/51258).

**Vault identity = absolute filesystem path.** Read directly off this
machine's vault registry:

```
~/Library/Application Support/obsidian/obsidian.json
{
  "vaults": {
    "3b2dda897fe1b4d4": { "path": "/Users/phil/Documents/Easygo", "ts": ..., "open": true },
    "66bbfa6b5022d727": { "path": "/Users/phil/Documents/Tech Notes", "ts": ... },
    "e18c41fc9ca03bbb": { "path": "/Users/phil/Documents/Engagement PKB", "ts": ..., "open": true },
    ...
  }
}
```

Each entry is keyed by a hash derived from the literal path, with no concept
of "this is the same logical vault as that other path." The forum confirms
Obsidian also **refuses to open the same registered path twice** (opening a
vault that's already open just focuses the existing window) — but a
**worktree is a second, distinct path** on the same git history, so Obsidian
happily registers it as an unrelated third vault. A documented workaround for
wanting "two windows on one vault" is literally to symlink the folder and
register the symlink as a separate vault — i.e., the community already uses
"trick Obsidian with a second path" as the way to defeat the single-instance
guard, which is exactly what a worktree does by accident.

**Consequence: fragmentation, not corruption.** If Phil (or an agent) opened
a worktree of "Engagement PKB" as its own vault, it would NOT share:
- the graph view / backlinks / unlinked-mentions index
- search history, recent files, command palette state
- any plugin runtime state

...with the "real" vault. Two worktrees of one vault repo behave as two
unrelated PKBs that happen to share git history. That defeats the entire
point of a single, connected knowledge base — this is the sharpest, most
airtight reason to avoid worktrees for vaults, and it holds regardless of
plugins or concurrency timing.

**Plugin-level breakage (secondary, dated evidence):** the community
`obsidian-git` plugin has an open, unresolved bug
([#110](https://github.com/Vinzent03/obsidian-git/issues/110), filed 2021,
no fix/milestone recorded) where it fails against a worktree or bare-repo
layout with `fatal: this operation must be run in a work tree` or `fatal: not
a git repository`, because it assumes a conventional `.git` directory rather
than a worktree's `.git` *file* pointer. Treat this as corroborating but
dated — it's evidence the ecosystem wasn't built with worktrees in mind, not
proof the plugin is still broken in exactly this way today. None of the
three local vaults have `obsidian-git` installed (community plugins present:
`terminal` on Engagement PKB, `folder-notes` on Tech Notes and Easygo), so
this specific bug doesn't currently apply here — but it would if that plugin
were ever added.

**`.obsidian` duplication:** git worktrees only share the `.git` metadata
store; the working tree (including `.obsidian`) is separate per worktree. All
three local vaults currently have `.obsidian` **tracked in git** (it shows up
under version control, not gitignored). If it were ever put under a worktree
layout:
- Each worktree gets its own full copy of `.obsidian` at checkout — plugin
  installs, `workspace.json`, `graph.json` all diverge immediately.
- Official guidance ([data storage docs](https://obsidian.md/help/data-storage))
  is to gitignore `workspace.json`/`workspaces.json` specifically because they
  churn on every file open and aren't meaningful to version — which is itself
  a data point that "commit all of `.obsidian`" is already a slightly
  contested choice, worktrees just make the friction visible immediately.

**What the worktree hazard is *not*:** it is not that a running Obsidian
instance corrupts its live directory more easily because a worktree is
involved. The file-level race described in §1 (bulk external change, or
edit-while-open) is exactly as dangerous in a single plain clone as in a
worktree — `git checkout`/`pull`/`rebase` on the directory the app has open
is the hazard, and that hazard exists with or without worktrees. Worth
stating the inversion plainly: **a worktree the app does NOT have open is
actually a safe place for an agent to stage changes** (physically different
files on disk, zero live race with the running app) — the hazard only
resurfaces at the point you merge/pull that work back into whatever directory
Obsidian currently has registered as the vault.

## 3. obsidian-cli's model for multi-vault addressing by name

Sources: [obsidian.md/help/cli](https://obsidian.md/help/cli), the bundled skill at
`~/.claude/plugins/cache/obsidian-skills/obsidian/1.0.1/skills/obsidian-cli/SKILL.md`.

The skill installed here (`kepano/obsidian-skills`) documents Obsidian's own
**official, built-in CLI** (not the third-party `Yakitrak/notesmd-cli` npm
package) — it launched as a Catalyst early-access feature in Obsidian 1.12.0
and went GA in 1.12.4.

- **Enablement is manual and per-machine:** Settings → General → "Command
  line interface" toggle, then a registration prompt. On macOS this creates a
  symlink at `/usr/local/bin/obsidian` (needs admin once); Linux copies a
  binary to `~/.local/bin/obsidian`; Windows installs an `Obsidian.com`
  redirector. **Checked on this machine: `command -v obsidian` returns
  nothing** — the CLI is not yet enabled here. This is a concrete
  prerequisite to do before any agent can use it.
- **Requires the app running.** "If Obsidian is not running, the first
  command you run launches Obsidian." There is no headless/no-app mode for
  this CLI (Obsidian points to separate "Obsidian Headless"/"Headless Sync"
  products for that case, which weren't investigated further here as out of
  scope).
- **Vault targeting is by name or id, defaulting to context:** `vault=<name>`
  or `vault=<id>` as the first parameter targets a specific vault; omitted,
  it uses the vault matching the current working directory if applicable,
  else "the most recently focused vault." `<name>` resolves against the
  vault's folder basename (there's no separate "display name" field in
  `obsidian.json` — see the registry dump above, it's just `path`). A
  community "Vault Nickname" plugin exists for disambiguating vaults that
  share a folder basename, but none of the three local vaults collide
  (`Engagement PKB`, `Tech Notes`, `Easygo` are all distinct), so plain
  basename addressing works today without extra tooling.
- **File targeting:** `file=<name>` resolves like a wikilink (name-only,
  fuzzy); `path=<path>` is exact from vault root.
- **Command surface** (from `obsidian help`, summarized in the skill):
  search (`search`, `search:context`, `tags`, `backlinks`, `links`,
  `orphans`), CRUD (`create`, `read`, `append`, `prepend`, `move`, `rename`,
  `delete`), daily notes (`daily`, `daily:append`, `daily:read`), tasks
  (`tasks`, `task` with status filters), frontmatter/properties
  (`property:set`, `property:remove`, `property:read` with typed values:
  text/list/number/checkbox/date/datetime), plugin control
  (`plugin:reload/enable/disable`), sync/history (`sync:status`, `diff`,
  `history:restore`), and workspace (`workspace:save/load`). `move`/`rename`
  respect the vault's "update internal links" setting.
- No explicit concurrency/transaction documentation was found — the CLI
  talks to the live app process, so in practice it inherits whatever
  guarantees the app itself gives an in-process write (i.e., it's mediated
  through Obsidian, not a raw filesystem write racing the app).

## 4. Concurrency failure modes

- **Agent writes while app is open, note not open in a leaf:** safe by
  design (§1).
- **Agent writes to a note currently open with unsaved edits:** the one
  clearly-documented lossy race. Mitigate: either write via the official CLI
  (mediated through the running app, so it participates in the same
  save/reload path the user's own edits do) when the app is running, or avoid
  raw filesystem writes to whatever file is frontmost.
- **`git pull`/`checkout`/`rebase` on the live vault directory:** bulk,
  simultaneous multi-file change under a running watcher. Higher risk of
  stale metadata cache and of sweeping up an open/dirty file in the change.
  This is the operation to avoid on a directory Obsidian has open — regardless
  of whether that directory is a worktree or a plain clone.
- **Obsidian Sync alongside another cloud sync (iCloud/Dropbox/OneDrive) on
  the same folder:** documented as conflict-prone —
  ["Syncthing/iCloud alongside Obsidian Sync creates conflicts"](https://forum.obsidian.md/t/syncing-creates-endless-edit-conflict-files/104148),
  [Synchronization and Conflict Resolution](https://deepwiki.com/obsidianmd/obsidian-help/2.3-synchronization-and-conflict-resolution).
  For Markdown, Obsidian Sync merges via Google's diff-match-patch; for
  everything else (canvases, `.obsidian/*`) it's last-modified-wins, and a
  conflicting merge produces a sibling
  `name (Conflicted copy device YYYYMMDDHHMM).md` file rather than corrupting
  the original.
  **Checked locally:** none of the three vaults sit under active iCloud Drive
  "Desktop & Documents" sync — `~/Library/Mobile Documents/com~apple~CloudDocs/`
  doesn't exist on this machine, `~/Documents` is a plain local directory
  (not a symlink), and no `.icloud` placeholder files exist inside any vault.
  This is a per-machine setting, not a property of the vault content, so it's
  worth re-checking if a vault is ever opened on another Mac or if iCloud
  Drive sync is turned on for this account later — the risk is real, just not
  currently present here.
- **Two Obsidian app windows on two different worktrees of the same repo:**
  no live file race (different files on disk, per §2), but git-level
  reconciliation (merging one worktree's commits into the branch the other
  worktree is checked out on, then pulling) reintroduces the bulk-change
  hazard above at the moment of merge.
- **Secrets in vault content:** `~/Documents/Engagement PKB/.env` exists at
  the vault root (not inspected further, per read-only instruction). Agents
  should treat vault directories like any other repo: respect `.gitignore`,
  never read/echo/commit dotfiles like `.env` as note content.

## (a) Do / don't rules for agents writing to vaults

**Do:**
- Treat vault content (`.md`, `.canvas`, `.base`) as safe for direct external
  writes when the app is closed, or when the specific note isn't open with
  unsaved changes.
- Prefer the official Obsidian CLI (`obsidian ...`, once enabled) for writes
  when the app is running — it's mediated through the live process rather
  than racing its file watcher.
- Address vaults by name (folder basename) via `vault=<name>`, since the
  three current vaults have collision-free basenames.
- Respect each vault's `.gitignore`; never touch or surface `.env`/secrets
  files found in a vault root.
- Keep each vault a plain single-checkout git repo (clone, not worktree).

**Don't:**
- Don't write to `.obsidian/*` (especially `workspace.json`,
  `workspaces.json`, plugin data) — that's the app's own live state.
- Don't run `git checkout`/`pull`/`rebase`/bulk file operations against the
  directory Obsidian currently has open as a vault; do that work in a
  separate clone/branch and merge afterward, then let the user (or a
  controlled sync step) bring the change into the live directory.
- Don't register a worktree of an existing vault as its own Obsidian vault —
  it fragments the graph/backlinks/search into a second, disconnected PKB.
- Don't nest one vault inside another.
- Don't assume the official CLI is available — check `command -v obsidian`
  first; it requires one-time enablement per machine and the app running.

## (b) Verdict on the "no worktrees for vaults" hypothesis

**Correct conclusion, wrong mechanism, worth restating precisely.**

Phil's instinct — don't use git worktrees for vaults — holds up, but not
because a worktree makes the *running app* more prone to index corruption or
write races. It doesn't: the file-level hazards (§1, §4) are exactly as real
in a single plain clone as in a worktree; git worktrees don't add or remove
any risk at the filesystem-watcher level.

The actual reason worktrees are the wrong tool here is **vault identity is
the absolute path** (confirmed directly from this machine's `obsidian.json`),
and Obsidian actively prevents opening the same path twice but has no concept
of "these two paths are the same logical vault." A worktree is, by
definition, a second path over the same git history — so using one as a
vault either buys nothing (if only one worktree is ever opened, a worktree is
just a more complicated plain clone) or actively fragments the PKB into two
disconnected vaults with separate graphs, backlinks, and search (if more than
one is opened). Secondarily, the community `obsidian-git` plugin has a known
(if dated) bug against worktree layouts, and `.obsidian` — commonly tracked
in git, as it is in all three vaults here — duplicates and diverges per
worktree.

**Practical framing for the routing design:** keep each vault a single plain
git clone. If an agent needs an isolated workspace to draft changes against a
vault's git history (e.g., to prepare a batch of note edits for review before
merging), a worktree of the *vault repo* is fine as a **staging area that is
never itself opened in Obsidian** — the hazard only appears at the moment
that staged work is merged/pulled into the one directory the app has
registered as the vault, and at that point the hazard is the ordinary
"don't bulk-mutate the live directory while the app has it open" rule from
§4, not anything specific to worktrees.

## (c) How vault-by-name addressing should work in the registry

- Use each vault's **folder basename** as its canonical name for routing
  (`Engagement PKB`, `Tech Notes`, `Easygo`, and whatever the future private
  vault is named) — this is exactly what `obsidian.json` stores (path only,
  no separate display name) and exactly what the official CLI's `vault=<name>`
  resolves against.
- Guarantee basename uniqueness across all vaults an agent might address
  when the future private vault is created; if a collision is unavoidable,
  either rename the folder or install the "Vault Nickname" community plugin
  in the colliding vault to establish a disambiguated display name the CLI
  can target instead.
- Registry entries should record: name (basename), absolute path, and a flag
  for whether the official CLI is expected to be usable (app installed +
  CLI enabled on this machine) versus whether the router must fall back to
  direct filesystem writes (app closed, or CLI not enabled) — since the two
  write paths have different safety properties (§1, §4).
- Do not key the registry by anything derived from git remote/history —
  Obsidian itself doesn't; two clones of the same repo are, and should be
  treated as, two different vaults for routing purposes, which is consistent
  with the worktree verdict above.

## Appendix: local inspection notes (read-only)

- All three vaults (`Engagement PKB`, `Tech Notes`, `Easygo`) are plain git
  repositories, single worktree each (`git worktree list` shows exactly one
  entry per vault, all on `main`) — none are currently set up as worktrees of
  something else.
- `.obsidian/community-plugins.json`: `Engagement PKB` → `["terminal"]`;
  `Tech Notes` → `["folder-notes"]`; `Easygo` → `["folder-notes"]`. No
  `obsidian-git` in use on any of them currently.
- `obsidian.json` (global app registry) also lists two non-vault-related
  entries from unrelated past sessions (`/Users/phil/tmp-claude/docs`,
  `/Users/phil/Dev/test-onboard-doc/docs`) — confirms the registry is a flat,
  path-keyed list with no grouping/hierarchy concept.
- `command -v obsidian-cli obs obsidian` all return nothing on this machine;
  only `/Applications/Obsidian.app` is present. The official CLI needs to be
  enabled via Settings → General before by-name addressing is usable from a
  shell/agent.
- No vault content was modified during this research.
