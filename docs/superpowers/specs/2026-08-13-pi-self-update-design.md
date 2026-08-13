# pi self-updates from a uniform npm-tier layout

**Date:** 2026-08-13
**Status:** Approved (design), pending implementation
**Amends:** ADR-0011 (pi install routes) — see §6

## Problem

pi is installed by two disjoint mechanisms (Homebrew formula on macOS, npm
tier on Fedora, per ADR-0011) and upgraded by two more (weekly `brew upgrade`
sweep vs weekly `npm_tier_sync`). pi ships a built-in updater, `pi update`,
and Phil prefers one mechanism across all machines over per-platform routes.

## Key facts (verified 2026-08-13, pi 0.84.1)

These are what the design stands on; if pi's updater changes shape, revisit.

- `pi update --self` is a **replayed npm install**: it detects the install
  method from its own resolved path, infers the npm prefix from the package
  directory (`<prefix>/lib/node_modules/@scope/pkg`), and runs
  `npm install -g --ignore-scripts --min-release-age=0 --prefix <inferred>
  @earendil-works/pi-coding-agent` using whatever `npm` is on PATH. The
  install layout therefore fully determines whether self-update works.
- On the existing Fedora npm-tier layout (`~/.local/share/npm`) the inferred
  prefix is exactly right: self-update and the tier are the same mechanism
  with two entry points.
- On a Homebrew install, self-update infers the *versioned Cellar libexec*
  prefix: it would write a new pi inside the old version's Cellar directory,
  brew's receipt then lies, and the next `brew upgrade` stomps the update.
  Homebrew and `pi update` are mutually hostile.
- The upstream curl installer (`pi.dev/install.sh`) targets PATH-npm's global
  prefix if writable, else `~/.local`. On the Mac, PATH npm is nvm's, so the
  install lands inside the nvm version directory and evaporates when that
  node is switched or pruned; the layout also leaves `#!/usr/bin/env node`
  shebangs unpinned. Both hazards were measured in ADR-0011 and still hold,
  so the curl installer stays rejected. (Its other two objections have
  weakened: run non-interactively it skips rc-file edits, and it only unpacks
  a standalone node when no adequate node exists.)

## Decision

Make the npm tier the install route on **both** platforms and
`pi update --all` the only updater. The pinned-interpreter wrapper and the
refuse-to-link smoke test are kept (Phil: nice-to-have, keep unless provably
costly — it costs nothing here). Weekly scope is pi **plus extensions**
(`--all`), accepting the same update-at-an-unchosen-moment trade-off already
accepted for pi itself.

## Design

### 1. Data — `.chezmoidata/packages.yaml`

- The npm tier moves from `fedora.npm` to a top-level `npm:` key (it is now
  cross-platform data): `@earendil-works/pi-coding-agent`.
- `darwin.brews`: remove `pi-coding-agent`, add `node`. node is already
  installed as a formula dependency; once the formula goes it must be
  declared or nothing owns pi's runtime. It rides the existing weekly
  formula sweep (autobumped in homebrew-core).
- `fedora.dnf`: unchanged (`nodejs`, `npm` stay, same rationale as today).

### 2. Mechanism — `.chezmoitemplates/npm-tools`

Only the pinned paths change, becoming platform-templated:

| platform | `NPM_TIER_NODE` / `NPM_TIER_NPM` |
|---|---|
| macOS arm64 | `/opt/homebrew/bin/{node,npm}` |
| macOS x86_64 | `/usr/local/bin/{node,npm}` |
| Fedora | `/usr/bin/{node,npm}` |

Wrappers, smoke test, bin-map enumeration: unchanged, now shared. The
deliberate not-PATH-driven stance stays — the pinned interpreter is the
brew/dnf-managed node, never whatever a version manager put on PATH.

### 3. Install-if-missing — `run_before_all-02.sh.tmpl`

The darwin branch gains the identical npm-tier block the Fedora branch has
(installed-check → `npm_tier_sync` → warn if pinned node/npm absent), placed
**after** `brew bundle` so node exists on a fresh machine. Bootstrap is:
brew installs node → tier installs pi → wrapper links it. No curl script.

### 4. Weekly update — `run_onchange_upgrade-packages.sh.tmpl`

The npm-tier `npm_tier_sync` loop is **replaced** by a self-update step,
identical on both platforms:

1. If `~/.local/bin/pi` exists, run `pi update --all` with the pinned npm's
   directory prepended to PATH (self-update shells out to bare `npm`; it must
   find the npm that installed pi, not nvm's).
2. Re-run `npm_tier_wrap` for pi: re-runs the smoke test and regenerates
   wrappers. If a new release raises pi's node floor past the pinned node,
   the wrapper is removed with a warning naming the required range — today's
   refuse-to-link contract, now enforced after every self-update. Recovery
   unchanged: upgrade node (brew/dnf), re-apply.
3. Failures collect into the existing non-fatal `failed=()` reporting.

No generic `npm_tier_sync` remains in the sweep: for pi it would be the same
npm command run twice. If a future npm CLI that cannot self-update joins the
tier, the sync loop returns for it then — documented, not built now.
One weekly gate, one script, as today.

### 5. Migration — one-time, macOS only

A `run_once_before` script uninstalls the `pi-coding-agent` formula if
present, named to sort **before** `all-02` in chezmoi's script ordering
(e.g. `run_once_before_all-00-retire-brew-pi.sh.tmpl`) so retire → reinstall
happens in one apply, in that order. `~/.pi` (auth, settings, sessions,
extensions) is untouched. Fedora machines need nothing.

On this Mac specifically, the first apply after implementation does:
`brew uninstall pi-coding-agent` (node stays — now declared) → tier installs
pi to `~/.local/share/npm` → smoke test under brew node → wrapper at
`~/.local/bin/pi`, which already precedes `/opt/homebrew/bin` on PATH.
Net user-visible change: `which pi` moves; version stays latest; pi gains
immunity it already had (brew's shebang rewrite) via the wrapper instead.

### 6. Docs and ADR

- **New ADR-0012**: "install layout determines self-update" — records that
  `pi update` is trusted once the layout is self-update-native; why brew is
  retired (the Cellar fight above); why the curl installer stays rejected
  (nvm-prefix targeting, unpinned interpreter). Notes that this satisfies
  ADR-0011's maintainer principle *better*: upstream now maintains the
  updater itself, not just the package.
- **ADR-0011**: forward-pointing amendment note (same style as 0008/0009 →
  0010); its principles stand, its pi-specific routes are superseded.
- **`docs/package-management.md`**: pi section rewritten to match.

### 7. Verifications owed at implementation time

- `pi update --all` must never prompt non-interactively; global extension
  updates shouldn't ask for trust, but verify, and pass `--no-approve` if
  they do.
- `--min-release-age` is npm ≥ 11 syntax. Brew node ships npm 11; confirm
  the Fedora box's dnf npm accepts it (or that pi degrades gracefully).
- Confirm chezmoi's script ordering places the migration script before
  `all-02` under the chosen name.

## Error handling

- Registry/network flake during `pi update`: collected warning, apply never
  fails (existing sweep contract).
- New pi requires newer node than pinned: wrapper removed with actionable
  warning; pi absent-with-reason until node upgraded and re-apply.
- Pinned node/npm missing (fresh machine mid-bootstrap): tier warns and
  skips, as today.

## Testing

`tests/` covers eos hooks only; no test surface here. Verification is
behavioural: on this Mac, run the migration + apply, confirm `which pi`,
`pi --version`, wrapper contents, and a forced `pi update` round-trip.

## Out of scope

- Decoupling upgrades from `chezmoi apply` (the known launchd/systemd-timer
  gap in `docs/package-management.md`) — unchanged by this design.
- Fedora's distro `pi-coding-agent` package as a future route — unaffected;
  revisit per ADR-0011 if it reaches a stable branch.
