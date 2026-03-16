function dk-prod-context
    warpctx stake-preprod-denmark

    assume stake-denmark-pre-prod/StakeEngineerEngagementRole
    kubectx stake-production-denmark
    # kubens unfortunately doesn't allow you to see all services - but you can press `0` in k9s to see all
end
