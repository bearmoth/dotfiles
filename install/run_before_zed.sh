#!/bin/bash

if ! command -v zed &>/dev/null; then
  echo "Installing Zed..."
  curl -f https://zed.dev/install.sh | sh
else
  echo "Zed already installed"
fi
