# Dotfiles

## Usage

Install [chezmoi](https://www.chezmoi.io/) and dotfiles from GitHub for the first time:

```bash
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply https://github.com/bearmoth/dotfiles.git
```

HTTPS on purpose: a fresh machine has no SSH keys yet. Switch the remote to
SSH later if you want to push (`git -C ~/.local/share/chezmoi remote set-url
origin git@github.com:bearmoth/dotfiles.git`).

Update dotfiles:

```bash
chezmoi update
```

## OS Support

- [x] macOS Sequoia [_AArch64_]
- [x] Fedora [_x86-64_]

## Templating Conventions

Templates use the `osid` variable, synthesised in `.chezmoi.yaml.tmpl` as `{os}` on macOS or `{os}-{releaseId}` on Linux. Current values: `darwin`, `linux-fedora`.

**Platform branching** (prefer these forms in templates):

```
{{- if eq .osid "darwin" }}…{{ end }}
{{- if eq .chezmoi.os "linux" }}…{{ end }}        # any Linux (future-proofed)
{{- if eq .osid "linux-fedora" }}…{{ end }}       # Fedora-specific
```

**Architecture branching** (within a platform):

```
{{- if eq .chezmoi.arch "arm64" }}…{{ end }}      # Apple Silicon
{{- if eq .chezmoi.arch "amd64" }}…{{ end }}      # x86-64
```

Run `chezmoi data` to inspect all available template variables.

## Machine Identity (`isWork`)

Some files (work AWS context functions, `assume-refresh.fish`) are only deployed on work machines. This is controlled by the `isWork` boolean in `.chezmoi.yaml.tmpl`, which is set by matching the machine's hostname against an allowlist:

```
{{- $workHostnames := list "MacBook-Pro" -}}
{{- $isWork := has .chezmoi.hostname $workHostnames -}}
```

**To add a new work machine**: add its hostname to the `list` in `.chezmoi.yaml.tmpl`, then run `chezmoi init` on that machine to re-render `~/.config/chezmoi/chezmoi.yaml`.

Check the hostname with `hostname` or `chezmoi data | grep hostname`.

## Keybindings

Full cross-OS keymap reference (Ghostty splits, AeroSpace, Linux WM, collision analysis, activation gate): [`docs/keybindings.md`](docs/keybindings.md)

Quick terminal lookup: `cheat keymaps`
