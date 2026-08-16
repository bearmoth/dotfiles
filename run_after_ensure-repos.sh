#!/bin/bash
set -euo pipefail

# Ensure standing repos are checked out at their conventional paths —
# clone-if-absent only, never pull on a live clone. Generalises the original
# Journal-only script ("chezmoi apply = repos checked out", dotfiles #21).
# Plain run_ (not run_onchange) so a missing clone is restored on every
# apply, not only when this script's content changes.
#
# A repo that ships a .githooks dir gets core.hooksPath wired on clone and
# self-healed on every apply (Journal's pre-push gate relies on this).

ANOMALY=0

ensure_repo() {
  local repo="$1" dest="$2"

  if [ -d "$dest/.git" ]; then
    if [ -d "$dest/.githooks" ]; then
      git -C "$dest" config core.hooksPath .githooks
    fi
    return 0
  fi

  if [ -e "$dest" ]; then
    echo "ERROR: $dest exists but is not a git repo — refusing to touch it." >&2
    ANOMALY=1
    return 0
  fi

  echo "Cloning $repo to $dest ..."
  mkdir -p "$(dirname "$dest")"
  if git clone "$repo" "$dest"; then
    if [ -d "$dest/.githooks" ]; then
      git -C "$dest" config core.hooksPath .githooks
    fi
  else
    echo "WARNING: could not clone $repo (SSH auth not set up yet?) — $dest is missing on this machine." >&2
  fi
}

command -v git >/dev/null 2>&1 || {
  echo "WARNING: git not found — cannot ensure repo checkouts." >&2
  exit 0
}

# Vaults (registry: .chezmoidata/contexts.yaml). Paths are the convention's
# defaults — machine mounts in data.eos should agree with them.
ensure_repo git@github.com:bearmoth/notes-journal.git "$HOME/Documents/Journal"
ensure_repo git@github.com:bearmoth/notes-tech.git "$HOME/Documents/Tech Notes"

# Reference-only repos, canonical clone layout: <clone-root>/<owner>/<repo>.
ensure_repo git@github.com:bearmoth/symbiosis.git "$HOME/Dev/bearmoth/symbiosis"

exit "$ANOMALY"
