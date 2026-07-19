# Research: Engagement PKB ingestion machinery audit

- Issue: [bearmoth/dotfiles#8](https://github.com/bearmoth/dotfiles/issues/8) (child of map #3)
- Feeds: capture strategy (#16), vault migration (#18)
- Vault: local clone at `~/Documents/Engagement PKB`, remote `git@github.com:primeslice/engagement-pkb.git` (work org)
- Method: read-only inspection of the vault, its `.claude/` machinery, `~/Library/LaunchAgents`, and `launchctl list`. No writes/commits/pushes were made to the vault.

## 1. What the vault is

An agent-managed knowledge base for Phil's Engagement squad at Easygo, explicitly built on the Andrej Karpathy "LLM Wiki" pattern (stated in the vault's own `README.md`): sources are ingested once into a staging layer, then synthesised into a durable, cross-linked wiki, rather than re-deriving answers from raw documents each time (i.e. deliberately not a RAG setup).

Top-level structure:

| Path | Purpose | Rough size |
|---|---|---|
| `CLAUDE.md` (510 lines) | Full operating spec: classification scheme, staging rules, autonomy tiers, hub/spoke conventions, page-type schemas | — |
| `wiki/` | Synthesised knowledge base — 13 sub-areas (services, markets, people, decisions, concepts, incidents, teams, tooling, settings, workflows, architecture, organisations, open-questions) | 292 markdown files, ~2.0 MB |
| `raw/` | Immutable staging area, one subdir per source (slack, confluence, jira, github, datadog, redshift, meetings, external, code) | 152 files, ~928 KB |
| `personal/` | Phil-only working notes; **gitignored, never committed** | 111 files, ~6.7 MB |
| `templates/` | Page-type templates (service, decision, concept, etc.) | 14 files |
| `.claude/` | Skills, hooks, scripts driving the agent workflows | — |
| `.obsidian/` | Obsidian config; only the `terminal` community plugin installed | — |

The vault is genuinely agent-managed rather than plugin-managed: Obsidian itself carries almost no automation (one plugin), and essentially all ingestion/synthesis/lint logic lives in `.claude/skills/*/SKILL.md` plus `wiki/workflows/*.md`, invoked through Claude Code.

## 2. Sensitivity model (as designed)

`CLAUDE.md` defines an explicit three-tier classification enforced procedurally, not just by convention:

| Class | Meaning | Where it may live |
|---|---|---|
| `public` | Org-readable | `raw/` → `wiki/` |
| `private-shareable` | Restricted but explicitly whitelisted | `raw/` (after whitelisting) |
| `private-sensitive` | DMs, HR/legal, customer data, personal email | `personal/<name>/<source>/` only — never `raw/` or `wiki/` |

Default classification is source-driven (open Slack channels/Confluence EN space/Jira EN project/Datadog → `public`; Slack DMs/unknown Drive docs/unwhitelisted private channels → `private-sensitive` by default, "never assume").

This is backed by an actual enforcement mechanism, not just documentation: `.claude/hooks/pre-write-tripwire.py` is a `PreToolUse` hook on `Write|Edit` that greps new content for `classification: private-sensitive` and **blocks (exit 2)** any write into `raw/` carrying that marker, redirecting the agent to `personal/<name>/<source>/` instead. A companion `post-edit-lint.py` hook runs after every edit, and the `/lint` skill does a fuller periodic sweep for staging violations, broken wikilinks, and "personal/ leaking into wiki/" cases.

## 3. Ingestion machinery found

Two independent ingestion paths exist, at very different points of health.

### 3a. Interactive ingestion (agent-driven, in live Claude Code sessions) — **working**

Skills in `.claude/skills/`, each backed by a fuller protocol doc in `wiki/workflows/`:

- `/ingest` — takes one staged `raw/` file, synthesises into `wiki/`
- `/weekly-ingest` — scans a time window across Slack/Confluence/Jira/PagerDuty/calendar, produces a briefing, waits for Phil's approval, then writes
- `/triage` — session-start executor: applies "autonomous tier" changes immediately (with commit + `wiki/log.md` entry), stages private DM content, surfaces "briefing-gated" proposals for approval
- `/query` — read-only Q&A against the wiki, falling back to MCP sources, logged even when trivial
- `/lint` — wiki health check (broken links, staging violations, schema drift)
- `/new-service`, `/rename-slug`, `/slack-channels` — structural maintenance skills

Sources integrated via MCP: Slack, Confluence, Jira, PagerDuty, Datadog (via an internal tool, "Woofer"), GitHub. An explicit **autonomy-tier split** governs what the agent may commit unprompted (append-only edits to existing pages, citable to a source) versus what needs Phil's sign-off (new pages, decisions/RFCs, classification changes, personal→wiki promotion).

Health check: `git log` shows real, frequent commits through **2026-07-17** (the most recent session in the clone), mixing `auto:` (autonomous-tier), `ingest:` (approved batch ingests), and `add:`/`update:` commits. This path is active and clearly the one actually keeping the wiki current — 40 wiki files and 8 raw files were touched in the ~9 days before the audit.

### 3b. Background scanner (launchd, headless) — **broken, ~1 week at time of audit**

Two `launchd` jobs (found in `~/Library/LaunchAgents/` and confirmed present via `launchctl list`, both showing a non-zero last exit status):

- `io.easygo.pkb-scanner-light` — daily, invokes `pkb-scanner.sh light` (48h window: DMs, whitelisted channels, PagerDuty, Jira)
- `io.easygo.pkb-scanner-deep` — weekly (Friday), `pkb-scanner.sh deep` (8-day window, full surfaces matrix including Confluence RFC/ADR + comments)

Mechanism: `.claude/scripts/scan-wrapper.sh` runs `claude --print "/scan <cadence>"` headlessly, capturing stdout and atomically swapping it into `personal/phil/inbox.md` (temp file + `mv`, plus a sanity check that the output actually looks like inbox frontmatter before swapping — this fail-safe is working as designed). A `SessionStart` hook (`session-start-inbox-check.py`) separately (1) fires a catch-up scan if none has run in >6h, and (2) prompts "run `/triage`" if the inbox has pending items.

**Current state:** the last **successful** scan recorded in `~/.local/share/pkb-scanner-last-run` is **2026-07-13T23:12:55Z** — roughly a week stale as of this audit. `~/Library/Logs/pkb-scanner.log` shows every run visible in the tail of the log (2026-07-16 through 2026-07-19) rejected by the wrapper's sanity check ("scanner output does not look like inbox.md — missing 'type: inbox' frontmatter", output preview empty), with one outright `claude exited 1` on 2026-07-17 — consistent with, though not individually confirmed for, the full 07-13→07-16 gap. The failure mode is safe (it aborts the swap rather than corrupting `inbox.md`) but silent: nothing surfaces this breakage to Phil beyond the log file and repeated, equally-doomed catch-up attempts triggered by the SessionStart hook. Root cause wasn't diagnosed further (out of scope for a read-only audit) but the symptom (empty/malformed headless output) suggests the headless `claude --print /scan` invocation itself is failing to produce a text response, not a logic bug in the wrapper.

Separately, `personal/phil/inbox.md` (450 KB) still carries at least one un-triaged "briefing-gated" item dated 2026-06-16 alongside a `last_compacted: 2026-07-12` marker — i.e. even when the scanner was running, the human-approval side of the loop had a backlog older than a month at last compaction.

**Net effect:** the wiki's currency (commits through 07-17) is being sustained by manual/interactive `/weekly-ingest` and `/triage` sessions, not by the automated background scanner, which has been non-functional for about a week and has an approval backlog predating that.

## 4. Untracked personal notes

`personal/` is excluded via `.gitignore` (`# Personal notes — local only, never committed`) and confirmed never committed (absent from `git log` history and `git status` shows it only as ignored, not untracked-and-visible). Contents, by subfolder:

- `personal/phil/inbox.md` + ~15 dated backup copies (`inbox-backup-YYYY-MM-DD.md`) — scanner staging surface and its history
- `personal/phil/slack/` — ~50 individual DM/group-DM mirrors, filed by date + counterpart name (private-sensitive Slack content, mirrored 1:1 from `raw/slack/` structure per the classification design)
- `personal/phil/daily notes/` — ~25 dated personal working notes
- `personal/phil/reflections/` — a small number of self-reflection notes, including at least one visibly HR/performance-adjacent (management-feedback) note
- `personal/phil/meetings/`, `personal/phil/hiring/`, `personal/phil/contributions/` — meeting notes, hiring/leveling notes, and a contributions index
- `personal/templates/` — a daily-note template

Total: 111 files, ~6.7 MB. This is squarely the "untracked personal notes" the migration decision (#18) needs to deal with — it already lives in one place, is already isolated by `.gitignore`, and is already classified by the vault's own scheme as `private-sensitive`.

**One exception found, worth flagging:** a single markdown file at the vault **root** (not under `personal/`) is untracked per `git status --porcelain` — meaning it is *not* protected by any `.gitignore` rule (only `personal/` and `.env` are excluded; nothing excludes stray root-level `.md` files). It is a draft feedback/thought-dump on a strategic topic, referencing a named colleague and a linked Google Doc — content that reads as private/pre-decisional rather than `public` wiki material, sitting outside the `personal/` safety net. It would be swept into a commit by an unqualified `git add -A`/`git add .`, unlike everything under `personal/`. Confirmed via `git log --all --full-history -- <that file>` that it has never actually been committed to any local ref (see §5).

## 5. Risk notes

- **Broken automation, not surfaced:** the background scanner has been silently failing since ~2026-07-13 (see §3b). No alert reaches Phil beyond a log file; the SessionStart catch-up logic just retries the same failing path. This is a reliability gap the capture-strategy decision (#16) should account for — the interactive path is currently doing all the real work.
- **Root-level file outside the gitignore safety net:** the draft strategic-feedback file (§4) is the one piece of plausibly-sensitive content that isn't structurally protected from being committed to the work-org remote. Checked definitively — **not just via recent `git log`, but `git log --all --full-history -- <path>`, which returns zero commits across every local ref (all branches, including `origin/*`)** — so it has never actually landed in history. It remains a live risk going forward, though, since nothing stops the next `git add -A` from picking it up.
- **Sensitive content committed to the work-org remote — checked, none found:** ran `git log --all --full-history --oneline -- personal/` across every local ref (branches + all `remotes/origin/*`) — zero results. `personal/` has never been committed, in any branch this clone knows about. Combined with the point above, no evidence of private-sensitive content ever reaching `primeslice/engagement-pkb`.
- **No secrets found in-repo:** `.env` (gitignored) holds only local filesystem paths to sibling repos, no credentials; `.env.example` mirrors the same non-secret shape. MCP auth for Slack/Atlassian is handled by the `claude` CLI's own config (`~/.claude/`), outside the vault, and per a comment in `.claude/scripts/pkb-scanner.plist.sample` this was already verified (2026-05-15) to carry over correctly into headless launchd sessions.
- **Mixed-sensitivity proximity, but by design and enforced:** `raw/` (public/whitelisted-shareable only) and `personal/` (private-sensitive) sit as sibling directories in the same working tree, mirroring each other's structure. This is intentional and actively enforced (tripwire hook + lint sweep + autonomy-tier rules), not an accident — the classification design looks sound on paper and the enforcement hook is real code, not just a policy statement in `CLAUDE.md`.
- **Approval backlog:** independent of the scanner outage, the briefing-gated queue in `inbox.md` had at least one item over a month old at last compaction — a process/attention gap rather than a security one, but relevant to whatever capture cadence #16 lands on.

## 6. Summary of health

| Path | Source(s) | Trigger | Destination | Sensitivity handled | Health |
|---|---|---|---|---|---|
| Interactive `/ingest`, `/weekly-ingest`, `/triage`, `/query` | Slack, Confluence, Jira, PagerDuty, Datadog, GitHub via MCP | Manual, in live Claude Code sessions | `wiki/` (via `raw/` staging) | public, private-shareable (whitelisted) | **Working** — commits through 2026-07-17 |
| Background `/scan light` (launchd, daily) | Slack DMs/whitelisted channels, PagerDuty, Jira | `launchd` StartCalendarInterval + SessionStart catch-up | `personal/phil/inbox.md` | private-sensitive (staging only) | **Broken** since ~2026-07-13 |
| Background `/scan deep` (launchd, weekly Fri) | Full surfaces matrix incl. Confluence RFC/ADR + comments | `launchd` StartCalendarInterval + SessionStart catch-up | `personal/phil/inbox.md` | private-sensitive (staging only) | **Broken** since ~2026-07-13 |
| Personal notes capture | Ad hoc (Phil writing directly, DM mirrors from scan) | Manual / scanner (when working) | `personal/phil/**` | private-sensitive | Accumulating (111 files, 6.7 MB), never committed — by design |
