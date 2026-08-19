# pi setup

pi (`@earendil-works/pi-coding-agent`, installed via the npm tier — ADR-0012)
keeps everything in `~/.pi/agent`, mixing authored config, live secrets and
runtime caches in one directory. Only three things there are ours to manage.

## What is managed

| Target | How | Why |
|--------|-----|-----|
| `settings.json` | `modify_` script | app-owned file; merge our keys, pass the rest through |
| `keybindings.json` | verbatim | pure authored intent; pi only rewrites it on a version migration |
| `extensions/modes/*.ts` | verbatim | authored code (the EXPLORE/EDIT/YOLO modes extension) |

### settings.json — why a `modify_` script

pi persists runtime state straight back into `settings.json`: `/settings`,
`/model` and the thinking-level picker all write to it, and pi bumps
`lastChangelogVersion` on every self-update. A statically-managed file would
therefore drift constantly.

Note the difference from `dot_claude/modify_settings.json`, which lists a
*managed* block plus a small `PRESERVE` allowlist. That shape is unsafe here:
pi's `markModified` covers **all ~41 settings**, so any key not on a preserve
list would be deleted the first time it was changed in the TUI. So
`private_dot_pi/private_agent/modify_settings.json` takes the
`dot_config/private_1Password/settings/` shape instead — merge `DESIRED` over
the live file, pass every other key through untouched — and emits stdin
byte-for-byte when already converged, so formatting can't cause diff churn.

`DESIRED` currently holds one key, `defaultThinkingLevel: high`; the script is
mostly there as the extension point for the next one. Deliberately excluded:

- **`defaultProvider` / `defaultModel`** — `/model` writes the pair together,
  so pinning one and not the other can leave an invalid provider+model
  combination. Model ids also churn with the provider catalogue, and
  `auth.json` is per-install, so a fresh machine re-runs the auth flow anyway.
  (Same call as `model` in `dot_claude/modify_settings.json`.)
- **`theme`, `tuiMode`, `fullscreenScrollbar`, `markdown.mermaid`** — these are
  pi's own documented defaults, written back verbatim by `/settings`.
  Asserting a default buys nothing and adds diff surface.

Change a setting by editing `DESIRED`, not by capturing the whole file.

### keybindings.json — verbatim

pi never writes this as runtime state; the one write path is
`migrateKeybindingsConfigFile()`, which renames binding ids when a pi version
changes them. If a future upgrade does that, `chezmoi diff` will show it —
accept the migration with `chezmoi re-add`, don't revert it.

### The modes extension — edit in place, then `re-add`

`extensions/modes/` is auto-discovered by pi (`~/.pi/agent/extensions/*/index.ts`),
so it needs no registration in `settings.json`. The files resolve `$HOME` at
runtime and hardcode no paths, so they are managed verbatim with no templating.

It is captured *from* `~/.pi`, not symlinked into the chezmoi source dir.
Symlinking would be tempting for actively-developed code — no re-add step —
but the source dir (`~/.local/share/chezmoi`) is a default-branch checkout,
and ADR-0004 makes local `main` a read-only mirror: editing through a symlink
would mutate it on every keystroke. So the loop is:

```sh
# edit ~/.pi/agent/extensions/modes/*.ts in place, then:
chezmoi re-add ~/.pi/agent/extensions/modes    # existing files
chezmoi add ~/.pi/agent/extensions/modes/new.ts # new files are NOT picked up automatically
```

`chezmoi diff` only compares files already in the source state, so it stays
silent about a newly created extension file. To catch one, compare the sets:

```sh
comm -3 <(chezmoi managed | grep '^\.pi/' | sed "s|^|$HOME/|" | sort) \
        <(find ~/.pi -type f | sort)
```

Everything unmatched should be exactly the ignore list below.

## What is not managed

Listed in `.chezmoiignore`, which also makes `chezmoi add` refuse them
(verified: it warns `ignoring .pi/agent/...` and writes no source file — a
guard against a future recursive add sweeping the secrets in).

- `auth.json` — live GitHub Copilot OAuth tokens. Never commit.
- `models-store.json` — provider catalogue, re-fetched.
- `trust.json` — per-machine absolute project paths (`/trust` writes it).
- `sessions/` — session transcripts.
- `extensions/herdr-agent-state.ts` — installed and overwritten by herdr's own
  integration (`run_once_install-herdr`); two owners would fight.

`~/.pi` and `~/.pi/agent` are `0700` because of `auth.json`, hence the
`private_` prefixes in the source tree. Verified by applying to a scratch
destination (`chezmoi --destination`): a first apply creates both directories
`0700`, leaves `extensions/` and `extensions/modes/` at `0755`, and seeds
`settings.json` from nothing to just the `DESIRED` key.

## New-machine steps (manual)

`chezmoi apply` installs pi and pre-seeds the config above, but auth can't be
automated: run `pi`, sign in to GitHub Copilot when prompted, then pick a
model with `/model` (it persists to `defaultModel`, which chezmoi leaves
alone). `/trust` each project as you meet it.
