function stake-context
    warpctx stake-staging-easygonext
    assume Mediumrare/StakeEngineerEngagementRole
    kubectl config use-context arn:aws:eks:eu-west-1:526131802871:cluster/stake
    kubectl config set-context --current --namespace=backend
    set -gx AWS_PROFILE stake
end
