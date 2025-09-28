# Credit: https://github.com/ohmyzsh/ohmyzsh/tree/master/plugins/git

abbr gst 'git status' # git status
abbr grt 'cd (git rev-parse --show-toplevel; or echo .)' # cd git repo top

abbr g git

# git add
abbr ga 'git add'
abbr gaa 'git add --all'
abbr gapa 'git add --patch' # interactively select portions of changes to stage
abbr gau 'git add --update' # only add updates to already staged files
abbr gav 'git add --verbose'
abbr gwip 'git add -A; git rm (git ls-files --deleted ^/dev/null); git commit --no-verify --no-gpg-sign --message "--wip-- [skip ci]"' # commit everything as a throwaway WIP commit

# git apply
abbr gap 'git apply' # apply a patch
abbr gapt 'git apply --3way' # apply a 3 way merge

# git bisect
abbr gbs 'git bisect' # start a bisect session
abbr gbsb 'git bisect bad' # mark current commit as bad
abbr gbsg 'git bisect good' # mark current commit as good
abbr gbsn 'git bisect new' # mark commit as new (alias for bad in some versions)
abbr gbso 'git bisect old' # mark commit as old (alias for good in some versions)
abbr gbsr 'git bisect reset' # end bisect session and reset state
abbr gbss 'git bisect start' # begin a new bisect session

# git branch
abbr gb 'git branch' # list all branches
abbr gba 'git branch --all' # list all branches (local + remote)
abbr gbd 'git branch --delete' # delete branch
abbr gbD 'git branch --delete --force' # force delete branch
abbr gbgd 'LANG=C git branch --no-color -vv | grep ": gone\]" | cut -c 3- | awk "{print \$1}" | xargs git branch -d' # cleanup local branches whose upstream is missing
abbr gbgD 'LANG=C git branch --no-color -vv | grep ": gone\]" | cut -c 3- | awk "{print \$1}" | xargs git branch -D' # force-delete all local branches whose remote tracking branch no longer exists
abbr gbm 'git branch --move'
abbr gbnm 'git branch --no-merged'
abbr gbr 'git branch --remote'
abbr ggsup 'git branch --set-upstream-to=origin/(git branch --show-current)'
abbr gbg 'LANG=C git branch -vv | grep ": gone\]"'
abbr gco 'git checkout'
abbr gcor 'git checkout --recurse-submodules'
abbr gcb 'git checkout -b'
abbr gcB 'git checkout -B'

# git cherry-pick
abbr gcp 'git cherry-pick'
abbr gcpa 'git cherry-pick --abort'
abbr gcpc 'git cherry-pick --continue'

# git clone
abbr gcl 'git clone --recurse-submodules'
abbr gclf 'git clone --recursive --shallow-submodules --filter=blob:none --also-filter-submodules'
# abbr gccd 'git clone --recurse-submodules "$@" && cd "$(basename $\_ .git)"'

# git commit
abbr gcam 'git commit --all --message'
abbr gcas 'git commit --all --signoff'
abbr gcasm 'git commit --all --signoff --message'
abbr gcmsg 'git commit --message'
abbr gcsm 'git commit --signoff --message'
abbr gc 'git commit --verbose'
abbr gca 'git commit --verbose --all'
abbr gca! 'git commit --verbose --all --amend'
abbr gcan! 'git commit --verbose --all --no-edit --amend'
abbr gcans! 'git commit --verbose --all --signoff --no-edit --amend'
abbr gcann! 'git commit --verbose --all --date=now --no-edit --amend'
abbr gc! 'git commit --verbose --amend'
abbr gcn 'git commit --verbose --no-edit'
abbr gcn! 'git commit --verbose --no-edit --amend'
abbr gcs 'git commit -S'
abbr gcss 'git commit -S -s'
abbr gcssm 'git commit -S -s -m'
abbr gcf 'git config --list'
abbr gcfu 'git commit --fixup'

# git diff
abbr gd 'git diff'
abbr gdca 'git diff --cached'
abbr gdcw 'git diff --cached --word-diff'
abbr gds 'git diff --staged'
abbr gdw 'git diff --word-diff'
abbr gdv 'git diff -w "$@" | view -'
abbr gdup 'git diff @{upstream}'
abbr gdnolock 'git diff $@ ":(exclude)package-lock.json" ":(exclude)\*.lock"'
abbr gdt 'git diff-tree --no-commit-id --name-only -r'

# git fetch
abbr gf 'git fetch'
abbr gfa 'git fetch --all --tags --prune'
abbr gfo 'git fetch origin'

#git log
abbr glgg 'git log --graph'
abbr glgga 'git log --graph --decorate --all'
abbr glgm 'git log --graph --max-count=10'
abbr glod 'git log --graph --pretty=\'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset\''
abbr glods 'git log --graph --pretty=\'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ad) %C(bold blue)<%an>%Creset\' --date=short'
abbr glol 'git log --graph --pretty=\'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset\''
abbr glola 'git log --graph --pretty=\'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset\' --all'
abbr glols 'git log --graph --pretty=\'%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset\' --stat'
abbr glo 'git log --oneline --decorate'
abbr glog 'git log --oneline --decorate --graph'
abbr gloga 'git log --oneline --decorate --graph --all'
abbr glp 'git log --pretty=<format>'
abbr glg 'git log --stat'
abbr glgp 'git log --stat --patch'

# git ls-files
abbr gignored 'git ls-files -v | grep "^[[:lower:]]"'
abbr gfg 'git ls-files | grep'

# git merge
abbr gm 'git merge'
abbr gma 'git merge --abort'
abbr gmc 'git merge --continue'
abbr gms 'git merge --squash'
abbr gmff 'git merge --ff-only'
#abbr gmom 'git merge origin/$(git_main_branch)'
#abbr gmum 'git merge upstream/$(git_main_branch)'
abbr gmtl 'git mergetool --no-prompt'
abbr gmtlvim 'git mergetool --no-prompt --tool=vimdiff'

# git pull
abbr gl 'git pull'
abbr gpr 'git pull --rebase'
abbr gprv 'git pull --rebase -v'
abbr gpra 'git pull --rebase --autostash'
abbr gprav 'git pull --rebase --autostash -v'
# abbr gprom 'git pull --rebase origin $(git_main_branch)'
# abbr gpromi 'git pull --rebase=interactive origin $(git_main_branch)'
# abbr gprum 'git pull --rebase upstream $(git_main_branch)'
# abbr gprumi 'git pull --rebase=interactive upstream $(git_main_branch)'
# abbr ggpull 'git pull origin "$(git_current_branch)"'
# abbr ggl 'git pull origin $(current_branch)'
# abbr gluc 'git pull upstream $(git_current_branch)'
# abbr glum 'git pull upstream $(git_main_branch)'

# git push
abbr gp 'git push'
abbr gpd 'git push --dry-run'
abbr gpf! 'git push --force'
# abbr ggf 'git push --force origin $(current_branch)'
abbr gpf 'git push --force-with-lease --force-if-includes'
# abbr ggfl 'git push --force-with-lease origin $(current_branch)'
# abbr gpsup 'git push --set-upstream origin $(git_current_branch)'
# abbr gpsupf 'git push --set-upstream origin $(git_current_branch) --force-with-lease --force-if-includes'
abbr gpv 'git push --verbose'
abbr gpoat 'git push origin --all && git push origin --tags'
abbr gpod 'git push origin --delete'
# abbr ggpush 'git push origin "$(git_current_branch)"'
# abbr ggp 'git push origin $(current_branch)'
abbr gpu 'git push upstream'

# git rebase
abbr grb 'git rebase'
abbr grba 'git rebase --abort'
abbr grbc 'git rebase --continue'
abbr grbi 'git rebase --interactive'
abbr grbo 'git rebase --onto'
abbr grbs 'git rebase --skip'
# abbr grbd 'git rebase $(git_develop_branch)'
# abbr grbm 'git rebase $(git_main_branch)'
# abbr grbom 'git rebase origin/$(git_main_branch)'
# abbr grbum 'git rebase upstream/$(git_main_branch)'

# git remote

# misc
abbr gbl 'git blame -w' # show blame, ignoring whitespace
abbr gclean 'git clean --intractive -d'
abbr gdct 'git describe --tags $(git rev-list --tags --max-count=1)'
abbr ghh 'git help'
abbr grf 'git reflog'
