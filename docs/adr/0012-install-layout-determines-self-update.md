# Install layout determines self-update

pi ships a real updater. `pi update --self` detects how pi was installed by
inspecting its own resolved path, infers the npm prefix from the package
directory (`<prefix>/lib/node_modules/@scope/pkg`), and replays
`npm install -g --prefix <inferred>` with whatever `npm` is on PATH (verified
in 0.84.1 source, 2026-08-13). Whether self-update works is therefore a
property of the **install layout**, not of the tool. Decided 2026-08-13:
**pi installs from the npm tier on every platform and is updated only by
`pi update --all` in the weekly sweep.** This supersedes ADR-0011's
per-platform routes for pi; its principles stand — and this satisfies its
maintainer principle better, because upstream now maintains the updater
itself, not just the package.

## The principle

- **Control the first install and you control every update after it.**
  Self-update inherits the layout the first install chose. The tier's layout
  (`~/.local/share/npm`, pinned-node wrappers in `~/.local/bin`) is exactly
  the layout `pi update` infers correctly, so the tier and the updater are
  one mechanism with two entry points — not competing mechanisms.
- **A package manager that fights the updater loses to it.** Where upstream
  ships a working self-updater, a distro/brew route must either disable it
  or be corrupted by it. ADR-0011 only measured `pi update` on the
  standalone binaries (where it refuses); on layouts where it works, the
  calculus flips.
- **The pinned interpreter and refuse-to-link survive.** Nice-to-have, kept
  because they cost nothing here: wrappers still pin the brew/dnf node, and
  the smoke test re-runs after every self-update — the moment a node-floor
  bump would actually arrive.

## The routes

| platform | install (if missing) | update (weekly sweep) | interpreter |
|---|---|---|---|
| macOS | npm tier, `run_before_all-02` | `pi update --all` | `/opt/homebrew/bin/node` (brew `node`, autobumped, swept weekly) |
| Fedora | npm tier, `run_before_all-02` | `pi update --all` | `/usr/bin/node` (dnf `nodejs`, swept weekly) |

## Considered options

- **Keep brew on macOS (ADR-0011's route)** — rejected: brew and `pi update`
  are mutually hostile. On a brew install, self-update infers the versioned
  Cellar libexec prefix and npm-installs the new version *inside the old
  version's Cellar directory*: brew's receipt then lies, and the next weekly
  `brew upgrade` stomps the self-updated copy. Keeping brew means keeping
  two update mechanisms that corrupt each other's state.
- **Upstream's curl installer + `pi update`** — rejected again, on the two
  ADR-0011 objections that still hold (re-measured 2026-08-13): it targets
  PATH-npm's global prefix if writable — nvm's on the Mac, so the install
  evaporates when that node version is switched or pruned — and its layout
  leaves `#!/usr/bin/env node` shebangs unpinned, resurrecting the
  crashes-under-project-node hazard the tier's wrappers close. Its other two
  objections have weakened (non-interactive runs skip rc-file edits; it only
  unpacks a standalone node when no adequate node exists) — not enough.
- **`pi update` without `--all`** — rejected: extensions are packages too
  and would otherwise never be swept. `--all` accepts the same
  update-at-an-unchosen-moment trade-off already accepted for pi itself.
- **Keeping `npm_tier_sync` in the weekly sweep alongside self-update** —
  rejected: for a self-updating tool it is the same npm command run twice.
  If a non-self-updating npm CLI ever joins the tier, the sync loop returns
  for it then — deliberately not built in advance.

## Consequences

- `node` becomes a declared formula in `darwin.brews` (it was already
  installed as a pi-formula dependency; now something owns it).
- One-time migration on macOS machines: `run_once_before_all-00-retire-brew-pi`
  uninstalls the formula; the same apply reinstalls pi via the tier. `~/.pi`
  is untouched; `which pi` moves to `~/.local/bin/pi`.
- The self-update command shells out to bare `npm`, so the sweep prepends
  the pinned npm's directory to PATH for that one invocation, and closes
  stdin so an unexpected prompt fails fast rather than hanging apply.
- The refuse-to-link smoke test now runs after every self-update. If a new
  pi raises its node floor past the pinned node, the wrapper is removed with
  a warning naming the required range; recovery is upgrade node (brew/dnf),
  re-apply — unchanged from ADR-0011.
- If upstream changes the updater's shape (layout inference, npm flags),
  this decision is what to revisit; the measured facts live in the spec
  (`docs/superpowers/specs/2026-08-13-pi-self-update-design.md`).
