if test -S $HOME/.1password/agent.sock
    set -x SSH_AUTH_SOCK $HOME/.1password/agent.sock
end
