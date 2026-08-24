# git -c gets no exemption from the write-fence bash classifier

The write-fence classifier scans `git` commands for `-C`/`--git-dir`/`--work-tree`
targets outside the fence. It would be tempting to treat `-c key=value` as inert
configuration and skip it — but git config is a command-execution vector
(`core.fsmonitor`, `core.pager`, `core.sshCommand`, aliases can all run arbitrary
programs), so a `-c`-carrying command must be scanned like any other and refused
when it cannot be proven safe. Do not "simplify" the classifier by exempting `-c`;
the asymmetry with the read-only classifier is deliberate.
