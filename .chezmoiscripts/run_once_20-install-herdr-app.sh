#!/bin/bash
set -euo pipefail

# Herdr desktop app (distinct from the herdr TUI in run_once_20-install-herdr).
# Upstream's installer covers macOS (~/Applications/Herdr.app) and Linux
# (~/.local/share/herdr-app + launcher entry), linking ~/.local/bin/herdr-app,
# and installs herdr-core (`hc`) if missing. The app updates itself and
# herdr-core after that (ADR-0012), so this only runs when it's absent.
# Not the brew cask: it lands in /Applications and its zap trashes
# ~/.config/herdr-app, where our mods live.

[ -e "$HOME/.local/bin/herdr-app" ] && exit 0
command -v herdr-app >/dev/null && exit 0

echo "Installing Herdr app..."
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
