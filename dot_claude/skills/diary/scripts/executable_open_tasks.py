#!/usr/bin/env python3
"""List the diary tasks that belong in a given day's entry.

Why this exists: tasks live in the entry where they arose. Which of them
should appear in today's draft is a deterministic question that was being
answered by feel: undated open tasks carry forward from the previous entry;
tasks with a due date stay put until their day; practices and far-future
items should not clutter every day in between. This script answers it.

Usage:
  open_tasks.py [--date YYYY-MM-DD] [--journal ~/Documents/Journal] [--format md|json]

Conventions it reads:
  - Tasks are `- [ ]` / `- [x]` lines under `## Tasks` in diary/YYYY-MM-DD.md.
  - A due date is an ISO date in the task line that is not inside a
    [[wikilink]] and is on or after the entry's own date, or an Obsidian
    Tasks `📅 YYYY-MM-DD` marker. "(Fri 2026-10-09)" therefore counts.
  - The same task may appear in several entries (carried copies). Its
    state is the state in the latest entry that mentions it.

Output buckets for the target day:
  due        open, due on the target day (or overdue)
  carry      open, undated, last seen in the previous entry
  stale      open, undated, last seen in an older entry (decide: carry or drop)
  future     open, due after the target day (leave where it is)
  in_entry   tasks already present in the target day's own entry, if it exists
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ISO_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
WIKI_RE = re.compile(r"\[\[[^\]]*\]\]")
TASK_RE = re.compile(r"^\s*- \[( |x|X)\] (.*)$")
FROM_RE = re.compile(r"\s*\((?:from|carried from) \[\[[^\]]*\]\]\)\s*$")


def norm(text: str) -> str:
    text = FROM_RE.sub("", text)
    text = re.sub(r"\s*\[Phil:[^\]]*\]", "", text)
    text = re.sub(r"\([^)]*\)$", "", text.strip())  # trailing evidence/parenthetical
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text[:120]


def due_date_of(text: str, entry_day: date) -> date | None:
    stripped = WIKI_RE.sub("", text)
    m = re.search(r"📅\s*(\d{4}-\d{2}-\d{2})", stripped)
    cands = [m.group(1)] if m else ISO_RE.findall(stripped)
    for c in cands:
        try:
            d = date.fromisoformat(c)
        except ValueError:
            continue
        # A date equal to the entry's own day is a reference ("EU done
        # 2026-07-17"), not a due date; only a later date schedules a task.
        if d > entry_day or (m and d >= entry_day):
            return d
    return None


PARENT_RE = re.compile(r"^- (?:\[[ xX]\] )?(?:\*\*)?(.*?)(?:\*\*)?\s*$")


def tasks_in(path: Path) -> list[tuple[bool, str, str | None]]:
    """(done, text, parent) for each task line under ## Tasks.

    Tasks may be grouped one level deep under a parent line (a parent task
    or a bold label); the parent is carried with the child so grouping
    survives carry-forward.
    """
    out, in_tasks, parent = [], False, None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("## "):
            in_tasks = line.strip() == "## Tasks"
            continue
        if not in_tasks:
            continue
        m = TASK_RE.match(line)
        if m:
            indented = line.startswith((" ", "\t"))
            text = m.group(2).strip()
            if indented:
                out.append((m.group(1).lower() == "x", text, parent))
            else:
                out.append((m.group(1).lower() == "x", text, None))
                parent = text
        elif line.startswith("- "):
            pm = PARENT_RE.match(line.rstrip())
            parent = pm.group(1).strip() if pm else None
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date")
    ap.add_argument("--journal", default="~/Documents/Journal")
    ap.add_argument("--format", choices=["md", "json"], default="md")
    ap.add_argument("--stale-days", type=int, default=21,
                    help="only list stale tasks from entries within this many days (older ones are counted); 0 = all")
    args = ap.parse_args(argv)

    target = date.fromisoformat(args.date) if args.date else datetime.now(ZoneInfo("Australia/Melbourne")).date()
    diary = Path(args.journal).expanduser() / "diary"
    entries = sorted(p for p in diary.glob("*.md") if re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem))

    # latest state per normalised task, over entries strictly before the target
    latest: dict[str, dict] = {}
    previous_entry: date | None = None
    for p in entries:
        d = date.fromisoformat(p.stem)
        if d >= target:
            continue
        previous_entry = d
        for done, text, parent in tasks_in(p):
            key = norm(text)
            latest[key] = {"text": text, "done": done, "origin": p.stem, "due": due_date_of(text, d), "parent": parent}
            # keep the first origin we saw for provenance
            latest[key].setdefault("first_origin", p.stem)

    in_entry = []
    target_file = diary / f"{target.isoformat()}.md"
    if target_file.exists():
        in_entry = [{"text": t, "done": done, "parent": parent} for done, t, parent in tasks_in(target_file)]
    in_entry_keys = {norm(t["text"]) for t in in_entry}

    buckets = {"due": [], "carry": [], "stale": [], "future": [], "in_entry": in_entry}
    older_stale = 0
    for key, t in latest.items():
        if t["done"] or key in in_entry_keys or not key.strip():
            continue
        if (not t["due"] and previous_entry and t["origin"] != previous_entry.isoformat()
                and args.stale_days and (target - date.fromisoformat(t["origin"])).days > args.stale_days):
            older_stale += 1
            continue
        item = {"text": t["text"], "origin": t["origin"], "due": t["due"].isoformat() if t["due"] else None, "parent": t.get("parent")}
        if t["due"]:
            if t["due"] <= target:
                item["overdue"] = t["due"] < target
                buckets["due"].append(item)
            else:
                buckets["future"].append(item)
        elif previous_entry and t["origin"] == previous_entry.isoformat():
            buckets["carry"].append(item)
        else:
            buckets["stale"].append(item)

    if args.format == "json":
        print(json.dumps({"date": target.isoformat(), "previous_entry": previous_entry.isoformat() if previous_entry else None,
                          "older_stale_not_listed": older_stale, **buckets}, indent=2, ensure_ascii=False))
        return 0

    print(f"# Tasks for {target.isoformat()} (previous entry: {previous_entry or 'none'})\n")
    if older_stale:
        print(f"({older_stale} open tasks older than {args.stale_days} days not listed; --stale-days 0 shows them)\n")
    labels = {
        "due": "Due on or before this day (open)",
        "carry": "Carry forward from the previous entry (open, undated)",
        "stale": "Open in older entries, not carried since (decide: carry, tick, or drop)",
        "future": "Due later (leave in their entry)",
        "in_entry": "Already in this day's entry",
    }
    for b in ("due", "carry", "stale", "future", "in_entry"):
        items = buckets[b]
        print(f"## {labels[b]} — {len(items)}")
        for it in items:
            under = f" · under \"{it['parent']}\"" if it.get("parent") else ""
            if b == "in_entry":
                print(f"- [{'x' if it['done'] else ' '}] {it['text']}{under}")
            else:
                tag = f" · due {it['due']}" if it.get("due") else ""
                od = " · OVERDUE" if it.get("overdue") else ""
                print(f"- {it['text']}  (from [[{it['origin']}]]{tag}{od}{under})")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
