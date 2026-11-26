---
name: diary
description: Create or update diary entries (diary/YYYY-MM-DD.md, one per day; a bare /diary catches up every day since the last entry) in the Journal vault by gathering evidence from Slack, Jira, GitHub, Google Calendar, Claude Code and pi transcripts, and the Journal's own captures, then drafting a readable, well-linked entry in Phil's voice (summary, tasks, work log, meetings, notes), writing and committing it directly when the file is new or the change only adds to it, and asking first when it would alter his existing lines. Use whenever Phil asks to write, update, catch up, fill in, or finish the diary or daily note for today, any past day or a range of days (/diary, /diary 11-23..26, "diary since monday", "diary for Friday", "update today's entry", "what did I do yesterday, put it in the diary"), including re-runs on a day that already has an entry, and when a day's work belongs to an open thread in threads/ (the thread gets its log entry for the day and the diary links it).
---

# Diary

Draft Phil's diary from evidence, one local calendar day at a time, write
it when the write is safe (a new file, or additions to an existing one),
and ask first when it isn't. A bare `/diary` catches up every day since
the last entry; a named day or range does just those. Safe to run many
times for the same day.

## The gate, and when it opens

The Journal glossary says the diary is **never agent-written**. Phil has
clarified what that line guards against: agents writing to vaults as a
side effect of other work (auto-capture). It does not forbid this skill,
which he invokes by hand to write the diary; do not refuse on the
strength of that line. What it still means here is that an agent does not
author Phil's first person: the agent gathers, verifies, and drafts, Phil
authors by reading and redirecting, and the file changes only in ways he
can review cheaply. He found the "present, then wait for go" step pure
friction for the common cases, so the rule turns on what the write does
to his existing words:

- **Write and commit without asking** when the entry file does not exist
  yet, or when every existing line survives unchanged and the change is
  additions (new bullets, headings, sections, a `- Links:` line) plus
  task ticks with evidence. Appending a `### [[date]]` Log entry to an
  existing thread is the same case. Git holds the previous state and he
  reads the result in chat anyway, so a wrong addition costs him one
  revert, not a rewrite.
- **Present and wait for "go"** when any existing line would be removed,
  reworded, moved, or un-ticked; when an earlier entry would change (a
  thread promotion relinks its origin heading); when a thread's
  `## Current state` would be rewritten; or when a new thread file would
  be created. Those are edits to his authorship, and he decides them.

An explicit instruction in the prompt ("show me first", "don't write")
always wins. Either way the draft must be good enough to approve with few
edits, honest about what it could not know (how a conversation felt, what
he thinks), and above all readable: Phil said he would stop reading
entries that are dense and mechanical, which would defeat the whole
exercise. Where only Phil can supply a judgement, leave a visible
placeholder like `[Phil: how did this land?]` instead of inventing one; a
placeholder is an addition, so it never blocks a write.

If there is no human in the loop (a subagent, an eval, an autonomous run):
stop after presenting the draft. Never write or commit.

## Workflow

### 1. Resolve the days

Which days a run covers depends on how Phil asked:

- **Bare `/diary`, or "catch up" / "fill in the diary" with no day
  named:** catch up. Run `scripts/session_scan.py --since-last`. It starts
  from the newest `diary/YYYY-MM-DD.md` and its last commit and lists
  every day from there to today that is missing, plus that newest entry
  itself when its last commit came before its day ended (evidence may
  carry on after it). Most days this is just today, which is the old
  behaviour.
- **A range** (`/diary 11-23..11-26`, `11-23..26`, "since monday", "last
  week"): run `scripts/session_scan.py --range "<what he said>"`. Every
  day in it is processed; a day whose entry is already complete is a
  re-run.
- **One named day**, including "today" or "today's entry" ("diary for
  Friday", `/diary 2026-10-02`, "update today's entry"): exactly as
  before. Resolve it against today in `Australia/Melbourne` and run the
  one-day workflow below. Naming a day opts out of catch-up.

Never work out dates, weekdays or ranges by hand; the script owns that
arithmetic (`--now` pins the clock when a prompt says what "today" is).
Before gathering anything, tell Phil the resolved days in a short list
(date, weekday, new / partial since HH:MM / re-run, weekend). For two or
more days, continue with "Catching up several days" below; it runs steps
2–6 once per day.

- For each day, use its window: the catch-up and range plans already
  carry one per day, and for a single day run
  `scripts/session_scan.py --window --date YYYY-MM-DD`. It prints the
  UTC bounds, unix seconds, and ready-made Slack/JQL/GitHub/Calendar
  fragments for that local day. Use these for every source; do not
  hand-derive offsets. Melbourne's local day starts at 13:00Z (AEDT) or
  14:00Z (AEST); a scan that used 00:00Z once silently dropped most of a
  Monday.

### 2. Read what the Journal already holds

Journal root: the `personal journal` mount from the Engineering OS block
(normally `~/Documents/Journal`). Only this vault is ever written.

- `diary/YYYY-MM-DD.md` if it exists. Note its last commit time
  (`git log -1 --format=%ci -- diary/YYYY-MM-DD.md`): evidence up to then
  was already incorporated. Judge completeness by comparing the entry
  against the evidence timeline, never by reading the entry and deciding
  it "looks complete".
- `scripts/open_tasks.py --date YYYY-MM-DD` for the tasks that belong in
  this day. Its first two buckets (due, carried from the previous entry)
  **must** appear in the draft, open or ticked with evidence; this is the
  main defence against dropping a ball. It also lists older open tasks
  that stopped being carried, with reworded duplicates collapsed, and
  flags the classic loss: a child task whose parent line was reworded
  while the thread stayed open (the Datadog-monitor task vanished this
  way on 2026-10-13). Those go to Phil as a decision list, never dropped
  silently.
- The previous entry, as the freshest sample of voice and format.
- Open threads: `threads/*.md` with `status` other than `done` (the
  `Threads.base` "In flight" view). Read each one's `## Current state` and
  the date of its last `## Log` entry. A thread is a multi-day topic
  promoted out of the diary (README, "Threads"); today's work on it goes
  into the thread, not into a repeated Notes heading.
- Same-day material already on disk: `captures/sessions/YYYY-MM-DD-*.md`,
  `captures/meetings-easygo/**/YYYY-MM-DD*.md`, `log/YYYY-MM-DD *.md`, and
  `eos-queue list` entries whose `ts` falls in the window. These are
  first-person or agent-summarised records of the same day; use them as
  leads, as a check on the external sources, and as the link target for an
  agent run's detail.

### 3. Gather external evidence

Recipes, identifiers, and pitfalls per source are in
`references/sources.md`. Read it before querying. In brief:

| Source | What to pull | Tool |
|---|---|---|
| Agent sessions | what Phil asked Claude/pi to do, when, in which repo | `scripts/session_scan.py --date …` |
| Slack | his posts, replies, threads he took part in, mentions awaiting him | `slack_search_public_and_private`, `slack_read_thread` |
| Jira | issues he created, transitioned, commented on, was assigned | `searchJiraIssuesUsingJql` |
| GitHub | PRs opened, reviewed, commented, merged; commits; state reached | `gh` CLI, per repo |
| Calendar | the day's meetings, for the Meetings section | `list_events` |

Slack takes two passes (`references/sources.md`, "Slack"): list the
conversations Phil posted in, then read each one, both sides, threads and
DMs alike. His posts alone are half the story; on a busy day a subagent
reads the threads and returns a digest. The Summary should carry how the
day went (how many things he was juggling, his standup blocker), not only
what shipped.

Run independent sources in parallel. A source that is down narrows the
draft, it never blocks it: carry on, and say once in the presentation what
was unavailable. Large tool results go to files and get extracted with
`jq`, not pasted into context.

**Recipe failures.** If a documented query is rejected or plainly
under-returns, that is a defect in this skill, not weather. Use the
source's fallback, finish the draft, and then put a short "Skill defect"
block in the presentation: what failed, the fix you would make to
`references/sources.md` (or a script), and an offer to apply it to the
chezmoi source (`~/.local/share/chezmoi/dot_claude/skills/diary/`) and
`chezmoi apply`. Phil would rather fix the skill than read the error in a
log.

### 4. Cross-reference and verify

Evidence disagrees with itself more often than you would expect, and a
diary line is a long-lived record, so:

- Treat anything a session transcript, Slack message, or peer agent
  *claims* (PR numbers, ticket keys, "merged", "done") as a lead. Confirm
  every PR number and its state with `gh pr view`, every ticket key and
  status with Jira, before they enter the draft. Keep a list of what you
  verified; the presentation states it in one line. A self-report once
  named backend#40098 for work that was actually #40097.
- Record the *state* each piece of code reached on the day in the state
  words from `references/voice.md` (drafted, pushed, PR open, in review,
  approved, merged, deployed, released). Phil asked for this explicitly.
- For every task the open-tasks script surfaced, look for evidence it was
  done (PR merged, ticket transitioned, message posted, meeting held) and
  propose ticking it with the evidence in a few words. No evidence, no
  tick.
- Every Slack conversation from pass 2 lands in the draft (a Work Log
  line, a task, or an attention item) unless it was banter; check the
  digest against the draft before presenting.
- Collect what is waiting on Phil: review requests, unanswered DMs and
  thread questions, decisions others are blocked on. These become the
  "Needs my attention" block.
- Cross-reference the vaults for link targets: people notes in
  `captures/people-easygo/`, meeting notes, reflections, and the Engagement
  PKB (the `easygo wiki` mount, readable from here). Reuse existing names
  and spellings exactly.
- Prefer the primary artefact (the RFC, the PR, the ticket) as the link
  when a thread or session reveals a decision.

### 5. Draft

`references/voice.md` has the format and the readability rules, with a
worked shape. Read it; the essentials:

- Sections in order: `## Summary` (two to four plain sentences plus a
  **Needs my attention** list), `## Tasks`, `## Work Log`, `## Meetings`,
  `## Notes`. Frontmatter is exactly `tags: [type/diary]` and `date:`.
- The Work Log is grouped under `###` topic headings (three to seven on a
  busy day, like the Meetings section), chronological inside each. One
  thing per bullet, one or two lines, at most one level of sub-bullets for
  detail. A bullet must make sense with its links stripped. No
  session-local jargon (S4, "wave", "slice", P1). An agent run is one to
  three bullets linking the session capture, not a transcript of the run.
- Tasks may be grouped under a parent line when several belong to one
  thread of work.
- No sentiment Phil didn't express ("the transfer bonus mess" was his
  complaint about a draft); judgement words only inside his quoted words.
- Meetings opens with the calendar lines; `###` only where there is
  substance.
- Tasks are things Phil committed to or owes, few, absolute dates. Dated
  tasks stay in their origin entry until due; practices are Notes, not
  tasks.
- **Nothing falls off.** Every due and carried task from the script is in
  the draft, open or ticked with evidence. When a parent task is reworded
  (a thread's next step changes daily), its open children move under the
  new wording. The script's stale and flagged items are listed in the
  presentation for a carry / tick / drop decision; a drop needs Phil's
  word or a stated reason.
- Do not pad. A quiet day is a short entry.
- **Threads.** A topic that continues an open thread gets no Notes
  heading. It gets a Work Log line, a task line
  `- [ ] [[<Thread>]] — <next step>` if there is one, and a drafted
  `### [[YYYY-MM-DD]]` entry for the thread's `## Log` plus any rewrite of
  its `## Current state`. A Notes topic that is on its *second* day with
  no thread yet (a continuation heading, a "Continue X" task, or a
  `[[date#heading]]` link gives it away) is a promotion candidate: draft
  `threads/<Title>.md` in the shape of `templates/thread.md` (noun-phrase
  name, no date or ticket key; keys in `aliases:`; `started:` and the
  first Log heading = the origin entry's date; the extracted heading and
  body as that first Log entry), and show the origin entry's heading
  becoming a link. Never write `[[date#heading]]` continuation links in a
  new entry. Promotion is proposed, never done unprompted.
- **Links.** Phil uses the diary to get back to things, so every
  cross-reference carries a link where one exists: the Slack thread or
  message, the Jira ticket or the specific comment, the PR, the review
  comment, the Journal or PKB note or its section. Inline when the
  sentence names the thing; otherwise a `- Links:` sub-bullet under the
  bullet, or a `- Links:` line closing the section (`references/voice.md`,
  "Links"). Collect permalinks while gathering; `references/sources.md`
  says where each kind comes from.

Then read the draft once as Phil would, at the end of a day, on a phone.
Anything you would skip, shorten.

**Updating an existing entry.** Keep its structure and its words. Add
lines in the same style where they belong chronologically; tick tasks
with evidence; change one of Phil's lines only for a factual reason you
can state. The result must still read as his entry, not as an entry with
a changelog bolted on.

### 6. Present, then write or wait

Show the entry as it would read, in full, as a markdown block. For an
update, follow it with a unified diff of existing → proposed (fenced,
`diff`), and one line per change to Phil's own wording with its reason.
After that, briefly:

- which case from "The gate" this write is, in one line with the reason
  ("new file", "additions and two ticks only", "rewords one of your
  lines, waiting for go");
- open tasks needing a decision: the script's stale and flagged items,
  each with its origin and the proposed action (carry under X / tick,
  evidence Y / drop because Z);

- placeholders and what they need from him;
- one line on verification ("All 9 PR and 12 ticket references checked
  against gh/Jira; #40183 not viewed") and any source that was unavailable;
- thread updates, each as its own block: the Log entry and Current state
  for an existing thread, or the whole new note for a promotion;
- a Skill defect block if a recipe failed (see step 3);
- capture offers when something is ADR-shaped or reflection-shaped, in a
  sentence, not written into the diary.

A safe write goes straight on to step 7 in the same turn. An unsafe one
stops here: edits and redirections loop back to the draft, and only an
explicit go proceeds. Nothing about a long gathering phase earns the
right to skip the check.

### 7. Write and commit

For a safe write, or after the go:

1. Write `diary/YYYY-MM-DD.md` with the approved content, plus any
   approved thread files under `threads/` (and, for a promotion, the
   origin entry's heading-to-link change).
2. Commit only those files, by pathspec so anything already staged by
   another routine stays out of the commit:
   `git -C <journal> add -- diary/YYYY-MM-DD.md threads/<Thread>.md … && git -C <journal> commit -m "diary: YYYY-MM-DD (<few words>)" -- diary/YYYY-MM-DD.md threads/<Thread>.md …`
   (name promoted or updated threads in the message). Leave other
   untracked or modified files alone; they belong to other routines. Do
   not push.
3. Report what was written and committed in one line. When the write
   happened without a go, say so in that line; Phil should never have to
   wonder whether the file changed.

## Catching up several days

A gap is several one-day runs in a row, not one big entry. The per-day
rules above all still hold; what changes is order, pacing, and how the
gate's "go" and the commit are batched.

**Oldest first, one day at a time.** `open_tasks.py` carries tasks from
the previous entry, so day N+1 can only be drafted once day N's entry
exists. Keep a scratch directory outside the vault (e.g.
`$TMPDIR/diary-catchup/`), put each finished draft there as
`YYYY-MM-DD.md`, and run `scripts/open_tasks.py --date … --drafts <dir>`
so the next day reads the draft whether or not it has been written yet.
Then, per day:

- **Safe write** (new file, or additions only): write it into the vault
  now, before starting the next day. Don't commit yet.
- **Needs "go"** (it would alter Phil's existing lines): leave it in the
  scratch directory, note what needs his word, and carry on with the next
  day. Don't stop halfway through the run to ask.
- **A partial day** (the newest entry, last committed mid-day): it is an
  update, run as "Updating an existing entry" says. New evidence is most
  likely after the plan's `evidence_after` time, so start there, but still
  compare the whole entry with the day's timeline: work that finished
  just before the commit, or a placeholder or "couldn't read X" caveat the
  entry left, may now be answerable. Filling one of those changes Phil's
  line, so it goes on the go list. If nothing turns up, say "nothing new
  since HH:MM" and leave the file alone.
- **No evidence at all** (no agent sessions, Slack, Jira, GitHub,
  meetings or captures in the window): report the day, don't write it.
  The script's local-evidence counts only cover agent sessions and
  captures, so a zero there is a reason to look, not proof of an empty
  day (the 2026-11-15 entry came from GitHub alone).

The existing conventions hold for each day. A weekend day gets an entry
only when there is evidence, as on 2026-11-14/15. Leave comes from the
calendar's all-day leave event and follows the leave convention in
`references/sources.md` ("Google Calendar"). A weekday public holiday
gets the short entry Phil wrote for Melbourne Cup Day (2026-11-03): the
Summary says `Public holiday (<name>).`, Meetings says `Public holiday
(<name>); no meetings.`, and the other sections stay empty unless there
is evidence. A 15:45 out-of-office block never makes a day short.

**Keep the context small.** One day's gathering already fills a lot of
context, so for two or more days gather each day in its own subagent. It
reads `references/sources.md`, runs the step 3 and 4 recipes for that
day's window, and writes a digest file to the scratch directory: what
happened, with times, permalinks, and the verified state of every PR and
ticket. It returns only a few lines. Gatherers may run in parallel; they
never write the vault. Drafting stays in this context and stays serial,
oldest first, reading each digest in turn.

**At the end, present once.**

- One line per resolved day: written (new or additions), waiting for go,
  nothing new, or not written because there was no evidence.
- Each written or proposed entry in full, as step 6 describes. For one
  waiting on go, add its diff and the reason for each change.
- One batched go list, plus the step 6 extras (stale-task decisions,
  placeholders, verification, thread updates, defects) merged across days
  instead of repeated for each one.

**One commit per run**, once everything that can be written is written:
straight away when no go is pending, otherwise after Phil answers (commit
what he approved; drop or rework what he didn't, then re-check the next
day's carried tasks). The subject names the range, from
`scripts/session_scan.py --label <the days written>`:
`diary: 2026-11-23..26 (<few words per day or theme>)`. Commit by
pathspec as in step 7, listing every diary and thread file the run
wrote.

The no-human rule is unchanged: draft every day (in order, through the
scratch directory), present everything, and never write or commit.

## Boundaries

- Writes go to `diary/` and `threads/` in the Journal only, both under
  the rule in "The gate". Worklogs (`log/`), captures, templates, and other vaults have
  their own routines (knowledge-routing). Reading them is fine; writing
  them is not this skill's job. Settled org knowledge inside a thread
  (requirements, decisions) is a separate write to its org home: offer
  it, never do it here.
- Colleagues' words may be quoted when Phil was in the conversation (that
  passes the first-person test); don't lift content from channels he never
  took part in, and never infer his personal life from others' messages.
- A fault in Engineering-OS itself found along the way (hook misfire, bad
  routine) goes to `/eos-issue`, not the diary. A fault in this skill goes
  in the Skill defect block.
