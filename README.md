# Dotfiles

## Usage

Install [chezmoi](https://www.chezmoi.io/) and dotfiles from GitHub for the first time:

```bash
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply git@github.com:bearmoth/dotfiles.git
```

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
