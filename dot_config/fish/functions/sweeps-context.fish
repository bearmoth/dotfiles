function sweeps-context
    warpctx stake-staging-easygonext
    assume stake-sweeps/SweepsEngineerEngagementRole
    kubectl config use-context arn:aws:eks:ca-central-1:488586442399:cluster/sweeps
    kubectl config set-context --current --namespace=backend
    set -gx AWS_PROFILE sweeps
end
