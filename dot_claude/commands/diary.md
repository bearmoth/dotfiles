---
description: Catch the Journal diary up since the last entry, or draft a given day or range (11-23..26, "since monday"), from Slack, Jira, GitHub, calendar and agent sessions
---

Invoke the **diary** skill with the argument below and follow it as written.
Empty means catch up: every day since the newest entry, resolved by its
script, which is usually just today. A day (`2026-11-20`, `friday`, `today`)
runs that one day; a range (`11-23..26`, `since monday`) runs each day in it.
The skill's gate decides what is written and committed directly and what
waits for "go".

$ARGUMENTS
