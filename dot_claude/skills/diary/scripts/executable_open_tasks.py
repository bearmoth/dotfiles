#!/usr/bin/env python3
"""List the diary tasks that belong in a given day's entry.

Why this exists: tasks live in the entry where they arose. Which of them
should appear in today's draft is a deterministic question that was being
answered by feel: undated open tasks carry forward from the previous entry;
tasks with a due date stay put until their day; practices and far-future
items should not clutter every day in between. This script answers it, and
it also catches the two ways a task gets dropped by accident: a task that
was reworded (so its old wording looks "open" forever) and a child task
whose parent was reworded (so the child silently falls off).

Usage:
  open_tasks.py [--date YYYY-MM-DD] [--journal ~/Documents/Journal] [--format md|json]

Conventions it reads:
  - Tasks are `- [ ]` / `- [x]` lines under `## Tasks` in diary/YYYY-MM-DD.md.
  - A due date is an ISO date in the task line that is not inside a
    [[wikilink]] and is on or after the entry's own date, or an Obsidian
    Tasks `📅 YYYY-MM-DD` marker. "(Fri 2026-10-09)" therefore counts.
  - The same task may appear in several entries (carried copies). Its
    state is the state in the latest entry that mentions it.
  - A task "supersedes" an older one when the wording is close, when the
    old wording is a prefix of the new, or when every PR number / ticket
    key in the old one appears in the new one.

Output buckets for the target day:
  due         open, due on the target day (or overdue)
  carry       open, undated, last seen in the previous entry
  reworded    carry/due items that this day's entry already holds under a
              new wording (nothing to do)
  stale       open, undated, last seen in an older entry and not superseded
              (decide: carry, tick, or drop). Flags a child whose parent's
              thread is still open: that is the dropped-ball signature.
  superseded  older wordings of a task that is still open (ignore)
  future      open, due after the target day (leave where it is)
  in_entry    tasks already present in the target day's own entry, if it exists
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from difflib import SequenceMatcher
from pathlib import Path
from zoneinfo import ZoneInfo

ISO_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
WIKI_RE = re.compile(r"\[\[[^\]]*\]\]")
TASK_RE = re.compile(r"^\s*- \[( |x|X)\] (.*)$")
FROM_RE = re.compile(r"\s*\((?:from|carried from) \[\[[^\]]*\]\]\)\s*$")
ID_RE = re.compile(r"#\d{3,}|\b[A-Z][A-Z0-9]+-\d+\b")
LEAD_WIKI_RE = re.compile(r"^\s*\[\[([^\]|#]+)")
MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")


def norm(text: str) -> str:
    text = re.sub(r"\s*\[Phil:[^\]]*\]", "", text)
    text = MD_LINK_RE.sub(r"\1", text)  # [#123](url) -> #123
    prev = None
    while prev != text:  # strip "(from [[d]])", evidence, and date parentheticals, in any order
        prev = text
        text = FROM_RE.sub("", text)
        text = re.sub(r"\s*\([^()]*\)$", "", text.strip())
    text = re.sub(r"\s+", " ", text).strip().lower()
    return text[:160]


def ids_of(text: str) -> set[str]:
    return set(ID_RE.findall(MD_LINK_RE.sub(r"\1", text)))


def thread_of(text: str) -> str | None:
    m = LEAD_WIKI_RE.match(text)
    return m.group(1).strip() if m else None


def supersedes(new_text: str, old_text: str) -> bool:
    n_new, n_old = norm(new_text), norm(old_text)
    if not n_old or n_new == n_old:
        return n_new == n_old
    ratio = SequenceMatcher(None, n_new, n_old).ratio()
    if ratio >= 0.6:
        return True
    if len(n_old) >= 12 and n_new.startswith(n_old):
        return True
    old_ids = ids_of(old_text)
    if old_ids and old_ids <= ids_of(new_text) and ratio >= 0.3:
        return True
    return False


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


def short(text: str, n: int = 60) -> str:
    text = MD_LINK_RE.sub(r"\1", text)
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


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
            first = latest.get(key, {}).get("first_origin", p.stem)
            latest[key] = {"text": text, "done": done, "origin": p.stem, "due": due_date_of(text, d),
                           "parent": parent, "first_origin": first}

    in_entry = []
    target_file = diary / f"{target.isoformat()}.md"
    if target_file.exists():
        in_entry = [{"text": t, "done": done, "parent": parent} for done, t, parent in tasks_in(target_file)]
    in_entry_keys = {norm(t["text"]) for t in in_entry}
    in_entry_open = [t["text"] for t in in_entry if not t["done"]]
    in_entry_all = [t["text"] for t in in_entry]

    def find_superseder(old_text: str, pool: list[str]) -> str | None:
        for cur in pool:
            if supersedes(cur, old_text):
                return cur
        return None

    buckets = {"due": [], "carry": [], "reworded": [], "stale": [], "superseded": [], "future": [], "in_entry": in_entry}
    older_stale = 0
    prev_iso = previous_entry.isoformat() if previous_entry else None
    candidates = []
    for key, t in latest.items():
        if t["done"] or key in in_entry_keys or not key.strip():
            continue
        if (not t["due"] and prev_iso and t["origin"] != prev_iso
                and args.stale_days and (target - date.fromisoformat(t["origin"])).days > args.stale_days):
            older_stale += 1
            continue
        candidates.append(t)

    # Current wordings: open in this day's entry, plus what carries from the previous entry.
    carry_texts = [t["text"] for t in candidates if not t["due"] and t["origin"] == prev_iso]
    current_pool = in_entry_open + carry_texts
    current_threads = {th for th in (thread_of(x) for x in current_pool) if th}

    # newest first so an older wording attaches to the newest surviving one
    candidates.sort(key=lambda t: t["origin"], reverse=True)
    kept_stale: list[dict] = []
    for t in candidates:
        item = {"text": t["text"], "origin": t["origin"], "first_origin": t["first_origin"],
                "due": t["due"].isoformat() if t["due"] else None, "parent": t.get("parent")}
        by = find_superseder(t["text"], in_entry_all)  # a ticked rewording counts too
        if t["due"]:
            if by:
                item["superseded_by"] = by
                buckets["reworded"].append(item)
            elif t["due"] <= target:
                item["overdue"] = t["due"] < target
                buckets["due"].append(item)
            else:
                buckets["future"].append(item)
            continue
        if t["origin"] == prev_iso:
            if by:
                item["superseded_by"] = by
                buckets["reworded"].append(item)
            else:
                buckets["carry"].append(item)
            continue
        by = by or find_superseder(t["text"], carry_texts)
        if by:
            item["superseded_by"] = by
            buckets["superseded"].append(item)
            continue
        older = next((k for k in kept_stale if supersedes(k["text"], t["text"])), None)
        if older:
            older.setdefault("earlier_origins", []).append(t["origin"])
            continue
        parent_thread = thread_of(t["parent"]) if t.get("parent") else None
        if parent_thread and parent_thread in current_threads:
            item["parent_thread_open"] = parent_thread
        kept_stale.append(item)
    buckets["stale"] = kept_stale

    if args.format == "json":
        print(json.dumps({"date": target.isoformat(), "previous_entry": prev_iso,
                          "older_stale_not_listed": older_stale, **buckets}, indent=2, ensure_ascii=False))
        return 0

    print(f"# Tasks for {target.isoformat()} (previous entry: {previous_entry or 'none'})\n")
    if older_stale:
        print(f"({older_stale} open tasks older than {args.stale_days} days not listed; --stale-days 0 shows them)\n")
    labels = {
        "due": "Due on or before this day (open): must appear, open or ticked with evidence",
        "carry": "Carry forward from the previous entry (open, undated): must appear, open or ticked with evidence",
        "reworded": "Already in this day's entry under a new wording (nothing to do)",
        "stale": "Open in older entries, not carried since (decide: carry, tick, or drop; never drop silently)",
        "superseded": "Older wordings of a task still open (ignore)",
        "future": "Due later (leave in their entry)",
        "in_entry": "Already in this day's entry",
    }
    for b in ("due", "carry", "reworded", "stale", "superseded", "future", "in_entry"):
        items = buckets[b]
        print(f"## {labels[b]} — {len(items)}")
        for it in items:
            under = f" · under \"{short(it['parent'])}\"" if it.get("parent") else ""
            if b == "in_entry":
                print(f"- [{'x' if it['done'] else ' '}] {it['text']}{under}")
            elif b in ("reworded", "superseded"):
                print(f"- {short(it['text'], 90)}  (from [[{it['origin']}]]) → now: {short(it['superseded_by'], 90)}")
            else:
                tag = f" · due {it['due']}" if it.get("due") else ""
                od = " · OVERDUE" if it.get("overdue") else ""
                earlier = f" · earlier wordings {', '.join(f'[[{o}]]' for o in it['earlier_origins'])}" if it.get("earlier_origins") else ""
                flag = (f"\n  ⚠ child of a reworded parent; thread [[{it['parent_thread_open']}]] is still open: "
                        f"carry it under the current [[{it['parent_thread_open']}]] task or drop it with a reason"
                        if it.get("parent_thread_open") else "")
                print(f"- {it['text']}  (from [[{it['origin']}]]{tag}{od}{under}{earlier}){flag}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
