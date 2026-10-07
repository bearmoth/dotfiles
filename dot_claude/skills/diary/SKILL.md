---
name: diary
description: Create or update one day's diary entry (diary/YYYY-MM-DD.md) in the Journal vault by gathering evidence from Slack, Jira, GitHub, Google Calendar, Claude Code and pi transcripts, and the Journal's own captures, then drafting a readable entry in Phil's voice (summary, tasks, work log, meetings, notes) for his explicit "go" before anything is written or committed. Use whenever Phil asks to write, update, catch up, fill in, or finish the diary or daily note for today or any past day (/diary, "diary for Friday", "update today's entry", "what did I do yesterday, put it in the diary"), including re-runs on a day that already has an entry.
---

# Diary

Draft one local calendar day of Phil's diary from evidence, present it,
and write only on his explicit "go". Safe to run many times for the same
day.

## Why the gate matters

The Journal glossary says the diary is **never agent-written**: an agent
does not author Phil's first person. The working reconciliation is that
the agent gathers, verifies, and drafts; Phil reads the draft, edits or
redirects, and says "go"; only then does the file change. The draft is a
proposal, so it should be good enough to approve with few edits, honest
about what it could not know (how a conversation felt, what he thinks),
and above all readable: Phil said he would stop reading entries that are
dense and mechanical, which would defeat the whole exercise. Where only
Phil can supply a judgement, leave a visible placeholder like
`[Phil: how did this land?]` instead of inventing one.

If there is no human in the loop (a subagent, an eval, an autonomous run):
stop after presenting the draft. Never write or commit without the go.

## Workflow

### 1. Resolve the day

- Default is today. An optional argument names another day: an ISO date,
  or relative words ("yesterday", "last Friday") resolved against today in
  `Australia/Melbourne`. Say which date you resolved to before gathering.
- Run `scripts/session_scan.py --window --date YYYY-MM-DD`. It prints the
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
  this day: due, carried from the previous entry, stale ones needing a
  decision, and future-dated ones to leave alone.
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

Then read the draft once as Phil would, at the end of a day, on a phone.
Anything you would skip, shorten.

**Updating an existing entry.** Keep its structure and its words. Add
lines in the same style where they belong chronologically; tick tasks
with evidence; change one of Phil's lines only for a factual reason you
can state. The result must still read as his entry, not as an entry with
a changelog bolted on.

### 6. Present and wait

Show the entry as it would read, in full, as a markdown block. For an
update, follow it with a unified diff of existing → proposed (fenced,
`diff`), and one line per change to Phil's own wording with its reason.
After that, briefly:

- placeholders and what they need from him;
- one line on verification ("All 9 PR and 12 ticket references checked
  against gh/Jira; #40183 not viewed") and any source that was unavailable;
- thread updates, each as its own block: the Log entry and Current state
  for an existing thread, or the whole new note for a promotion;
- a Skill defect block if a recipe failed (see step 3);
- capture offers when something is ADR-shaped or reflection-shaped, in a
  sentence, not written into the diary.

Then stop and wait. Edits and redirections loop back to the draft; only an
explicit go proceeds. Nothing about a long gathering phase earns the right
to skip this step.

### 7. Write and commit

After the go:

1. Write `diary/YYYY-MM-DD.md` with the approved content, plus any
   approved thread files under `threads/` (and, for a promotion, the
   origin entry's heading-to-link change).
2. Commit only those files:
   `git -C <journal> add diary/YYYY-MM-DD.md threads/<Thread>.md … && git -C <journal> commit -m "diary: YYYY-MM-DD <few words>"`
   (name promoted or updated threads in the message). Leave other
   untracked or modified files alone; they belong to other routines. Do
   not push.
3. Report what was written and committed in one line.

## Boundaries

- Writes go to `diary/` and `threads/` in the Journal only, both behind
  the go. Worklogs (`log/`), captures, templates, and other vaults have
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
