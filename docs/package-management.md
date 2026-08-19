# Package management & upgrades

## Install vs. upgrade

Packages are declared in `.chezmoidata/packages.yaml` and **installed** by the
`run_before_all-*` scripts on every `chezmoi apply`. But `brew install` /
`dnf install` only add *missing* packages — they never upgrade what's already
there. So without a separate step, an installed tool sits at whatever version
first landed (this is why herdr stayed on 0.7.3 until a manual `brew upgrade`).

## Weekly upgrade

`run_onchange_upgrade-packages.sh.tmpl` fills that gap. It re-runs at most once
a week (via a date-stamped `now`-comment that only changes weekly, the same
trick as the herdr updater) and upgrades **only the managed packages** from
`packages.yaml`:

- macOS: `brew upgrade <managed formulae>` — **formulae only**, never a bare
  `brew upgrade`. That keeps casks (Karabiner-Elements, Ghostty, 1Password,
  WezTerm, Zed) as deliberate manual upgrades — an unattended weekly bump of
  the tool that powers the Hyper key is exactly the surprise we don't want.
- Fedora: `sudo dnf upgrade -y <managed packages>` — scoped, **not** a
  whole-OS `dnf upgrade`.
- both platforms: the npm tier is not swept with `npm install` — pi updates
  itself and its extensions via `pi update --all`; see the pi section below.

herdr on Linux is curl-installed (no package manager), so it keeps its own
`run_onchange_update-herdr.sh.tmpl` (`herdr update`, also weekly). On macOS
herdr is a brew formula and rides the weekly `brew upgrade` above.

Each formula/package is upgraded individually and failures are collected,
not fatal — one broken package (e.g. installed from a tap Homebrew no
longer trusts by default, see `brew trust`/https://docs.brew.sh/Tap-Trust)
must not abort the rest of the batch or make `chezmoi apply` itself fail
repeatedly until someone notices. Failures print a warning to stderr
instead. If `brew upgrade <formula>` starts erroring with "Refusing to load
formula ... from untrusted tap", check `brew info <formula>` for its source
tap — if it's since landed in homebrew-core, `brew uninstall`, `brew untap`,
`brew install` is usually cleaner than trusting the old tap.

## chezmoi: outside the tiers, because it bootstraps them

chezmoi is deliberately **not** declared in `packages.yaml` and comes from
upstream's install script into `~/.local/bin` on every platform, per the
README one-liner's `-b "$HOME/.local/bin"`.

It cannot be owned by a package manager: chezmoi is what installs the package
managers, so on a bare machine the install script necessarily runs first. By
ADR-0012's principle — whoever controls the first install controls every
update after it — that makes the install script the owner everywhere, and
Fedora settles it independently since metabox has no brew.

- **Update**: manual `chezmoi upgrade`, which re-installs "in the same way as
  chezmoi was previously installed" and so preserves the layout. Deliberately
  *not* in the weekly sweep: that script is executed *by* chezmoi during
  apply, so upgrading there would swap the running binary mid-run and leave
  "which chezmoi ran this apply" without a single answer. This is the
  decoupling gap the sweep's own header describes.
- **A brew formula must not coexist.** `XDG_BIN_HOME` puts `~/.local/bin`
  ahead of brew on PATH, so a formula install is silently shadowed: brew's
  inventory claims a chezmoi that never runs, and it drifts from the live one
  in either direction. Found on 2026-08-19 with a v2.67.0 install-script
  binary shadowing a v2.70.2 formula. `run_once_before_all-00-retire-brew-chezmoi`
  removes the formula, but only when a `~/.local/bin/chezmoi` exists to fall
  back on.

## pi: npm tier everywhere, self-updating

pi installs from the npm tier on **both** platforms and is updated only by
its own updater (ADR-0012, superseding ADR-0011's per-platform routes):

- **Install** (if missing): declared in `packages.yaml` under the top-level
  `npm` tier; mechanism in `.chezmoitemplates/npm-tools` +
  `npm-tier-install`, included by `run_before_all-02` on both OS branches.
  macOS pins wrappers to brew's node (`node` is a declared formula), Fedora
  to dnf's (`nodejs`/`npm` in `fedora.dnf`). Adding a global npm CLI is a
  one-line change to the top-level `npm` tier.
- **Update** (weekly sweep): `pi update --all` — pi *plus* installed
  extensions. `pi update` replays `npm install -g` against the prefix
  inferred from its own install path, which is exactly the tier's layout, so
  upstream's updater and the tier are one mechanism. The sweep prepends the
  pinned npm's directory to PATH for that invocation and closes stdin so a
  prompt can never hang apply. There is deliberately no `npm_tier_sync` in
  the sweep: for a self-updating tool it would be the same npm command run
  twice. A future npm CLI that cannot self-update reintroduces the sync loop
  for itself then.

Two non-obvious things the tier still handles, both worth not re-litigating:

**The interpreter must be pinned.** npm bins ship `#!/usr/bin/env node`, so a
node CLI resolves its interpreter from PATH at invocation. pi requires node
>= 22.19.0 and *crashes* under an older one (an undici `TypeError` that reads
as a pi bug). Several projects here pin node 18/20 via `nvm.fish`, so this is
a live hazard. The tier generates one wrapper per bin that execs the
brew/dnf-managed node explicitly.

**npm will install something that cannot run** (no `EBADENGINE` warning, no
fallback, `--engine-strict` doesn't help — measured in ADR-0011). So the tier
smoke-tests each bin under the pinned node and refuses to link one that
fails, naming the required range — and since ADR-0012 this check re-runs
after **every self-update**, the moment a node-floor bump would actually
arrive. The package stays installed; upgrade node, re-apply, and it links.

**Routes that stay rejected** (measured; see ADR-0012): Homebrew — its
receipt and `pi update` corrupt each other (self-update writes into the
versioned Cellar dir, the weekly `brew upgrade` stomps it back). Upstream's
curl installer — targets PATH-npm's global prefix (nvm's here, which
evaporates when that node is pruned) and leaves shebangs unpinned. The
standalone binaries — `pi update` refuses on them (bun hides the real path),
so adopting them means hand-rolling the update path for a tool that ships
most days; still the right shape only for a host that must run pi with no
node at all.

## Known gap (revisit)

Coupling upgrades into `chezmoi apply` is a deliberate trade-off, not an
endorsement: `apply` should ideally be fast and deterministic, and a bundled
`brew`/`dnf upgrade` makes it neither — a plain apply can suddenly spend
minutes, or pull a breaking change at an unchosen moment. The weekly gate
bounds the pain but doesn't remove it.

Better long-term shapes (deferred): a `launchd` (macOS) / `systemd` (Linux)
timer that upgrades out-of-band, or an explicit one-shot command run on
demand — either of which decouples "converge my config" from "update my
software". Left as-is for now by choice.
