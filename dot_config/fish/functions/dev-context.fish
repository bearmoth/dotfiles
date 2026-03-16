function dev-context
    warpctx stake-staging-easygonext
    assume development
    kubectl config use-context arn:aws:eks:eu-west-1:684266004355:cluster/staging
    kubectl config set-context --current --namespace=$argv
    set -gx AWS_PROFILE development
end
