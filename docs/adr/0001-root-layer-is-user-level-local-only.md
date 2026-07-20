# Root layer is user-level via chezmoi; cloud/routine sessions are out

The engineering OS root layer (global CLAUDE.md, SessionStart hook, `knowledge-routing` / `worktree-provisioning` / `registry-maintenance` skills) is distributed exclusively user-level through chezmoi's `dot_claude/`. Cloud, Cowork, and routine sessions read none of user-level config — and they also lack the substrate the OS runs on (machine mounts, vault paths, worktree roots are per-machine facts) — so shipping the skills there would deliver instructions with nothing to act on. The OS is deliberately a **local-machine capability**; cloud sessions stay vanilla. (Wayfinder ticket [#10](https://github.com/bearmoth/dotfiles/issues/10).)

## Considered options

- **Also ship as a Claude Code plugin** — would have made the skills loadable in cloud sessions via per-repo `enabledPlugins` declarations. Accepting this meant building and maintaining marketplace/plugin machinery, declaring the plugin in every repo's settings, and still having no registry, mounts, or vault paths in the cloud environment — skills that load but cannot route. Rejected as machinery without substrate.
- **Also commit skills into each repo's `.claude/skills/`** — would have worked for cloud sessions repo-by-repo. Accepting this meant N synchronized copies of the skills sprayed across every owned repo, drift between them, and inverting the chezmoi single-source-of-truth premise the whole dotfiles setup is built on. Rejected as distribution by shotgun.

## Consequences

- Any future "routing from a cloud routine" need reopens this decision; it is recorded in the wayfinder map's fog (Not yet specified), not silently impossible.
- The pilot (easygo work machine, local sessions) is unaffected — it never touches the excluded environments.
