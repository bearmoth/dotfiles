if status is-interactive
    if type -q brew
        alias assume="source (brew --prefix)/bin/assume.fish"
    end
end

# OrbStack: command-line tools and integration
source ~/.orbstack/shell/init2.fish 2>/dev/null || :
