# Interactive zsh behaviour that oh-my-zsh used to provide. OMZ was retired
# because it loaded no plugins here — its only jobs were sourcing the
# powerlevel10k theme and setting these defaults, which did not justify a 12M
# tarball refreshed weekly from an unpinned master.
#
# Values match what OMZ had in effect, captured from a live shell before the
# removal, so an existing shell keeps behaving identically. HISTFILE is the
# load-bearing one: leave it unset and zsh keeps history for the session only,
# silently stopping writes to the existing ~/.zsh_history.

## History
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=10000

setopt extended_history       # record timestamp and duration
setopt hist_expire_dups_first # trim duplicates first when HISTSIZE is hit
setopt hist_ignore_dups       # don't record a command identical to the last
setopt hist_ignore_space      # a leading space keeps a command out of history
setopt hist_verify            # expand !! to the line for review, don't run it
setopt share_history          # share history between concurrent shells

## Misc interactive niceties
setopt auto_cd                # `foo` cds into ./foo
setopt complete_in_word       # complete from the cursor, not just line end
setopt interactive_comments   # allow # comments when typing interactively

## Completion
# OMZ ran compinit for us; without it tab completion falls back to bare zsh.
# Cache in XDG_CACHE_HOME (set in 00-env) so it isn't dropped in $HOME.
autoload -Uz compinit
compinit -d "${XDG_CACHE_HOME:-$HOME/.cache}/zcompdump-${ZSH_VERSION}"

## Keymap
bindkey -e                    # emacs bindings, as OMZ defaulted to
