#!/bin/bash
set -euo pipefail

# Ensure the Journal vault (bearmoth/notes-journal) is checked out at
# ~/Documents/Journal — clone-if-absent only, never pull on a live vault clone.
# First concrete instance of "chezmoi apply = repos checked out" (dotfiles #21).
# Plain run_ (not run_onchange) so a missing clone is restored on every apply,
# not only when this script's content changes.

VAULT="$HOME/Documents/Journal"
REPO="git@github.com:bearmoth/notes-journal.git"

if [ -d "$VAULT/.git" ]; then
  # Already checked out — self-heal the committed pre-push hook wiring only.
  git -C "$VAULT" config core.hooksPath .githooks
  exit 0
fi

if [ -e "$VAULT" ]; then
  echo "ERROR: $VAULT exists but is not a git repo — refusing to touch it." >&2
  exit 1
fi

command -v git >/dev/null 2>&1 || {
  echo "WARNING: git not found — cannot clone Journal vault." >&2
  exit 0
}

echo "Cloning Journal vault to $VAULT ..."
if git clone "$REPO" "$VAULT"; then
  git -C "$VAULT" config core.hooksPath .githooks
else
  echo "WARNING: could not clone $REPO (SSH auth not set up yet?) — Journal vault is missing on this machine." >&2
fi
