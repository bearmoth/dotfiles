# Voice and format

The diary is Phil's first person, and he has to *want* to read it back. The
first drafts of this skill were accurate and unreadable: paragraph-length
bullets carrying five links, nested dumps of an agent run, and codes that
only meant something inside one session. He said he'd stop reading entries
like that. The itemised Work Log itself he values highly for memory and
lookup. So the standard is: itemised, complete, and readable in one pass.

The previous entry is always the freshest sample of his voice; this file
holds the stable rules.

## File shape

```markdown
---
tags: [type/diary]
date: 2026-10-05
---
## Summary

Two to four plain sentences: what the day was about, what moved and to
which state, what is stuck and on whom. The version Phil could say at
standup tomorrow.

**Needs my attention**
- A review Johnny asked for on the delivery RPCs PR (#39937)
- Lazar's DM about a Peru VIP rank, unanswered since 17:36

## Tasks

- [ ] Transfer bonus merge
  - [ ] Review the state-RPC summary PR (#40095) and the audience PR (#40096)
  - [ ] Settle the co/br gitops override with Brad, then merge preprod → prod (Tue 2026-10-06)
- [x] Create the shared LaunchDarkly flag (created ~10:20)
- [ ] Fill Adam in on the merge direction
- [ ] Thing that came due today (from [[2026-10-02]])

## Work Log

### Transfer bonus merge

- Merged the rename of the `transferBonus` rollover type to `welcomeBonus` (#40091, ~9:46; master auto-deploys)
- Told the handoff run the shared flag exists (~10:20); it re-ran codegen and un-drafted the UDT skip PR (#40097, PR open)

### PR reviews

- Johnny's pause/resume delivery RPCs (#39937): approved with a nit
  - `createSchemaHandler` isn't needed when there's no input to parse
- Adam's `findReward` query (#40110): asked whether `findOffer` keeps the language consistent with the model; approved

### Peru / UDT support

- Replied to Lazar's DM about a Peru user's VIP progress: the bad cases were a TG Labs data problem, not our import

### Personal

- Claude: built the diary skill (draft → go → write gate); see [[2026-10-05-diary-skill-creation]]

## Meetings

- 9:30 Matt check-in
- 10:45 Engagement standup

### Matt check-in

- ...

## Notes

### Topic

Prose or bullets.
```

- Exactly one `type/diary` tag and a `date`. No `about:` on dated notes.
- Sections in this order, all present even when short. `## Summary` was
  added at Phil's request on 2026-10-06; the vault template may lag.

## Readability rules

These exist because Phil won't read what breaks them.

- **One event per bullet.** "Posted the PR, Peter asked why `taskType` is
  a string, agreed to keep it, merged ~15:30" is four events; the bullet
  is the merge, with the question and answer as a sub-bullet. A bullet
  that runs past two lines is nearly always two events. If it needs more,
  it is a Notes subsection and the bullet says "see notes".
- **Structure the Work Log by topic, like Meetings.** A busy day is twenty
  to forty bullets; as one flat list it is a wall of text Phil can't scan
  or search later. Group bullets under `###` headings named for the thread
  of work ("Transfer bonus merge", "PR reviews", "Peru / UDT support",
  "Incidents", "Personal"), three to seven headings, ordered by when each
  thread started, bullets chronological inside. A quiet day with under
  eight bullets can stay flat.
- **One level of sub-bullets, for detail only.** A review's individual
  comments under the review, a thread's outcome under the thread. Never a
  transcript: an agent run is one to three bullets saying what it produced
  and in what state, with its detail in the session capture
  (`captures/sessions/`), linked. Phil's own interventions in a run are his
  bullets, in the thread's heading, not the run's.
- **The sentence first, the link second.** Name the thing ("the rollover
  rename PR"), then attach the link. A bullet must still make sense with
  every link stripped. Two links per bullet is the comfortable maximum; a
  list of six PRs is a Notes table or a Jira epic, not a Work Log line.
- **No session-local jargon.** Codes like S1–S7, P1/E1, "wave", "slice",
  "phase 2" mean nothing outside the session that coined them. Phil made
  exactly this complaint about Claude-written tickets. Say what the thing
  is. Before: "built and reviewed six of seven slices". After: "the run
  opened six PRs: the UDT state summary, the audience on incentives, the
  UDT skip behind the flag, …; the UDT-event nudge waits on #36928".
- **No sentiment Phil didn't express.** A draft once wrote "the transfer
  bonus mess" in his Summary; he never called it that, and he pointed out
  that a diary in his voice carrying feelings he doesn't share is worse
  than one carrying none. Judgement words (mess, painful, finally, sadly,
  great) appear only inside his own quoted words. State what happened.
- **State words for code, always.** `drafted` (local only), `pushed`,
  `PR open`, `in review`, `approved`, `merged`, `deployed to <env>`,
  `released`. Never "done" for code; merged is not deployed. For tickets:
  created, moved to <status>, closed. Phil asked for this explicitly:
  clarity about how far something got is the point of the record.
- **Absolute time words.** "Fri 2026-10-09", not "Friday" or "in the
  morning"; the entry is read weeks later.
- Verb-led bullets: Asked, Posted, Reviewed, Helped, Drafted, Aligned,
  Kicked off, Clarified. Approximate times where they help reconstruct the
  day: `(~9:30)`, `Out ~16:20`.
- `Claude:` prefix for work an agent did under Phil's direction;
  `Personal:` for non-work items that still belong in the day.
- Standup content as a quoted gist: `Async standup: "Starting transfer
  deposit bonus functionality. Unsure, tickets may need work."`
- Channels as `#eng-lib2`. People as `[[Full Name|First]]` (see Links).

## Summary

- Two to four sentences, plain words, no codes, at most a couple of links.
  What he worked on, what shipped and to what state, what is blocked and on
  whom. Readable by someone who wasn't there.
- **Needs my attention**: inbound items waiting on Phil, each with who and
  where: review requests, unanswered DMs or thread questions, decisions
  others are waiting for, things that happened while he was out. This is
  what the "Missed while on leave" section was; it applies every day. Phil
  decides whether an item becomes a task. Omit the block when empty.

## Tasks

A task is something Phil committed to do or clearly owes. Not an agent
run's backlog, not Jira's backlog, not ideas, not things other people are
doing. If the list passes about eight, something is a note or Jira's job.

- **Where tasks live.** In the entry where they arose. They are carried
  into later entries only while actionable; `scripts/open_tasks.py` works
  out which apply to a day:
  - undated open tasks from the previous entry carry forward;
  - a task with a due date (`(Fri 2026-10-09)`, `📅 2026-10-09`, any ISO
    date in the line) stays in its origin entry until that day, then
    appears as `- [ ] … (from [[2026-10-02]])`;
  - open tasks from older entries that stopped being carried are listed
    for a decision, not silently resurrected.
- **Group related tasks.** When several tasks belong to one thread of
  work, nest them under a parent line (a parent task or a bold label) so
  the list reads as three or four groups rather than ten peers. One level
  only. `scripts/open_tasks.py` keeps the parent when it carries a child.
- **Practices are not tasks.** "Try the A.S.K. framing in reviews" can
  never be ticked. It goes in Notes once and does not carry.
- **Ticking.** Tick the copy in the entry being drafted, with the evidence
  in a few words (`merged ~14:05`, `posted in #engagement-core-devs`). Never
  change a checkbox in an earlier entry; history stays as it was.
- Never retro-fit ticked tasks that were never open (`[x] On leave`).
- Phrase as the action, absolute dates, one line.

## Work Log

- Topic headings (see Readability rules), chronological inside each; sort
  by time before presenting.
- Say what was said, not that something was said: "Reviewed PRs: suggested
  hoisting `getSettings` into a closure so the RPC happens once per
  service" beats "Reviewed PRs".
- One bullet per thing. An hour-long thread is one bullet with the
  outcome, with at most a couple of sub-bullets for the points that
  matter; its blow-by-blow is Notes if Phil's thinking is in it.
- Updating an existing flat Work Log: new lines go under the headings they
  belong to. If the existing entry is flat and long, it may be grouped
  under headings with every line kept verbatim; say in the presentation
  that lines moved and none changed.

## Meetings

- Start with the calendar: one line per meeting Phil attended, time and
  title. Declined, cancelled, OOO blocks and focus time are not meetings.
  On leave: `On leave; no meetings.`
- `###` subsections only for meetings with substance: what was decided,
  who does what, what Phil thinks. If a meeting capture exists
  (`captures/meetings-easygo/`), link it and keep the diary summary short.
- A huddle with no transcript gets its calendar line plus a placeholder:
  `[Phil: anything from the ~11:00 huddle with Johnny?]`.

## Notes

- `###` per topic. This is where direction, design thinking, and "where I
  landed" live. Longer prose is fine here; it is still Phil's words or a
  faithful digest of them, not a run report.
- **A topic lives in the diary only on its first day.** The vault's rule
  is "promote on second touch": when a Notes topic needs a second day it
  becomes `threads/<Title>.md`, with `## Current state` on top and a
  `## Log` of `### [[YYYY-MM-DD]]` entries. From then on the diary carries
  a Work Log line and, when there is a next step, a task
  `- [ ] [[<Thread>]] — <next step>`; the day's thinking goes into the
  thread's Log entry. Never a continuation heading, never a
  `[[2026-09-29#Heading]]` link (older entries have them; new ones don't).
- Thread names are searchable noun phrases ("Transfer bonus rollover",
  "Promo-campaign domain language"), no date, no ticket key; keys go in
  the thread's `aliases:`.
- A short status table for a multi-PR piece of work is fine (merged /
  in review / blocked on X), six lines or so, with each PR named by what it
  does.
- Decisions with real alternatives are ADR-shaped; say so in chat, don't
  write the ADR into the diary.

## Links

- People: `[[Matt Doyle|Matt]]`, `[[Peter Nham|Peter]]`. Always full name,
  even when no note exists yet; that is Phil's practice. Grep earlier
  entries for the spelling already used before linking.
- Jira: `[EN-4958](https://easygo-group.atlassian.net/browse/EN-4958)`.
- PRs: `[#35060](https://github.com/primeslice/backend/pull/35060)`, and for
  other repos `[nats#215](https://github.com/primeslice/nats/pull/215)`.
- Slack permalinks when the message is the artefact (an RFC thread, a sev
  issue). Confluence pages by title. Journal notes as wikilinks.

## What the draft never does

- Invent feelings, opinions, motives, or asides ("Oops.", "Sus."). Where
  Phil's view is the point and the evidence lacks it, leave `[Phil: …?]`.
- Infer personal-life details from colleagues' messages (a birthday from
  channel chatter). Only Phil's own words put personal matters in.
- Guess a colleague's pronouns. Use the name, or they/them, unless the
  vault or Phil's own words supply the pronoun; when one is used, the
  source is noted in the verification line so it can be checked.
- Quote without the marks. When a sentiment is Phil's ("I get frustrated
  at PRs that…"), keep enough of his wording in quotes that the provenance
  is visible in the entry itself.
- Smooth his existing sentences. An update changes a line only for a
  factual reason it states.
- Pad a quiet day, or restate an agent run's whole queue as his tasks.
- Add emoji or exclamation marks he didn't use.
