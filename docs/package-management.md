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

## pi: brew on macOS, npm on Fedora

pi is the same herdr-shaped split, for the same reason — a package manager
owns it where one does, a script owns it where none does (ADR-0011):

- **macOS**: the `pi-coding-agent` formula in `packages.yaml`. It is in
  homebrew-core (no tap trust to manage), bottled, and carries
  `autobump: true` — check any formula with
  `curl -fsSL https://formulae.brew.sh/api/formula/<name>.json | jq .autobump`
  — so it follows a fast-releasing upstream automatically and the weekly
  `brew upgrade` above is the whole maintenance story.
- **Fedora**: declared in `packages.yaml` under a third tier, `fedora.npm`,
  alongside `copr` and `dnf`. Mechanism lives in `.chezmoitemplates/npm-tools`
  and is included by the same two scripts that handle every other tier —
  `run_before_all-02` installs what is missing, the weekly sweep upgrades.
  `nodejs` and `npm` are declared in `fedora.dnf` purely so that tier has a
  runtime that dnf installs *and* the sweep keeps upgraded. Fedora's own
  `pi-coding-agent` exists only on rawhide/main and trails upstream by weeks,
  so it is not a route yet; revisit if it reaches a stable branch (it will
  still pull `nodejs`, so nothing here is wasted).

Adding a global npm CLI is therefore a one-line change to `fedora.npm`. Two
non-obvious things the tier handles for you, both worth not re-litigating:

**The interpreter must be pinned.** npm bins ship `#!/usr/bin/env node`, so a
node CLI resolves its interpreter from PATH at invocation, not from whatever
installed it. pi requires node >= 22.19.0 and *crashes* under an older one
(`TypeError: webidl.util.markAsUncloneable is not a function`, from undici) —
an error that reads as a pi bug, not a node mismatch. Several projects here
pin node 18/20 via `nvm.fish`, so this is a live hazard, not a theoretical
one. Homebrew already solves it by rewriting the shebang to an absolute
`opt/node/bin/node`; the tier does the equivalent, generating one wrapper per
entry in a package's own `bin` map that execs `/usr/bin/node` explicitly.

**npm will install something that cannot run.** On node 20.20.2 / npm 10.8.2,
`npm install -g @earendil-works/pi-coding-agent` installs the latest release
despite `engines: >=22.19.0`, with no `EBADENGINE` warning and no fallback to a
compatible older release — `--engine-strict` does not change it. So the tier
smoke-tests each bin under the pinned node and refuses to link one that fails,
naming the required range. The package stays installed; upgrade node, re-apply,
and it links.

**The upstream standalone binaries are not a route.** pi publishes bun-compiled
single-binary builds on every GitHub release, and they are genuinely node-free
— but `pi update` refuses on them ("cannot self-update this installation",
because bun hides the executable's real path), so adopting them means
hand-rolling fetch + checksum + atomic swap for a tool that ships most days.
Rejected for that reason, not for lack of appeal. It is, however, the right
shape *if* a Linux box ever needs pi without any node at all.

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
