#!/bin/bash
FISH_PATH=$(command -v fish)
if [ -n "$FISH_PATH" ]; then
  echo "Installing fish shell as default shell..."
  if ! grep -Fxq "$FISH_PATH" /etc/shells; then
    echo "$FISH_PATH" | sudo tee -a /etc/shells > /dev/null
  fi
  chsh -s "$FISH_PATH"
else
  echo "fish shell not found in PATH."
  exit 1
fi
