# Install routes follow the maintainer, and interpreters are pinned

Adding pi (a coding agent that ships most days) forced a choice between five
plausible routes: Homebrew, npm, upstream's curl installer, upstream's
standalone binaries, and mise. Decided 2026-08-07: **a tool comes from
whichever mechanism someone else keeps current, per platform** — the
`pi-coding-agent` formula on macOS, `npm install -g` on Fedora — and where a
route leaves the interpreter unpinned, we pin it. The routes are documented in
`docs/package-management.md`; this ADR records why the other four lost, so the
question is not reopened every time a JS-based CLI shows up.

## The principle

- **Prefer the route with an upstream maintainer.** The cost of a tool is not
  installing it, it is tracking it. A route that follows upstream by itself
  (a package manager, ideally an autobumped one) beats a route we drive, and
  beats it by more the faster upstream moves.
- **Never adopt machinery on a tool's behalf.** If a route requires standing up
  a subsystem the repo does not otherwise use, that subsystem needs its own
  decision on its own merits — it does not ride in behind a CLI install.
- **Pin the interpreter for interpreted tools.** A `#!/usr/bin/env node`
  shebang resolves against PATH at invocation, so a global tool inherits
  whatever runtime the current directory's version manager happens to have
  selected. That is a defect to close at install time, not a caveat to document.

## The routes

| platform | route | who tracks the version |
|---|---|---|
| macOS | `pi-coding-agent` in `packages.yaml` `darwin.brews` | homebrew-core, `autobump: true`, plus the weekly `brew upgrade` sweep |
| Fedora | `run_onchange_install-pi.sh.tmpl`, weekly `npm install -g` into `~/.local/share/pi` | us, but with npm doing the version resolution |

`nodejs` and `npm` join `packages.yaml` `fedora.dnf` — not as project tooling
(node for projects stays with `nvm.fish` / direnv, per `docs/direnv.md`) but as
pi's runtime, declared there precisely so the existing install and weekly
upgrade machinery covers them rather than inventing a second mechanism.

## Considered options

- **Upstream's standalone binaries** — rejected, and it was the closest call.
  They are genuinely node-free (verified: a bun-compiled 76MB executable
  printing its version with no node on PATH at all) and would have made both
  platforms identical. But `pi update --force` on such an install returns
  *"pi cannot self-update this installation… Location of pi executable:
  `/$bunfs/root/pi`"* — bun's virtual filesystem hides the real path, so there
  is **no upstream update path**. Adopting them means hand-rolling fetch,
  checksum verification and an atomic swap of a directory bundle, on every
  platform, for a tool that released 0.83.0 → 0.84.1 inside a single afternoon.
  That is the maintainer principle inverted. (Kept on file as the right shape
  for a host that must run pi with no node at all.)
- **mise** — rejected. It could own both node and pi computer-wide, and it is
  nominally already installed, but it is inert here: no activation in zsh or
  fish, no config directory, no shims, zero tools managed. node is owned by
  `nvm.fish`. Adopting mise means wiring activation into two shells and running
  a second version manager alongside nvm — a version-manager migration, which
  is a decision in its own right and not one a CLI install gets to make. Two
  further traps if it is ever revisited: the installed build's
  `npm.package_manager = "auto"` means "aube if installed, else fall back to
  npm" (the documented no-npm-required behaviour is newer than what is on the
  machine), and its registry still maps the `pi` alias to the pre-rename
  `@mariozechner/pi-coding-agent`.
- **Upstream's curl installer** — rejected. It is 1500 lines that mostly exist
  to bootstrap node: on Fedora it finds neither brew nor apt nor apk and falls
  through to unpacking its own standalone node, i.e. a second node installation
  the dotfiles do not know about, plus prompts to edit shell rc files.
- **Fedora's `pi-coding-agent` package** — rejected *for now*, on availability
  rather than principle: it exists only on the rawhide/main branches (absent
  from f42/f43/f44), sat at 0.80.3 against upstream's 0.84.1, and strips
  pi-tui's native module. It `Requires: nodejs` regardless, so the node
  declaration above is on the path to this becoming the Fedora route later.
- **npm on macOS too, for uniformity** — rejected. The npm global prefix here
  lives *inside* the nvm version directory, so a global install evaporates when
  that node version is switched or pruned; and it would replace a one-line,
  autobumped, externally-maintained route with a self-driven one on the machine
  that actually exists.

## Consequences

- macOS carries no pi-specific scripting at all: one line in `packages.yaml`,
  and the existing weekly sweep is the entire maintenance story.
- Homebrew pulls `node` into `/opt/homebrew` as a formula dependency. Accepted:
  it is shadowed by `nvm.fish` for interactive use, and pi never consults PATH
  for its interpreter because Homebrew rewrites the shebang to an absolute
  `opt/node/bin/node` — which is also what makes the brew route immune to the
  hazard below.
- The Fedora script refuses to install under node < 22.19.0 rather than leaving
  a `pi` that crashes at runtime with an undici `TypeError`. A Fedora whose
  default `nodejs` is too old therefore gets no pi and says so — deliberately
  loud, not a silent partial install.
- The two platforms run different builds of the same version (Homebrew's
  node-backed install vs npm's). Accepted; herdr already has this shape.
- pi's extensions and skills install as npm packages either way, so node
  remains a real runtime dependency of using pi regardless of route.
