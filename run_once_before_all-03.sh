#!/bin/bash

if ! command -v brew &>/dev/null; then
  echo "Installing Nix..."
  curl -fsSL https://install.determinate.systems/nix | sh -s -- install --determinate
else
  echo "Nix already installed"
fi
