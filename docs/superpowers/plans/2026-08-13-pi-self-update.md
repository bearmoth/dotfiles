# pi Self-Update From a Uniform npm-Tier Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pi installs from the npm tier on both platforms and updates only via `pi update --all` in the weekly sweep; the brew formula route is retired.

**Architecture:** `pi update` replays `npm install -g --prefix <inferred-from-its-own-path>`, so making the tier's layout (`~/.local/share/npm` + pinned-node wrappers in `~/.local/bin`) the install route on every platform makes upstream's updater and the tier one mechanism. Data stays in `packages.yaml`, mechanism in `.chezmoitemplates/`, one weekly gate in the existing sweep script.

**Tech Stack:** chezmoi templates (Go text/template + sprig), bash, Homebrew/dnf/npm.

**Spec:** `docs/superpowers/specs/2026-08-13-pi-self-update-design.md` (approved 2026-08-13).

## Global Constraints

- Pinned interpreters, never PATH node: macOS arm64 `/opt/homebrew/bin/{node,npm}`, macOS x86_64 `/usr/local/bin/{node,npm}`, Fedora `/usr/bin/{node,npm}`.
- npm prefix `$HOME/.local/share/npm`; wrappers in `$HOME/.local/bin` (existing `npm-tools` values — do not change them).
- Package name everywhere: `@earendil-works/pi-coding-agent`.
- The weekly sweep must never fail `chezmoi apply`: no `set -e`, failures collect into `failed=()`.
- `chezmoi apply` installs only what is missing; upgrades happen only in the weekly sweep.
- This repo's main checkout is a read-only mirror (ADR-0004): all work happens in a worktree via the **worktree-provisioning skill** (repo directive overrides superpowers:using-git-worktrees), lands via PR.
- Verified facts you may rely on: brew node 26.7.0 / npm 11.19.0 already present at `/opt/homebrew/bin` on the Mac; `~/.local/bin` precedes `/opt/homebrew/bin` on PATH; npm 11 accepts `--min-release-age`.

---

### Task 1: Worktree + spec/plan carried onto the branch

**Files:**
- Create (in worktree): `docs/superpowers/specs/2026-08-13-pi-self-update-design.md`, `docs/superpowers/plans/2026-08-13-pi-self-update.md` (copied from the mirror, where they are untracked)

**Interfaces:**
- Produces: branch `pi-self-update` in a worktree; all later tasks run there.

- [ ] **Step 1: Provision the worktree**

Invoke the **worktree-provisioning** skill for repo `bearmoth/dotfiles`, branch `pi-self-update`. (Do not `git branch`/`git checkout` in `~/.local/share/chezmoi`.)

- [ ] **Step 2: Copy spec and plan from the mirror into the worktree**

```bash
mkdir -p <worktree>/docs/superpowers/specs <worktree>/docs/superpowers/plans
cp ~/.local/share/chezmoi/docs/superpowers/specs/2026-08-13-pi-self-update-design.md <worktree>/docs/superpowers/specs/
cp ~/.local/share/chezmoi/docs/superpowers/plans/2026-08-13-pi-self-update.md <worktree>/docs/superpowers/plans/
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-08-13-pi-self-update-design.md docs/superpowers/plans/2026-08-13-pi-self-update.md
git commit -m "docs(spec): pi self-updates from a uniform npm-tier layout"
```

---

### Task 2: `packages.yaml` — npm tier goes top-level, brew formula retired, node declared

**Files:**
- Modify: `.chezmoidata/packages.yaml`

**Interfaces:**
- Produces: `.packages.npm` (top-level list, replaces `.packages.fedora.npm`) — Tasks 3–5 template against this exact key; `node` present in `.packages.darwin.brews`.

- [ ] **Step 1: Edit the darwin brews list**

Remove the line `      - pi-coding-agent` and add `node` after `neovim`:

```yaml
      - neovim
      # pi's runtime (ADR-0012) — was an implicit dependency of the retired
      # pi-coding-agent formula; declared so the npm tier below owns it and
      # the weekly formula sweep keeps it current (autobumped in core).
      - node
      - ripgrep
```

- [ ] **Step 2: Move the npm tier to top level**

Delete the `npm:` block (and its comment) from under `fedora:`, and append at the end of the file, at top level under `packages:` (same indent as `darwin:`/`fedora:`):

```yaml
  # Global npm CLIs, both platforms (ADR-0011/0012). Mechanism lives in
  # .chezmoitemplates/npm-tools (pinned-interpreter wrappers + refuse-to-link
  # smoke test); installed-if-missing by run_before_all-02. pi is NOT swept by
  # npm_tier_sync weekly — it updates itself via `pi update --all` in
  # run_onchange_upgrade-packages (ADR-0012).
  npm:
    - "@earendil-works/pi-coding-agent"
```

The `# Runtime for the npm tier below (ADR-0011)…` comment above `nodejs`/`npm` in `fedora.dnf` stays, but change its first line to `# Runtime for the npm tier (ADR-0011/0012) — not project tooling;` (the tier is no longer "below").

- [ ] **Step 3: Verify the YAML parses and keys are right**

```bash
python3 -c "
import yaml,sys
d=yaml.safe_load(open('.chezmoidata/packages.yaml'))['packages']
assert d['npm']==['@earendil-works/pi-coding-agent'], d.get('npm')
assert 'npm' not in d['fedora'], 'fedora.npm should be gone'
assert 'node' in d['darwin']['brews'] and 'pi-coding-agent' not in d['darwin']['brews']
print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .chezmoidata/packages.yaml
git commit -m "refactor(packages): npm tier goes cross-platform; retire pi-coding-agent formula, declare node (ADR-0012)"
```

Note: `run_before_all-02.sh.tmpl` and the sweep still reference `.packages.fedora.npm` until Tasks 4–5 — the range over a missing key renders empty, so nothing breaks mid-branch, but do not apply from this branch until Task 8's checks pass.

---

### Task 3: `npm-tools` — platform-templated pinned interpreter

**Files:**
- Modify: `.chezmoitemplates/npm-tools` (the four `NPM_TIER_*` assignments and two doc-comment sentences)

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm_tier_available`, `npm_tier_installed <pkg>`, `npm_tier_sync <pkg>`, `npm_tier_wrap <pkg>`, and vars `$NPM_TIER_NPM`, `$NPM_TIER_BIN` — unchanged names, now valid on darwin too. Tasks 4–5 call exactly these.

- [ ] **Step 1: Replace the hardcoded paths**

Replace:

```sh
NPM_TIER_NODE=/usr/bin/node
NPM_TIER_NPM=/usr/bin/npm
```

with:

```
{{ if eq .chezmoi.os "darwin" -}}
{{ if eq .chezmoi.arch "arm64" -}}
NPM_TIER_NODE=/opt/homebrew/bin/node
NPM_TIER_NPM=/opt/homebrew/bin/npm
{{ else -}}
NPM_TIER_NODE=/usr/local/bin/node
NPM_TIER_NPM=/usr/local/bin/npm
{{ end -}}
{{ else -}}
NPM_TIER_NODE=/usr/bin/node
NPM_TIER_NPM=/usr/bin/npm
{{ end -}}
```

- [ ] **Step 2: Update the two comment sentences that say "dnf"**

In the leading doc-comment, change `We generate a wrapper per bin that execs the distro node explicitly.` to `We generate a wrapper per bin that execs the brew/dnf-managed node explicitly.` and, in the final paragraph, `the interpreter these tools get pinned to is the dnf-managed one` to `the interpreter these tools get pinned to is the brew/dnf-managed one`.

- [ ] **Step 3: Verify it renders with the darwin paths on this machine**

```bash
chezmoi execute-template '{{ includeTemplate "npm-tools" . }}' | grep NPM_TIER_NODE=
```

Expected: `NPM_TIER_NODE=/opt/homebrew/bin/node` (single occurrence, no template braces in output).

- [ ] **Step 4: Verify the rendered functions are valid bash**

```bash
chezmoi execute-template '{{ includeTemplate "npm-tools" . }}' | bash -n && echo syntax-ok
```

Expected: `syntax-ok`

- [ ] **Step 5: Commit**

```bash
git add .chezmoitemplates/npm-tools
git commit -m "feat(packages): npm tier pins brew node on macOS, dnf node on Fedora (ADR-0012)"
```

---

### Task 4: Install-if-missing on both platforms (`npm-tier-install` template + `run_before_all-02`)

**Files:**
- Create: `.chezmoitemplates/npm-tier-install`
- Modify: `run_before_all-02.sh.tmpl`

**Interfaces:**
- Consumes: `.packages.npm` (Task 2), `npm_tier_*` functions (Task 3).
- Produces: shared install-if-missing block included by both OS branches.

- [ ] **Step 1: Create `.chezmoitemplates/npm-tier-install`** with exactly:

```
{{- /*
Install-if-missing for the npm tier, shared by the darwin and fedora branches
of run_before_all-02 (ADR-0011/0012). Install only, matching `brew bundle` /
`dnf install` semantics: upgrades are the weekly sweep's job — and pi upgrades
itself there via `pi update --all` (ADR-0012).
*/ -}}
{{ if .packages.npm -}}
{{ includeTemplate "npm-tools" . }}
if npm_tier_available; then
{{ range .packages.npm -}}
	npm_tier_installed {{ . | quote }} || npm_tier_sync {{ . | quote }} || true
{{ end -}}
else
	echo "Warning: npm tier skipped — $NPM_TIER_NODE / $NPM_TIER_NPM missing (expected from the package tier above)" >&2
fi
{{ end -}}
```

(Indented lines use a literal tab, matching `npm-tools` style.)

- [ ] **Step 2: Include it from the darwin branch**

In `run_before_all-02.sh.tmpl`, after the `brew bundle` heredoc's `EOF` line and before the darwin branch's closing `{{ end -}}`, add:

```
{{ includeTemplate "npm-tier-install" . }}
```

(It must come after `brew bundle` so `node` exists on a fresh machine before `npm_tier_sync` runs.)

- [ ] **Step 3: Replace the fedora branch's inline npm block with the same include**

Delete from `{{ if .packages.fedora.npm -}}` through its matching `{{ end -}}` (the block containing `npm_tier_installed … || npm_tier_sync …` and the `expected from dnf` warning), and put in its place:

```
{{ includeTemplate "npm-tier-install" . }}
```

- [ ] **Step 4: Verify the darwin render is valid bash and contains the tier**

```bash
chezmoi execute-template < run_before_all-02.sh.tmpl > /tmp/all-02.rendered
bash -n /tmp/all-02.rendered && echo syntax-ok
grep -c "npm_tier_installed" /tmp/all-02.rendered
grep -c '{{' /tmp/all-02.rendered || true
```

Expected: `syntax-ok`, then `1` (one npm package), then `0` (no unrendered braces).

The fedora branch cannot render on this Mac (`.osid` is machine data); it is exercised by the same shared template, so darwin coverage plus Task 8's Fedora checklist covers it.

- [ ] **Step 5: Commit**

```bash
git add .chezmoitemplates/npm-tier-install run_before_all-02.sh.tmpl
git commit -m "feat(packages): install npm tier on macOS too — shared install-if-missing template (ADR-0012)"
```

---

### Task 5: Weekly sweep — `pi update --all` replaces the npm sync loop

**Files:**
- Modify: `run_onchange_upgrade-packages.sh.tmpl`

**Interfaces:**
- Consumes: `.packages.npm`, `npm_tier_wrap`, `$NPM_TIER_BIN`, `$NPM_TIER_NPM`, `npm_tier_available` (Task 3); existing `failed=()` convention.
- Produces: the only update path for pi on any platform.

- [ ] **Step 1: Delete the linux npm block**

Remove from `{{ if .packages.fedora.npm -}}` through its matching `{{ end -}}` (the block that includes `npm-tools` and loops `npm_tier_sync`) inside the linux branch.

- [ ] **Step 2: Add the shared self-update section**

After the OS-conditional's final `{{ end -}}` and before the `if [ "${#failed[@]}" -gt 0 ]` check, insert:

```
{{ if .packages.npm -}}
{{ includeTemplate "npm-tools" . }}
# pi updates itself (ADR-0012): `pi update` replays `npm install -g` against
# the prefix inferred from its own install path — exactly the tier's layout —
# so upstream's updater and the tier are one mechanism, and --all sweeps pi's
# extensions too. The pinned npm's dir leads PATH so the replayed install
# uses the npm that installed pi, never a version manager's; stdin is closed
# so an unexpected prompt fails fast instead of hanging apply.
# Deliberately no npm_tier_sync loop here: for a self-updating tool it would
# be the same npm command run twice. If a non-self-updating npm CLI ever
# joins the tier, reintroduce the sync loop for it then (see
# docs/package-management.md).
if npm_tier_available && [ -x "$NPM_TIER_BIN/pi" ]; then
	echo "Updating pi and extensions (pi update --all)..."
	PATH="$(dirname "$NPM_TIER_NPM"):$PATH" "$NPM_TIER_BIN/pi" update --all </dev/null || failed+=("pi-update")
	# Re-run the smoke test + wrapper regen after every self-update: a new
	# release may raise pi's node floor past the pinned node, and the
	# refuse-to-link contract (ADR-0011) applies at update time, not just
	# install time.
{{ range .packages.npm -}}
	npm_tier_wrap {{ . | quote }} || failed+=("{{ . }}-wrappers")
{{ end -}}
fi
{{ end -}}
```

- [ ] **Step 3: Verify the darwin render**

```bash
chezmoi execute-template < run_onchange_upgrade-packages.sh.tmpl > /tmp/sweep.rendered
bash -n /tmp/sweep.rendered && echo syntax-ok
grep -c 'update --all' /tmp/sweep.rendered
grep -c "brew upgrade pi-coding-agent" /tmp/sweep.rendered || true
```

Expected: `syntax-ok`, `2` (the echo line and the command line), `0` (formula gone from the sweep because Task 2 removed it from data).

- [ ] **Step 4: Verify pi's updater is prompt-free non-interactively (spec §7)**

Do **not** run `pi update --all` on this Mac yet — pi is still brew-installed here, and if a newer release exists the self-update would write into the Cellar (the exact corruption this design retires). The trust-prompt risk lives on the extensions path, which is install-route-independent, so test only that:

```bash
pi update --extensions </dev/null; echo "exit=$?"
```

Expected: completes without waiting for input. If it ever prompts/fails on a trust question, add `--no-approve` to the sweep's command and note it in the ADR's consequences.

- [ ] **Step 5: Commit**

```bash
git add run_onchange_upgrade-packages.sh.tmpl
git commit -m "feat(packages): weekly sweep updates pi via pi update --all (ADR-0012)"
```

---

### Task 6: One-time macOS migration script

**Files:**
- Create: `run_once_before_all-00-retire-brew-pi.sh.tmpl`

**Interfaces:**
- Produces: nothing for later tasks; guarantees the formula is gone before `all-02` installs the tier copy.

- [ ] **Step 1: Create the script** with exactly:

```
{{ if eq .osid "darwin" -}}
#!/bin/bash
# One-time migration (ADR-0012): pi moves from the pi-coding-agent formula to
# the npm tier. Uninstall the formula so a stale brew pi cannot shadow the
# tier's wrapper and brew's inventory stays truthful. node stays — it is now
# a declared formula in packages.yaml. ~/.pi (auth, settings, sessions,
# extensions) is install-route-independent and untouched.
set -euo pipefail

{{ if eq .chezmoi.arch "arm64" -}}
eval "$(/opt/homebrew/bin/brew shellenv)"
{{ else -}}
eval "$(/usr/local/bin/brew shellenv)"
{{ end -}}

if brew list --formula pi-coding-agent >/dev/null 2>&1; then
	brew uninstall pi-coding-agent
fi
{{ end -}}
```

(On Fedora this renders empty and chezmoi skips it — same pattern as the other `*.sh.tmpl` scripts.)

- [ ] **Step 2: Verify ordering — migration must run before `all-02` (spec §7)**

chezmoi orders same-phase scripts by target name (attributes stripped): `all-00-retire-brew-pi.sh` sorts before `all-01.sh`/`all-02.sh`. Confirm from the worktree source:

```bash
chezmoi apply --source . --dry-run --verbose 2>&1 | grep -n "all-0" | head
```

Expected: `all-00-retire-brew-pi` listed before `all-01`/`all-02`. (Dry-run does not execute anything.)

- [ ] **Step 3: Verify the render is valid bash**

```bash
chezmoi execute-template < run_once_before_all-00-retire-brew-pi.sh.tmpl | bash -n && echo syntax-ok
```

Expected: `syntax-ok`

- [ ] **Step 4: Commit**

```bash
git add run_once_before_all-00-retire-brew-pi.sh.tmpl
git commit -m "feat(packages): one-time retirement of the pi-coding-agent formula on macOS (ADR-0012)"
```

---

### Task 7: ADR-0012 + amendment note in ADR-0011

**Files:**
- Create: `docs/adr/0012-install-layout-determines-self-update.md`
- Modify: `docs/adr/0011-install-routes-follow-the-maintainer.md` (insert one paragraph after the opening paragraph, i.e. after the line ending `…every time a JS-based CLI shows up.`)

- [ ] **Step 1: Write ADR-0012** with exactly:

```markdown
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
```

- [ ] **Step 2: Insert the amendment note in ADR-0011**

After the opening paragraph (the one ending `…every time a JS-based CLI shows up.`), insert:

```markdown
> **Amended 2026-08-13 by [ADR-0012](0012-install-layout-determines-self-update.md).**
> The per-platform pi routes below are superseded: pi now installs from the
> npm tier on every platform and updates itself via `pi update --all` in the
> weekly sweep. The principles here still govern — ADR-0012 applies them to
> a fact this ADR only measured on the standalone binaries: whether
> `pi update` can be trusted is a property of the install layout.
```

- [ ] **Step 3: Verify links resolve**

```bash
ls docs/adr/0012-install-layout-determines-self-update.md
grep -c "0012-install-layout-determines-self-update.md" docs/adr/0011-install-routes-follow-the-maintainer.md
```

Expected: file listed; `1`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0012-install-layout-determines-self-update.md docs/adr/0011-install-routes-follow-the-maintainer.md
git commit -m "docs(adr): ADR-0012 — install layout determines self-update; amend ADR-0011"
```

---

### Task 8: `docs/package-management.md` rewrite + PR

**Files:**
- Modify: `docs/package-management.md` (replace the `## pi: brew on macOS, npm on Fedora` section)

- [ ] **Step 1: Replace the pi section** (from the `## pi: brew on macOS, npm on Fedora` heading up to but not including `## Known gap (revisit)`) with exactly:

```markdown
## pi: npm tier everywhere, self-updating

pi installs from the npm tier on **both** platforms and is updated only by
its own updater (ADR-0012, superseding ADR-0011's per-platform routes):

- **Install** (if missing): declared in `packages.yaml` under the top-level
  `npm` tier; mechanism in `.chezmoitemplates/npm-tools` +
  `npm-tier-install`, included by `run_before_all-02` on both OS branches.
  macOS pins wrappers to brew's node (`node` is a declared formula), Fedora
  to dnf's (`nodejs`/`npm` in `fedora.dnf`).
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
```

- [ ] **Step 2: Verify no stale references remain**

```bash
grep -rn "fedora.npm\|brew on macOS, npm on Fedora\|pi-coding-agent formula in" docs/package-management.md .chezmoidata/ run_*.tmpl .chezmoitemplates/ | grep -v "retire-brew-pi\|adr/"
```

Expected: no output (the migration script and ADRs are allowed to mention the formula historically).

- [ ] **Step 3: Commit, push, open PR**

```bash
git add docs/package-management.md
git commit -m "docs(packages): pi is npm-tier everywhere and self-updates (ADR-0012)"
git push -u origin pi-self-update
gh pr create --title "pi self-updates from a uniform npm-tier layout (ADR-0012)" \
  --body "Implements docs/superpowers/specs/2026-08-13-pi-self-update-design.md: npm tier goes cross-platform, brew formula retired, weekly \`pi update --all\`, refuse-to-link re-runs post-update. Amends ADR-0011."
```

---

### Task 9: Post-merge verification (this Mac now, Fedora box on its next apply)

No files — behavioural verification only, run **after** the PR merges and the mirror pulls main.

- [ ] **Step 1: Pull and apply**

```bash
git -C ~/.local/share/chezmoi pull --ff-only
chezmoi apply
```

Expected in output: `brew uninstall pi-coding-agent` (migration), then the tier installing `@earendil-works/pi-coding-agent`.

- [ ] **Step 2: Verify the new layout**

```bash
which pi                     # expect: /Users/phil/.local/bin/pi
pi --version                 # expect: current latest (>= 0.84.1)
head -4 ~/.local/bin/pi      # expect: wrapper exec'ing /opt/homebrew/bin/node
brew list --formula 2>/dev/null | grep -c '^pi-coding-agent$'   # expect: 0
ls ~/.pi                     # expect: unchanged (auth/settings/sessions/extensions)
```

- [ ] **Step 3: Round-trip the updater**

```bash
pi update --all </dev/null
```

Expected: extensions checked, pi reports up to date (or updates cleanly); no prompt, exit 0.

- [ ] **Step 4: Clean up the mirror's untracked spec/plan copies** (they arrived via the merge)

```bash
git -C ~/.local/share/chezmoi status --porcelain docs/superpowers/
```

Expected: empty. If the untracked pre-branch copies still show, they are byte-identical duplicates of the now-tracked files — remove them only if git lists them as untracked.

- [ ] **Step 5: Fedora box** — on its next `chezmoi apply` nothing migrates (its layout is already the tier's); confirm the weekly sweep runs `pi update --all` there once the gate week rolls over, and that dnf's npm accepts `--min-release-age` (npm >= 11; if the box's npm is older, pi's replayed install may warn — record what happens in the ADR's consequences if it does).
