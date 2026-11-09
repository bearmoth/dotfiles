#!/bin/sh
# PROTOTYPE — throwaway (dotfiles#74). The editor pane's command for variant 1.
# Shape verified in the nvim-server-modes research (e15): probe, spawn detached, wait, attach.
#   pane-remote-ui.sh <socket> <folder>
S="$1"; FOLDER="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
PEP="$(dirname "$S")"
if ! nvim --server "$S" --remote-expr 1 >/dev/null 2>&1; then
  # fork + setsid: survives the pane's SIGHUP (`&` and nohup both died in testing).
  # A live socket makes a racing second spawn fail with EADDRINUSE, so this is safe to repeat.
  ( cd "$FOLDER" && env XDG_STATE_HOME="$PEP/state" XDG_CACHE_HOME="$PEP/cache" \
      perl -MPOSIX -e 'fork and exit; setsid; exec @ARGV' \
      nvim --headless --listen "$S" -c "luafile $HERE/server.lua" \
      >>"$PEP/server-$(basename "$S" .sock).log" 2>&1 )
  i=0; until [ -S "$S" ] || [ $i -ge 50 ]; do sleep 0.1; i=$((i+1)); done
fi
exec nvim --remote-ui --server "$S"
