#!/usr/bin/env python3
"""Scan Claude Code and pi agent transcripts for one *local* calendar day.

Why this exists: transcript timestamps are UTC, but a diary entry is a local
day. In Melbourne the local day starts at 13:00Z (AEDT) or 14:00Z (AEST), and
the first hand-rolled scan of this kind silently dropped most of a Monday by
using 00:00Z. This script owns the window arithmetic so no run re-derives it.

Usage:
  session_scan.py [--date YYYY-MM-DD] [--tz Australia/Melbourne]
                  [--format md|json] [--window] [--assistant]
                  [--max-chars N] [--root DIR ...]
  session_scan.py --since-last [--journal DIR] [--now ISO] [--format md|json]
  session_scan.py --range SPEC [--journal DIR] [--now ISO] [--format md|json]
  session_scan.py --label YYYY-MM-DD [YYYY-MM-DD ...]

  --window      print only the day window (UTC bounds, unix seconds, JQL/Slack
                fragments) and exit — handy for the other sources.
  --since-last  resolve the catch-up plan: start from the newest
                diary/YYYY-MM-DD.md on or before today and its last commit,
                and list every day from there to today that is missing, or
                whose evidence carries on after that commit. Each day comes
                with its window, so no run works out dates by hand.
  --range SPEC  resolve the days a range argument names: 2026-11-23..2026-11-26,
                11-23..11-26, 11-23..26, "since monday", "since 11-20",
                "last week", or a single day (yesterday, friday, 11-20).
  --now ISO     pin "now" (e.g. 2026-11-16T09:05+11:00) for evals and
                fixtures; default is the real time in --tz. Also sets the
                default --date.
  --journal DIR Journal root for --since-last/--range (default ~/Documents/Journal).
  --label D...  print the commit-subject label for these days
                (2026-11-23..26, 2026-11-28..12-02, 2026-11-20) and exit.
  --assistant   include assistant text snippets, not just user prompts.
  --max-chars   truncate each snippet (default 400; 0 = no truncation).
  --root        transcript roots to scan (repeatable). Defaults:
                ~/.claude/projects and ~/.pi/agent/sessions

Output (md): one section per session, grouped by working directory, with the
session's title (Claude only), local first/last activity time, slash commands
invoked, and the user prompts in order. Treat anything a session *claims* (PR
numbers, ticket keys, "done") as a lead to verify, not a fact.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

DEFAULT_ROOTS = [
    Path("~/.claude/projects").expanduser(),
    Path("~/.pi/agent/sessions").expanduser(),
]

# Harness-generated "user" turns that carry no first-person intent. They are
# dropped so the prompt list reads as what Phil actually asked for.
NOISE_PREFIXES = (
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<skill name=",  # pi skill injection
    "<system-reminder>",
    "<task-notification>",
    "Stop hook feedback:",
    "Another Claude session sent a message:",
    "This session is being continued from a previous conversation",
    "[Request interrupted",
)
COMMAND_RE = re.compile(r"<command-name>(?P<name>[^<]+)</command-name>(?:\s*<command-message>[^<]*</command-message>)?(?:\s*<command-args>(?P<args>[^<]*)</command-args>)?", re.S)
# Claude Code injects a skill body as a user turn beginning with this line;
# the skill name is worth keeping (it says what kind of work happened), the
# body is not.
SKILL_RE = re.compile(r"^Base directory for this skill: \S*/skills/(?P<name>[^/\s]+)")


@dataclass
class Session:
    tool: str
    session_id: str
    path: Path
    cwd: str = ""
    title: str = ""
    branch: str = ""
    first: datetime | None = None
    last: datetime | None = None
    prompts: list[tuple[datetime, str]] = field(default_factory=list)
    assistant: list[tuple[datetime, str]] = field(default_factory=list)
    commands: list[str] = field(default_factory=list)
    sidechain_lines: int = 0
    total_lines_in_window: int = 0

    def touch(self, ts: datetime) -> None:
        if self.first is None or ts < self.first:
            self.first = ts
        if self.last is None or ts > self.last:
            self.last = ts


def day_window(day: date, tz: ZoneInfo) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=tz)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def parse_ts(value) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        # pi stores epoch millis on message.timestamp; ISO on the envelope.
        if value > 1e12:
            value = value / 1000
        return datetime.fromtimestamp(value, tz=timezone.utc)
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def text_of(content) -> str:
    """Flatten a message content field (string or list of blocks) to text.

    tool_result blocks are skipped: they are tool output, not something the
    user or assistant said.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "\n".join(parts)
    return ""


def clean_prompt(text: str) -> tuple[str | None, str | None]:
    """Return (prompt_text, slash_command) after stripping harness noise."""
    stripped = text.strip()
    if not stripped:
        return None, None
    if stripped.startswith(NOISE_PREFIXES):
        return None, None
    m = COMMAND_RE.search(stripped)
    if m:
        name = m.group("name").strip()
        args = (m.group("args") or "").strip()
        label = f"{name} {args}".strip()
        return None, label
    m = SKILL_RE.match(stripped)
    if m:
        return None, f"skill:{m.group('name')}"
    return stripped, None


def truncate(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if limit and len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def scan_file(path: Path, start: datetime, end: datetime, want_assistant: bool) -> Session | None:
    tool = "claude" if ".claude" in path.parts else "pi"
    sess = Session(tool=tool, session_id=path.stem.split("_")[-1], path=path)
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    obj = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                kind = obj.get("type")

                # Session-level metadata (not time-filtered).
                if tool == "claude":
                    if kind == "ai-title":
                        sess.title = obj.get("aiTitle", sess.title)
                        continue
                    if obj.get("cwd") and not sess.cwd:
                        sess.cwd = obj["cwd"]
                    if obj.get("gitBranch") and not sess.branch:
                        sess.branch = obj["gitBranch"]
                    if obj.get("sessionId"):
                        sess.session_id = obj["sessionId"]
                else:
                    if kind == "session":
                        sess.cwd = obj.get("cwd", sess.cwd)
                        sess.session_id = obj.get("id", sess.session_id)
                        continue

                ts = parse_ts(obj.get("timestamp"))
                if ts is None or not (start <= ts < end):
                    continue
                sess.total_lines_in_window += 1
                if obj.get("isSidechain"):
                    sess.sidechain_lines += 1

                if tool == "claude":
                    if kind == "user":
                        prompt, cmd = clean_prompt(text_of(obj.get("message", {}).get("content")))
                    elif kind == "assistant" and want_assistant:
                        prompt, cmd = None, None
                        txt = text_of(obj.get("message", {}).get("content")).strip()
                        if txt:
                            sess.assistant.append((ts, txt))
                            sess.touch(ts)
                        continue
                    else:
                        sess.touch(ts)
                        continue
                else:  # pi
                    if kind != "message":
                        sess.touch(ts)
                        continue
                    msg = obj.get("message", {})
                    role = msg.get("role")
                    if role == "user":
                        prompt, cmd = clean_prompt(text_of(msg.get("content")))
                    elif role == "assistant" and want_assistant:
                        txt = text_of(msg.get("content")).strip()
                        if txt:
                            sess.assistant.append((ts, txt))
                            sess.touch(ts)
                        continue
                    else:
                        sess.touch(ts)
                        continue

                sess.touch(ts)
                if cmd:
                    sess.commands.append(cmd)
                if prompt:
                    sess.prompts.append((ts, prompt))
    except OSError as exc:
        print(f"warn: could not read {path}: {exc}", file=sys.stderr)
        return None

    if sess.total_lines_in_window == 0:
        return None
    return sess


def iter_transcripts(roots: list[Path], start: datetime):
    """Yield transcript files that could contain lines in the window.

    A file whose mtime precedes the window start cannot contain activity from
    the window, so it is skipped without being opened. Files modified later may
    still hold only older lines; the per-line filter handles those.
    """
    cutoff = start.timestamp()
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*.jsonl"):
            try:
                if path.stat().st_mtime < cutoff:
                    continue
            except OSError:
                continue
            yield path


def fmt_local(ts: datetime | None, tz: ZoneInfo) -> str:
    return ts.astimezone(tz).strftime("%H:%M") if ts else "--:--"


def render_md(sessions: list[Session], day: date, tz: ZoneInfo, start: datetime, end: datetime, max_chars: int, want_assistant: bool) -> str:
    out = [f"# Agent sessions on {day.isoformat()} ({tz.key})", "",
           f"Window: {start.isoformat()} → {end.isoformat()} (UTC). "
           f"{len(sessions)} session(s) with activity.", ""]
    by_cwd: dict[str, list[Session]] = defaultdict(list)
    for s in sessions:
        by_cwd[s.cwd or "(unknown cwd)"].append(s)
    for cwd in sorted(by_cwd):
        out.append(f"## {cwd}")
        out.append("")
        for s in sorted(by_cwd[cwd], key=lambda x: x.first or start):
            title = s.title or "(untitled)"
            branch = f" · branch `{s.branch}`" if s.branch else ""
            side = f" · {s.sidechain_lines} sidechain lines" if s.sidechain_lines else ""
            out.append(f"### [{s.tool}] {title} — {fmt_local(s.first, tz)}–{fmt_local(s.last, tz)}{branch}{side}")
            out.append(f"session `{s.session_id}` · `{s.path}`")
            if s.commands:
                out.append("commands: " + ", ".join(f"`{c}`" for c in s.commands))
            if s.prompts:
                out.append("")
                for ts, p in s.prompts:
                    out.append(f"- {fmt_local(ts, tz)} **user:** {truncate(p, max_chars)}")
            if want_assistant and s.assistant:
                out.append("")
                for ts, a in s.assistant:
                    out.append(f"- {fmt_local(ts, tz)} assistant: {truncate(a, max_chars)}")
            if not s.prompts and not (want_assistant and s.assistant):
                if s.commands:
                    out.append("- (only commands/skills in window, no free-text prompts)")
                else:
                    out.append("- (activity in window, but no user prompts — likely a resumed or background session)")
            out.append("")
    return "\n".join(out)


def render_json(sessions: list[Session], day: date, tz: ZoneInfo, start: datetime, end: datetime, max_chars: int) -> str:
    def enc(s: Session):
        return {
            "tool": s.tool,
            "session_id": s.session_id,
            "path": str(s.path),
            "cwd": s.cwd,
            "title": s.title,
            "branch": s.branch,
            "first_local": s.first.astimezone(tz).isoformat() if s.first else None,
            "last_local": s.last.astimezone(tz).isoformat() if s.last else None,
            "commands": s.commands,
            "prompts": [{"t": ts.astimezone(tz).isoformat(), "text": truncate(p, max_chars)} for ts, p in s.prompts],
            "assistant": [{"t": ts.astimezone(tz).isoformat(), "text": truncate(a, max_chars)} for ts, a in s.assistant],
            "sidechain_lines": s.sidechain_lines,
        }
    return json.dumps({
        "date": day.isoformat(),
        "tz": tz.key,
        "window_utc": [start.isoformat(), end.isoformat()],
        "sessions": [enc(s) for s in sessions],
    }, indent=2, ensure_ascii=False)


def window_info(day: date, tz: ZoneInfo, start: datetime, end: datetime) -> dict:
    nxt = day + timedelta(days=1)
    prev = day - timedelta(days=1)
    return {
        "date": day.isoformat(),
        "tz": tz.key,
        "utc_offset": datetime(day.year, day.month, day.day, 12, tzinfo=tz).strftime("%z"),
        "utc_start": start.isoformat(),
        "utc_end": end.isoformat(),
        "unix_start": int(start.timestamp()),
        "unix_end": int(end.timestamp()),
        # Slack's on:/after:/before: date modifiers are day-granular in the
        # workspace's timezone; the unix bounds above are exact.
        "slack_filters": f"on:{day.isoformat()}",
        "slack_unix": {"after": str(int(start.timestamp())), "before": str(int(end.timestamp()))},
        # JQL dates resolve in the Jira user's profile timezone; quote them.
        # `updated` alone is the *last* touch and misses issues someone else
        # touched later, and updatedBy() does not parse on this site, so use
        # history functions. DURING is end-inclusive: filter results by day.
        "jql_touched": (
            f'(reporter = currentUser() AND created >= "{day.isoformat()}" AND created < "{nxt.isoformat()}")'
            f' OR status CHANGED BY currentUser() DURING ("{day.isoformat()}", "{nxt.isoformat()}")'
            f' OR assignee CHANGED BY currentUser() DURING ("{day.isoformat()}", "{nxt.isoformat()}")'
            f' OR ((assignee = currentUser() OR watcher = currentUser())'
            f' AND updated >= "{day.isoformat()}" AND updated < "{nxt.isoformat()}")'
        ),
        # GitHub search `updated:` is UTC-day granular, so widen by a day each
        # side and filter precisely afterwards with the ISO bounds.
        "gh_updated_range": f"{prev.isoformat()}..{nxt.isoformat()}",
        "calendar_iso": {"start": start.isoformat(), "end": end.isoformat()},
    }


# ---------------------------------------------------------------------------
# Catch-up planning (--since-last, --range, --label)
#
# A bare /diary catches up instead of drafting only today. Working out which
# days that means is date arithmetic over local days, weekends and commit
# times, the same kind of arithmetic that once dropped most of a Monday, so it
# lives here, built on day_window, rather than being re-derived in a run.
# ---------------------------------------------------------------------------

WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
ENTRY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class SpecError(ValueError):
    pass


def parse_now(value: str | None, tz: ZoneInfo) -> datetime:
    if not value:
        return datetime.now(tz)
    ts = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=tz)
    return ts.astimezone(tz)


def _weekday_before(today: date, idx: int, include_today: bool) -> date:
    back = (today.weekday() - idx) % 7
    if back == 0 and not include_today:
        back = 7
    return today - timedelta(days=back)


def parse_day(token: str, today: date, base: date | None = None) -> date:
    """One end of a range. `base` lets the right end of 11-23..26 inherit
    year and month from the left end."""
    t = token.strip().lower()
    if t in ("today", "now"):
        return today
    if t == "yesterday":
        return today - timedelta(days=1)
    last = t.startswith("last ")
    name = t[5:].strip() if last else t
    for i, wd in enumerate(WEEKDAYS):
        if name in (wd, wd[:3]):
            # "friday" said on a Friday means today; "last friday" never does.
            return _weekday_before(today, i, include_today=not last)
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r"(\d{1,2})-(\d{1,2})", t)
    if m:
        month, dom = int(m.group(1)), int(m.group(2))
        if base is not None:
            # 12-30..01-02 crosses a year; 11-26..11-23 is just backwards
            return date(base.year + 1 if month < base.month else base.year, month, dom)
        d = date(today.year, month, dom)
        # a month-day later than today means the most recent one, last year
        return d if d <= today else date(today.year - 1, month, dom)
    m = re.fullmatch(r"(\d{1,2})", t)
    if m and base is not None:
        d = date(base.year, base.month, int(m.group(1)))
        if d < base:  # 11-28..02 rolls into the next month
            nm = date(base.year + (base.month // 12), base.month % 12 + 1, 1)
            d = date(nm.year, nm.month, int(m.group(1)))
        return d
    raise SpecError(f"cannot read {token!r} as a day")


def parse_spec(spec: str, today: date) -> tuple[date, date]:
    s = " ".join(spec.strip().lower().split())
    if s == "last week":
        monday = today - timedelta(days=today.weekday() + 7)
        return monday, monday + timedelta(days=6)
    if s == "this week":
        return today - timedelta(days=today.weekday()), today
    if s.startswith("since "):
        rest = s[6:].strip()
        # "since monday" means the most recent Monday before today, even when
        # said on a Monday (then it is a week; "today" would not need "since").
        for i, wd in enumerate(WEEKDAYS):
            if rest in (wd, wd[:3], "last " + wd):
                return _weekday_before(today, i, include_today=False), today
        return parse_day(rest, today), today
    if ".." in s:
        left, right = s.split("..", 1)
        start = parse_day(left, today)
        end = parse_day(right, today, base=start)
    else:
        start = end = parse_day(s, today)
    if end < start:
        raise SpecError(f"range {spec!r} ends before it starts")
    return start, end


def label_for(days: list[date]) -> str:
    """Commit-subject label in Phil's form: 2026-11-23..26, 2026-11-28..12-02."""
    if not days:
        return ""
    a, b = min(days), max(days)
    if a == b:
        return a.isoformat()
    if a.year != b.year:
        return f"{a.isoformat()}..{b.isoformat()}"
    if a.month != b.month:
        return f"{a.isoformat()}..{b.strftime('%m-%d')}"
    return f"{a.isoformat()}..{b.strftime('%d')}"


def _git(journal: Path, *args: str) -> str:
    import subprocess
    r = subprocess.run(["git", "-C", str(journal), *args], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def last_commit(journal: Path, rel: str, now: datetime) -> datetime | None:
    out = _git(journal, "log", "-1", "--format=%cI", f"--before={now.isoformat()}", "--", rel)
    return datetime.fromisoformat(out) if out else None


def diary_worktree_changes(journal: Path) -> list[str]:
    out = _git(journal, "status", "--porcelain", "--", "diary", "threads")
    return [l for l in out.splitlines() if l.strip()]


def journal_captures(journal: Path, day: date, now: datetime) -> list[str]:
    """Same-day captures that already existed at `now` (a pinned past now
    must not count a capture written later)."""
    iso = day.isoformat()
    pats = [f"captures/sessions/{iso}-*.md", f"captures/meetings-easygo/**/{iso}*.md", f"log/{iso} *.md"]
    cutoff = now.timestamp()
    hits: list[str] = []
    for pat in pats:
        for p in sorted(journal.glob(pat)):
            st = p.stat()
            born = getattr(st, "st_birthtime", st.st_mtime)
            if born <= cutoff:
                hits.append(str(p.relative_to(journal)))
    return hits


def agent_activity(day: date, tz: ZoneInfo, roots: list[Path], now: datetime, after: datetime | None = None) -> dict:
    """Cheap local evidence for a day: agent sessions with activity in its
    window (or in the part of it after `after`). Slack, Jira, GitHub and
    Calendar still have to be asked; this only says where to look first."""
    start, end = day_window(day, tz)
    end = min(end, now.astimezone(timezone.utc))  # a pinned now must not see its own future
    if after is not None:
        start = max(start, after.astimezone(timezone.utc))
    if start >= end:
        return {"sessions": 0, "prompts": 0, "titles": []}
    sessions = [s for s in (scan_file(p, start, end, False) for p in iter_transcripts(roots, start)) if s]
    sessions = [s for s in sessions if s.prompts or s.commands]
    return {"sessions": len(sessions), "prompts": sum(len(s.prompts) for s in sessions),
            "titles": sorted({s.title for s in sessions if s.title})[:8]}


def plan(journal: Path, tz: ZoneInfo, now: datetime, roots: list[Path], spec: str | None) -> dict:
    today = now.date()
    diary = journal / "diary"
    on_disk = {p.stem: p for p in diary.glob("*.md") if ENTRY_RE.match(p.stem)} if diary.exists() else {}
    notes: list[str] = []

    def describe(day: date) -> dict:
        iso = day.isoformat()
        start, end = day_window(day, tz)
        entry = on_disk.get(iso)
        info = {
            "date": iso,
            "weekday": WEEKDAYS[day.weekday()].capitalize(),
            "weekend": day.weekday() >= 5,
            "today": day == today,
            "window": window_info(day, tz, start, end),
        }
        if entry is None:
            info.update(status="new", entry=None, last_commit=None, evidence_after=None)
        else:
            commit = last_commit(journal, f"diary/{iso}.md", now)
            marker = commit
            if commit is None:
                # on disk but never committed (staged or untracked): the file's
                # mtime is the best "incorporated up to" marker there is
                marker = datetime.fromtimestamp(entry.stat().st_mtime, tz=timezone.utc)
                info["uncommitted"] = True
            info.update(entry=f"diary/{iso}.md",
                        last_commit=commit.astimezone(tz).isoformat() if commit else None,
                        evidence_after=marker.astimezone(tz).isoformat())
            # evidence for a day can only arrive inside its window, so an entry
            # last committed after its day ended is complete by construction
            info["status"] = "partial" if marker < end else "complete"
        after = datetime.fromisoformat(info["evidence_after"]) if info.get("evidence_after") else None
        info["local_evidence"] = {
            "agent": agent_activity(day, tz, roots, now, after if info["status"] == "partial" else None),
            "journal_captures": journal_captures(journal, day, now),
        }
        return info

    if spec:
        mode = "range"
        start, end = parse_spec(spec, today)
        if end > today:
            notes.append(f"range ends after today; clamped to {today.isoformat()}")
            end = today
        if start > today:
            raise SpecError(f"{spec!r} is in the future")
        anchor = None
    else:
        mode = "since-last"
        past = sorted(k for k in on_disk if k <= today.isoformat())
        if not past:
            anchor = None
            start = end = today
            notes.append("no earlier entry on disk; planning today only")
        else:
            anchor = past[-1]
            start, end = date.fromisoformat(anchor), today

    days = []
    d = start
    while d <= end:
        days.append(describe(d))
        d += timedelta(days=1)

    if mode == "since-last" and anchor and days and days[0]["status"] == "complete":
        # the newest entry is finished; the gap starts the day after it
        anchor_info = days.pop(0)
    else:
        anchor_info = days[0] if (mode == "since-last" and anchor) else None

    for i in days:
        if i["status"] == "complete" and mode == "range":
            i["status"] = "rerun"  # Phil named it; a re-run adds what the evidence has

    changes = diary_worktree_changes(journal)
    if changes:
        notes.append("diary/ or threads/ has uncommitted changes from outside this run; "
                     "commit with a pathspec so they are not swept in")
    return {
        "mode": mode,
        "spec": spec,
        "now": now.isoformat(),
        "today": today.isoformat(),
        "tz": tz.key,
        "journal": str(journal),
        "anchor": ({"date": anchor_info["date"], "status": anchor_info["status"],
                    "last_commit": anchor_info["last_commit"]} if anchor_info else None),
        "days": days,
        "label": label_for([date.fromisoformat(i["date"]) for i in days]),
        "uncommitted_diary_changes": changes,
        "notes": notes,
    }


STATUS_WORDS = {
    "new": "no entry yet",
    "partial": "entry exists; evidence may continue after its last commit",
    "complete": "entry complete",
    "rerun": "entry complete; re-run because the range names it",
}


def render_plan_md(p: dict) -> str:
    head = "Catch-up since the last entry" if p["mode"] == "since-last" else f"Range {p['spec']!r}"
    out = [f"# {head} — {len(p['days'])} day(s), label {p['label'] or '(none)'}", "",
           f"Now: {p['now']} ({p['tz']}). Journal: {p['journal']}"]
    if p.get("anchor"):
        a = p["anchor"]
        out.append(f"Newest entry: {a['date']} ({a['status']}, last commit {a['last_commit'] or 'never'})")
    out.append("")
    for i in p["days"]:
        tags = [i["weekday"]]
        if i["weekend"]:
            tags.append("weekend")
        if i["today"]:
            tags.append("today, still in progress")
        if i.get("uncommitted"):
            tags.append("uncommitted file")
        ag = i["local_evidence"]["agent"]
        caps = i["local_evidence"]["journal_captures"]
        after = f" after {i['evidence_after'][11:16]}" if i["status"] == "partial" else ""
        out.append(f"- **{i['date']}** ({', '.join(tags)}): {STATUS_WORDS[i['status']]}"
                   + (f" ({i['evidence_after'][:16].replace('T', ' ')})" if i["status"] == "partial" else ""))
        out.append(f"  - window {i['window']['utc_start']} → {i['window']['utc_end']} (UTC{i['window']['utc_offset']})")
        out.append(f"  - local evidence{after}: {ag['sessions']} agent session(s), {ag['prompts']} prompt(s); "
                   f"{len(caps)} Journal capture(s)")
    for n in p["notes"]:
        out.append(f"\nNote: {n}")
    if p["uncommitted_diary_changes"]:
        out.append("Uncommitted: " + "; ".join(p["uncommitted_diary_changes"]))
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="local calendar day, YYYY-MM-DD (default: today)")
    ap.add_argument("--tz", default=os.environ.get("DIARY_TZ", "Australia/Melbourne"))
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--window", action="store_true", help="print the day window and exit")
    ap.add_argument("--assistant", action="store_true", help="include assistant text snippets")
    ap.add_argument("--max-chars", type=int, default=400)
    ap.add_argument("--root", action="append", type=Path, help="transcript root (repeatable)")
    ap.add_argument("--now", help="pin 'now' (ISO datetime); default is the real time")
    ap.add_argument("--journal", default="~/Documents/Journal", help="Journal root for --since-last/--range")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--since-last", action="store_true", help="resolve the catch-up plan and exit")
    mode.add_argument("--range", metavar="SPEC", help="resolve a range argument's days and exit")
    mode.add_argument("--label", nargs="+", metavar="DAY", help="print the commit label for these days and exit")
    args = ap.parse_args(argv)

    tz = ZoneInfo(args.tz)
    now = parse_now(args.now, tz)
    roots = [p.expanduser() for p in args.root] if args.root else DEFAULT_ROOTS

    if args.label:
        print(label_for([date.fromisoformat(d) for d in args.label]))
        return 0
    if args.since_last or args.range:
        try:
            p = plan(Path(args.journal).expanduser(), tz, now, roots, args.range)
        except SpecError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(p, indent=2, ensure_ascii=False) if args.format == "json" else render_plan_md(p))
        return 0

    day = date.fromisoformat(args.date) if args.date else now.date()
    start, end = day_window(day, tz)

    if args.window:
        print(json.dumps(window_info(day, tz, start, end), indent=2))
        return 0

    sessions = []
    # with --now pinned (evals, fixtures) the scan must not see past it
    scan_end = min(end, now.astimezone(timezone.utc))
    for path in iter_transcripts(roots, start):
        s = scan_file(path, start, scan_end, args.assistant)
        if s:
            sessions.append(s)
    sessions.sort(key=lambda s: (s.cwd, s.first or start))

    if args.format == "json":
        print(render_json(sessions, day, tz, start, end, args.max_chars))
    else:
        print(render_md(sessions, day, tz, start, end, args.max_chars, args.assistant))
    return 0


if __name__ == "__main__":
    sys.exit(main())
