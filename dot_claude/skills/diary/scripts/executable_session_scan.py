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

  --window      print only the day window (UTC bounds, unix seconds, JQL/Slack
                fragments) and exit — handy for the other sources.
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", help="local calendar day, YYYY-MM-DD (default: today)")
    ap.add_argument("--tz", default=os.environ.get("DIARY_TZ", "Australia/Melbourne"))
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--window", action="store_true", help="print the day window and exit")
    ap.add_argument("--assistant", action="store_true", help="include assistant text snippets")
    ap.add_argument("--max-chars", type=int, default=400)
    ap.add_argument("--root", action="append", type=Path, help="transcript root (repeatable)")
    args = ap.parse_args(argv)

    tz = ZoneInfo(args.tz)
    day = date.fromisoformat(args.date) if args.date else datetime.now(tz).date()
    start, end = day_window(day, tz)

    if args.window:
        print(json.dumps(window_info(day, tz, start, end), indent=2))
        return 0

    roots = [p.expanduser() for p in args.root] if args.root else DEFAULT_ROOTS
    sessions = []
    for path in iter_transcripts(roots, start):
        s = scan_file(path, start, end, args.assistant)
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
