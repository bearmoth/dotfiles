#!/bin/sh
# PROTOTYPE — throwaway (dotfiles#74). Never merged; lives on prototype/dotfiles-74-editor-pane.
#
# How should the (A) editor pane show the space's nvim? Opens each variant in its own scratch
# herdr-app space so they can be compared side by side with real LazyVim.
#
#   proto.sh up 1 [folder]   variant 1: headless server per space + `nvim --remote-ui` pane
#   proto.sh up 2 [folder]   variant 2: plain `nvim --listen <sock>` as the pane command
#   proto.sh up 3            variant 3: the 2026-11-08 bridge spike (mod-drawn panes)
#   proto.sh reopen 1|2      add a new tab to the variant's space running the same pane command
#                            (close the editor pane first: does it come back with the same buffers?)
#   proto.sh peek 1|2        ask the variant's nvim what it sees (UIs, background, cwd, buffers)
#   proto.sh down 1|2|3|all  quit the server through its socket, close the scratch space
#
# Isolation (standing constraint: don't degrade the current setup):
#   - real LazyVim config + plugins (XDG_CONFIG_HOME, XDG_DATA_HOME untouched);
#   - XDG_STATE_HOME / XDG_CACHE_HOME redirected under $PEP so shada, sessions, swap and
#     undo of the long-lived servers never touch the real ones;
#   - nothing written to ~/.config/nvim or ~/.config/herdr-app.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
PEP="${TMPDIR:-/tmp/}pep"             # short: socket paths must stay under 104 bytes
mkdir -p "$PEP" && chmod 700 "$PEP"

space_name() { echo "proto-editor-v$1"; }
sock() { echo "$PEP/v$1.sock"; }

space_id() { # by name; empty if none
  herdr-app ls | python3 -I -c '
import json,sys
n=sys.argv[1]
for s in json.load(sys.stdin)["spaces"]:
    if s["name"]==n: print(s["id"]); break' "$(space_name "$1")"
}

pane_argv() { # JSON argv for the editor pane of variant $1 in folder $2
  case "$1" in
    1) printf '["sh","%s/pane-remote-ui.sh","%s","%s"]' "$HERE" "$(sock 1)" "$2" ;;
    2) printf '["env","XDG_STATE_HOME=%s/state","XDG_CACHE_HOME=%s/cache","nvim","--listen","%s","-c","luafile %s/server.lua"]' \
         "$PEP" "$PEP" "$(sock 2)" "$HERE" ;;
  esac
}

up() {
  v="$1"; folder="${2:-$(cd "$HERE/../.." && pwd)}"
  [ -n "$(space_id "$v")" ] && { echo "space $(space_name "$v") already open"; exit 1; }
  case "$v" in
    1|2)
      herdr-app do space.new "{\"name\":\"$(space_name "$v")\",\"folder\":\"$folder\",\"tab\":\"editor\",\"argv\":$(pane_argv "$v" "$folder")}"
      echo "socket: $(sock "$v")" ;;
    3)
      spike="$HOME/.local/share/herdr-experiment/spike"
      sh "$spike/start.sh"
      herdr-app do space.new "{\"name\":\"$(space_name 3)\",\"folder\":\"$spike\",\"tab\":\"editor\"}"
      sleep 1
      herdr-app do tab.new "{\"space\":\"$(space_id 3)\",\"name\":\"nvim\",\"mod\":\"nvim-spike-view\",\"props\":{\"slot\":0}}"
      echo "spike: bridge on 127.0.0.1:47011, nvim on :47010" ;;
    *) echo "variant must be 1, 2 or 3"; exit 2 ;;
  esac
}

reopen() {
  v="$1"; id="$(space_id "$v")"; [ -n "$id" ] || { echo "no space for v$v"; exit 1; }
  folder="$(cd "$HERE/../.." && pwd)"
  herdr-app do tab.new "{\"space\":\"$id\",\"name\":\"editor-again\",\"folder\":\"$folder\",\"argv\":$(pane_argv "$v" "$folder")}"
}

peek() {
  s="$(sock "$1")"
  nvim --server "$s" --remote-expr 'luaeval("vim.inspect({uis=vim.tbl_map(function(u) return {chan=u.chan,w=u.width,h=u.height,term=u.term_name,tty=u.stdout_tty} end, vim.api.nvim_list_uis()), bg=vim.o.background, tgc=vim.o.termguicolors, cwd=vim.fn.getcwd(), pid=vim.fn.getpid(), bufs=vim.tbl_map(function(b) return vim.fn.bufname(b) end, vim.tbl_filter(function(b) return vim.bo[b].buflisted end, vim.api.nvim_list_bufs())), termfeatures=vim.g.termfeatures, focus_events=vim.g.pep_focus})")' \
    || echo "no server on $s"
}

down_one() {
  v="$1"; s="$(sock "$v")"
  if [ "$v" = 3 ]; then
    sh "$HOME/.local/share/herdr-experiment/spike/stop.sh" || true
  elif [ -S "$s" ]; then
    nvim --server "$s" --remote-send '<C-\><C-N>:qa!<CR>' 2>/dev/null || true
    i=0; while [ -S "$s" ] && [ $i -lt 30 ]; do sleep 0.1; i=$((i+1)); done
    [ -S "$s" ] && { pkill -f -- "--listen $s" || true; rm -f "$s"; }
  fi
  id="$(space_id "$v")"
  [ -n "$id" ] && herdr-app do space.close "{\"id\":\"$id\",\"confirmed\":true}" || true
}

case "${1:-}" in
  up) up "${2:?variant}" "${3:-}" ;;
  reopen) reopen "${2:?variant}" ;;
  peek) peek "${2:?variant}" ;;
  down) if [ "${2:?variant}" = all ]; then for v in 1 2 3; do down_one $v; done; else down_one "$2"; fi ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
