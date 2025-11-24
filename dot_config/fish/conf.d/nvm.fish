set --query nvm_mirror; or set --global nvm_mirror https://nodejs.org/dist
set --query XDG_DATA_HOME; or set --local XDG_DATA_HOME ~/.local/share
set --global nvm_data $XDG_DATA_HOME/nvm

function _nvm_install --on-event nvm_install
    test ! -d $nvm_data; and command mkdir -p $nvm_data
    echo "Downloading the Node distribution index..." 2>/dev/null
    _nvm_index_update
end

function _nvm_update --on-event nvm_update
    set --query nvm_mirror; or set --global nvm_mirror https://nodejs.org/dist
    set --query XDG_DATA_HOME; or set --local XDG_DATA_HOME ~/.local/share
    set --global nvm_data $XDG_DATA_HOME/nvm
end

function _nvm_uninstall --on-event nvm_uninstall
    command rm -rf $nvm_data
    set --query nvm_current_version; and _nvm_version_deactivate $nvm_current_version
    set --names | string replace --filter --regex -- "^nvm" "set --erase nvm" | source
    functions --erase (functions --all | string match --entire --regex -- "^_nvm_")
end

if status is-interactive; and set --query nvm_default_version; and not set --query nvm_current_version
    nvm use --silent $nvm_default_version
end
