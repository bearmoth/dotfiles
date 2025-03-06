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
- [ ] Arch (desktop) [_x86-64_] (WIP)
- [ ] Ubuntu (minimal) [_x86-64_] (Coming... at some point?)
