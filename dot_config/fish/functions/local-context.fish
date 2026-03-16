function local-context
    warpctx stake-staging-easygonext
    assume development
    kubectl config use-context docker-desktop
    kubectl config set-context --current --namespace=backend
    set -gx AWS_
end
