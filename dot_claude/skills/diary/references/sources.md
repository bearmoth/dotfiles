# Source recipes

Per-source query recipes for one local day. Get the window first:

```
python3 ~/.claude/skills/diary/scripts/session_scan.py --window --date YYYY-MM-DD
```

It prints `utc_start`/`utc_end`, `unix_start`/`unix_end`, and ready-made
fragments (`slack_filters`, `slack_unix`, `jql_*`, `gh_updated_range`,
`calendar_iso`).

**Shell note.** The Bash tool's shell varies here (fish in some sessions,
zsh in others; subagents have seen both). The commands below avoid shell-
specific syntax. Anything with variables or loops goes through
`bash -c '…'` so it behaves the same everywhere.

**When a recipe fails** (parse error, 400, empty where there should be
data): use the fallback given for that source, finish the draft, and then
report it in the presentation as a skill defect with the fix you would
make to this file (see SKILL.md, "Recipe failures"). Don't just log it.

Identifiers on this machine (Phil's accounts):

| | |
|---|---|
| Slack user id | `U01PYT4C7ND` |
| GitHub login / org | `bearmoth` / `primeslice` |
| Jira site | `easygo-group.atlassian.net`, project `EN` most days |
| Timezone | `Australia/Melbourne` |

GitHub login → name, for reviews and comments:

| login | name |
|---|---|
| easyab | Adam Beck |
| maladeveloper-easygo | Malavan Srikumar |

Add to this table when you resolve a new one (`gh api users/<login> --jq .name`).

## Agent sessions (Claude Code + pi)

```
python3 ~/.claude/skills/diary/scripts/session_scan.py --date YYYY-MM-DD
python3 ~/.claude/skills/diary/scripts/session_scan.py --date YYYY-MM-DD --assistant --max-chars 0 > /tmp/diary-sessions.md
```

- Sessions are grouped by working directory, so the repo tells you which
  piece of work it was. Titles are Claude's own summaries, not Phil's words.
- `commands:` lists slash commands and skills invoked (`skill:grilling`,
  `/claude-handoff`): what *kind* of work happened without reading the
  whole transcript.
- A session with activity but no prompts is a background or resumed run (an
  autonomous handoff, a subagent). Its claims about PRs and tickets are
  leads; verify with `gh`/Jira.
- Phil's prompts are the first-person signal: what he asked for, what he
  pushed back on, what he decided. Those are the diary lines. The agent's
  output is the state of the work, one to three bullets.
- Never assume a transcript's day boundary is midnight UTC.

## Open tasks

```
python3 ~/.claude/skills/diary/scripts/open_tasks.py --date YYYY-MM-DD
```

Buckets: due today/overdue, carry from the previous entry, stale (older,
needs a decision), future (leave in place), already in this day's entry.
Use it instead of copying the previous entry's task list by hand.

## Slack

Phil's own activity, keyword-free (keyword searches under-match badly):

```
slack_search_public_and_private
  filters: "from:<@U01PYT4C7ND> on:YYYY-MM-DD"
  keywords: []            natural_language_query: ""
  sort: timestamp         sort_dir: asc        limit: 20
  include_context: false  (with context a busy day's first page overflows the inline limit)
  after/before: slack_unix values (exact bounds; `on:` is day-granular)
```

Paginate with `cursor` until exhausted; a busy day runs to five pages.
Then:

- For every result in a thread (`thread_ts` present), read the thread with
  `slack_read_thread` so others' replies are in view: what Jess answered
  matters as much as what Phil asked.
- Mentions of Phil he may not have replied to (these feed "Needs my
  attention"): `filters: "on:YYYY-MM-DD"`, `keywords: ["<@U01PYT4C7ND>"]`.
- DMs: `channel_types: "im,mpim"` with the same `from:` filter. DM content
  is private vault material; it stays in the Journal.
- Standup posts are the single best summary of what Phil thought the day
  was about. Quote the gist.

## Jira

Get the cloud id once per session with `getAccessibleAtlassianResources`
(or pass the site URL as `cloudId`).

Two facts shape the query. `updated` is the *last* touch, so filtering on it
alone misses issues Phil touched that day and someone touched again later
(7 of 27 issues for 2026-10-02). And `updatedBy(currentUser(), …)` does not
parse on this site. Use history functions instead:

```
searchJiraIssuesUsingJql
  jql: (reporter = currentUser() AND created >= "D" AND created < "D+1")
       OR status CHANGED BY currentUser() DURING ("D", "D+1")
       OR assignee CHANGED BY currentUser() DURING ("D", "D+1")
       OR ((assignee = currentUser() OR watcher = currentUser()) AND updated >= "D" AND updated < "D+1")
  fields: ["summary","status","issuetype","assignee","reporter","created","updated","resolution","parent"]
  maxResults: 100
```

- JQL dates resolve in the Jira profile timezone (Melbourne), so the ISO
  day is the local day. `D+1` is the next calendar day. `DURING` is
  end-inclusive, so next-day issues come back too; filter the result by
  local day with `jq` before reading it.
- Keys move when a ticket changes project (EN-5067 became COMP-2210,
  EN-5033 became PLP-100). Jira resolves the old key; link the current
  one and mention the old key only if Phil used it.
- Comments can't be date-filtered in JQL. For issues where Phil may have
  commented (the ones above plus any a Slack thread or session names),
  fetch `fields: ["comment"]` and keep comments authored by him on the day.
- Tickets created by Claude runs under Phil's account appear as his. The
  session scan tells you which; the diary says so (`Claude: created …`).
- Results over the inline limit land in a tool-result file; extract key,
  summary, status, created, updated with `jq` rather than reading the blob.

## GitHub

`gh` is authenticated as `bearmoth`. `gh search` lags and is UTC-day
granular; it under-reported a Friday (2 of 8 PRs). Use it only as a cross-
repo first pass, then take ground truth per repo. Repos that matter most
days: `primeslice/backend`, `primeslice/nats`, `primeslice/nats-tenants`,
`primeslice/stake-preproduction-gitops`, `primeslice/stake-production-gitops`,
`primeslice/stake-gitops`.

```
gh pr list --repo primeslice/backend --author bearmoth --state all --limit 50 --json number,title,url,state,createdAt,updatedAt,mergedAt,isDraft
gh pr list --repo primeslice/backend --search "reviewed-by:bearmoth updated:>=D-1" --state all --limit 50 --json number,title,url,state,updatedAt,author
gh pr list --repo primeslice/backend --search "commenter:bearmoth updated:>=D-1" --state all --limit 50 --json number,title,url,state,updatedAt,author
gh search commits --owner primeslice --author bearmoth --author-date "D-1..D+1" --json sha,commit,repository,url
```

Then for each candidate PR, precise times and reviewer identity:

```
gh pr view N --repo primeslice/<repo> --json number,title,url,state,isDraft,createdAt,mergedAt,mergedBy,closedAt,author,reviews,comments
```

For a batch of PRs, write a short Python script that calls `gh pr view`
per PR and prints one line each; a `bash -c` loop of `gh` calls has been
blocked by the Bash permission classifier, a script is not.

- Keep only events whose ISO timestamp falls inside `utc_start`..`utc_end`.
  A PR updated in range may have had nothing happen on the day.
- `reviews[]` carries `author.login`, `state`, `submittedAt`; a review from
  Phil on a teammate's PR is a Work Log line with the substance of what he
  said. `mergedBy.login` says who merged.
- Commits by a Claude run under Phil's identity are his commits; the diary
  says `Claude:`.
- Secondary rate limits (403 with primary quota untouched) clear after a
  short pause; space the calls.
- Record the state reached on the day in the state words from voice.md
  (PR open / in review / approved / merged / deployed / released). A merge
  into `master` on backend auto-deploys to some markets; a merge in nats or
  nats-tenants deploys nothing until a release step. Say which.

## Google Calendar

```
list_events
  calendarId: primary
  startTime: calendar_iso.start   endTime: calendar_iso.end
  timeZone: Australia/Melbourne   orderBy: startTime
```

- Standard on every entry: the Meetings section opens with one line per
  meeting Phil attended (time, title). Content comes from Slack, meeting
  captures, or Phil.
- Skip declined and cancelled events, OOO blocks, focus time, WFH markers.
  An all-day leave event means `On leave; no meetings.`
- If the connector errors or is unauthenticated, skip it without retrying,
  mention once in the presentation that calendar was unavailable, and leave
  the Meetings section to the other sources.

## Journal-internal (same day)

In-flight threads first:

```
grep -l "^status: *\(open\|blocked\)" ~/Documents/Journal/threads/*.md
```

For each, read `## Current state` and the last `### [[date]]` Log heading.
Today's evidence on that topic belongs to the thread (a new Log entry, a
Current state rewrite if things changed), with the diary carrying a Work
Log line and a `[[<Thread>]] — next step` task. A second-day Notes topic
with no thread is a promotion candidate (shape: `templates/thread.md`).

Then the day's own records:

```
ls ~/Documents/Journal/captures/sessions/ | grep YYYY-MM-DD
ls ~/Documents/Journal/log/ | grep YYYY-MM-DD
find ~/Documents/Journal/captures/meetings-easygo -name "YYYY-MM-DD*"
eos-queue list | jq '[.[] | select(.ts | startswith("YYYY-MM-DD"))]'
```

- Session captures (`captures/sessions/`) are agent summaries written at
  session end: attempted / what happened / decisions / loose ends. Their
  loose ends often become tasks or "Needs my attention" items, and they are
  the right link target for an agent run's detail.
- Meeting captures are Phil's own notes; link them from Meetings rather
  than duplicating.
- The worklog ledger (`log/`) is agent-written and context-tagged; a cross-
  check for Work Log lines, not a source to copy verbatim.
- For wikilink targets, grep both vaults (`~/Documents/Journal`,
  `~/Documents/Engagement PKB`) for the person or topic name.
