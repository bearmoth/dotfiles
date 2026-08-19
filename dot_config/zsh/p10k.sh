# Powerlevel10k, loaded directly. Previously oh-my-zsh was installed solely to
# act as the theme loader (the theme lived in .oh-my-zsh/custom/themes/); the
# theme now installs to $XDG_DATA_HOME via .chezmoiexternal.yaml and is sourced
# here. Prompt configuration itself stays in ~/.p10k.zsh (`p10k configure`).

# Enable Powerlevel10k instant prompt. Should stay close to the top of ~/.zshrc.
# Initialization code that may require console input (password prompts, [y/n]
# confirmations, etc.) must go above this block; everything else may go below.
if [[ -r "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh" ]]; then
  source "${XDG_CACHE_HOME:-$HOME/.cache}/p10k-instant-prompt-${(%):-%n}.zsh"
fi

P10K_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/powerlevel10k"
[[ ! -r "$P10K_DIR/powerlevel10k.zsh-theme" ]] || source "$P10K_DIR/powerlevel10k.zsh-theme"
unset P10K_DIR

[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh
