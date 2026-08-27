#!/bin/bash
set -euo pipefail

if [ ! -d "$HOME/.config/cheat/cheatsheets/community" ]; then
    git clone https://github.com/cheat/cheatsheets "$HOME/.config/cheat/cheatsheets/community"
fi
