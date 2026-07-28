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
