#!/bin/bash
FISH_PATH=$(command -v fish)
if [ -n "$FISH_PATH" ]; then
  sudo chsh -s "$FISH_PATH"
else
  echo "fish shell not found in PATH."
  exit 1
fi
