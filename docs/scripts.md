# Run scripts: layout and layer bands

All chezmoi run scripts live in `.chezmoiscripts/` (a chezmoi-special
directory: scripts there execute but create no target directory). Cohesion is
by **naming band**, not by consolidating loosely-related work into one file —
each concern keeps its own script.

## Bands

Chezmoi orders same-phase scripts alphabetically by target name, so the
numeric prefix doubles as execution order within a phase.

| Band | Meaning | Cadence |
|---|---|---|
| `00-migrate-*` | One-time transitions out of a state a *previous version of this repo* created (e.g. retiring a brew formula that shadowed the install-script chezmoi). Not a layer — a fresh machine never needs them. | `run_once_`, deletable once fleet-applied |
| `10-system-*` | Package repos, taps, package-manager bootstrap (Homebrew install, dnf/copr/terra repos). | `run_onchange_before_` — re-runs when data/templates change |
| `20-install-*` | Installing apps and tools (brew bundle, dnf install, npm tier, curl-installed one-offs, gh extensions). | `run_onchange_before_` or `run_once_` per script |
| `30-upgrade-*` | Scheduled upgrades of managed packages. Week-stamped (`{{ now.Year }}-W{{ div now.YearDay 7 }}` in a comment) so `run_onchange_` fires at most weekly. See `docs/package-management.md`. | weekly |
| `40-hook-*` | Config-sync side effects: reload daemons on config change, rebuild caches, post-apply cleanup, ensure-repos. The layer that runs most often — keep these cheap. | `run_onchange_after_` / `run_once_after_` / `run_after_` per need |

## Rules of thumb

- **Renames and moves are free** for `run_once_` scripts: chezmoi keys their
  state by the SHA256 of the *rendered contents*, not the name. Any content
  edit re-runs them, so keep them idempotent. `run_onchange_` state is keyed
  by name, so a rename fires the script once — also fine if idempotent.
- **Migrations age out.** Once every machine in the fleet has applied a
  `00-migrate-*` script (check with
  `chezmoi state dump | grep -i <name>`), delete it.
- **Branching axes**: branch on `.osid` for OS concerns (brew vs dnf), on
  `.machine.id` / `.isWork` for machine concerns (work vs personal repos).
  `isWork` is derived from the declared machine id in `.chezmoi.yaml.tmpl` —
  one central mapping, never hostname. Prefer flat, imperative guards over
  nested template conditionals. A profile abstraction (e.g. `work-macos`) is
  deliberately deferred until two machines need identical flavour.
- **Upgrades stay out of layer 4.** Anything slow or non-deterministic
  belongs in `30-upgrade-*` behind the week stamp (or, someday, an explicit
  upgrade command / timer — see the known gap in
  `docs/package-management.md`), so that a routine `chezmoi apply` stays
  fast.
