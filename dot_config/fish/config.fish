if status is-interactive
    if type -q brew
        alias assume="source (brew --prefix)/bin/assume.fish"
    end
end
