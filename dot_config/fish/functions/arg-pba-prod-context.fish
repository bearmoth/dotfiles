function arg-pba-prod-context
    warpctx stake-prod-argpba

    assume stake-arg-pba/StakeEngineerEngagementRole
    kubectx stake-production-arg-pba
    # kubens unfortunately doesn't allow you to see all services - but you can press `0` in k9s to see all
end
