# Obsidian CLI (Flatpak)

## Why there's a wrapper

Obsidian on the Fedora machine is a Flatpak, installed by hand — deliberately
outside chezmoi's remit, like the other Flatpaks. It ships an `obsidian-cli`
binary inside the app tree but exports only the GUI entry point
(`md.obsidian.Obsidian`), so nothing named `obsidian` ever lands on `PATH`.
Both the `obsidian-cli` skill and the `kepano/obsidian-skills` plugin shell out
to a bare `obsidian`, so that name is what has to exist.

Getting it on `PATH` is the easy half. The CLI talks to the running Obsidian
over a unix socket at `$XDG_RUNTIME_DIR/.obsidian-cli.sock`, and under Flatpak
the app gets a **private** `XDG_RUNTIME_DIR`. A host-side process looking in the
plain `/run/user/$UID` finds nothing and reports:

> The CLI is unable to find Obsidian. Please make sure Obsidian is running and
> try again.

which is a lie — Obsidian is running, the socket exists, it's just at
`/run/user/$UID/.flatpak/md.obsidian.Obsidian/xdg-run/.obsidian-cli.sock`.
The binary reads no config file and takes no flag for this, so pointing
`XDG_RUNTIME_DIR` at that directory is the only available fix, and a wrapper is
the only place to do it. That's `dot_local/bin/executable_obsidian`.

`flatpak run --command=/app/obsidian-cli md.obsidian.Obsidian` also works, but
spins up a fresh sandbox per invocation — seconds of startup, plus a translated
filesystem view. Running the binary directly on the host is instant and sees
real host paths.

## Why it's gated by detection, not a feature toggle

`.chezmoiignore` excludes the wrapper unless a Flatpak Obsidian install actually
exists (checking both the system and user Flatpak roots). This is
self-detecting: the work machine never receives the file, with no per-machine
config to remember. That differs from the `features.aerospace` opt-in idiom used
elsewhere in this repo, and the difference is deliberate — aerospace is a
*preference* (you might not want it even on a supported machine), whereas this
wrapper is *inert or harmful* exactly when its precondition is absent. There's
nothing to choose, so there's nothing to toggle.

## The trap: enabling the CLI setting breaks the CLI

The wrapper needs Settings > General > Advanced > "Command line interface"
enabled, because that's what makes Obsidian open the socket at all.

Toggling it on **also makes Obsidian install its own stock `obsidian-cli`
binary to `~/.local/bin/obsidian`** — the exact path the wrapper occupies. The
wrapper is silently overwritten, the stock binary can't find the private socket,
and you're back to "unable to find Obsidian". The setting that looks like the
fix is the regression.

Recover with:

```sh
chezmoi apply --force ~/.local/bin/obsidian
```

`--force` is required: a plain `chezmoi apply` reads the clobbered binary as
local edits worth keeping and stops to prompt. `chezmoi status
~/.local/bin/obsidian` reports `MM` when this has happened.

This will recur on any future re-toggle, and possibly on Obsidian updates.
Accepted as a known, detectable, one-command-repairable drift rather than
building machinery around it — the alternatives were a systemd user unit
symlinking the socket into the plain runtime dir (removes the conflict entirely,
but adds a daemon and start-ordering against Obsidian) or moving the wrapper to
a separate `PATH` directory ahead of `~/.local/bin` (requires a shell config
change). Revisit if the clobber turns out to happen often.

## Usage note

Call the CLI with **named arguments**: `obsidian read file=<path>`,
`obsidian search query=<text> limit=<n>`. Positional arguments are not merely
rejected — `obsidian read <path>` returns a *different note entirely*, with exit
0 and no warning. `search` at least fails loudly, and `backlinks` does accept a
bare path, so the convention isn't uniform across subcommands. Named args are
the only form that's safe everywhere.
