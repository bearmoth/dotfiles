#!/bin/bash

# Install uv (Rust binary to install Python apps... what a world we live in)
curl -LsSf https://astral.sh/uv/install.sh | sh
source $HOME/.local/bin/env

# Install Posting (and Python, if needed)
uv tool install --python 3.12 posting
