"""ADR-0009 pipeline: eos-queue CLI, the Stop-hook queue nudge, and the
queue+ledger pulse. Everything runs against tmp_path state — no live
registry, no vault mounts."""

import argparse
import json
import pathlib
import time

import pytest

from conftest import REPO, _load

QUEUE = REPO / "dot_local" / "bin" / "executable_eos-queue"
STOP = REPO / "dot_claude" / "hooks" / "executable_eos-stop.py"


@pytest.fixture
def queue(tmp_path, monkeypatch):
    mod = _load(QUEUE, "eos_queue")
    monkeypatch.setattr(mod, "STATE", str(tmp_path / "state"))
    monkeypatch.setattr(mod, "REGISTRY", str(tmp_path / "registry.json"))
    return mod


def add_args(**kw):
    base = dict(
        kind="work-record", title="t", body="b", context="personal",
        repo=None, ticket=None, branch=None, session="s1", sensitivity=None,
    )
    base.update(kw)
    return argparse.Namespace(**base)


def entries(mod):
    return mod.read_entries(mod.queue_path())


# ------------------------------------------------------------ eos-queue ----


def test_add_stamps_and_degrades_machine_loudly(queue):
    # No registry file at all -> UNRESOLVED-<host>, never a silent fallback.
    assert queue.add(add_args(repo="bearmoth/dotfiles", ticket="ABC-1", branch="main")) == 0
    (rec,) = entries(queue)
    assert rec["kind"] == "work-record"
    assert rec["machine"].startswith("UNRESOLVED-")
    assert rec["session"] == "s1"
    assert rec["attribution"] == {
        "context": "personal", "repo": "bearmoth/dotfiles",
        "ticket": "ABC-1", "branch": "main",
    }
    assert rec["id"] and rec["ts"][:4].isdigit()
    assert "sensitivity" not in rec


def test_add_uses_declared_machine_id(queue, tmp_path):
    (tmp_path / "registry.json").write_text(json.dumps({"machine": {"id": "mbp-work"}}))
    assert queue.add(add_args()) == 0
    (rec,) = entries(queue)
    assert rec["machine"] == "mbp-work"


def test_sensitivity_rejected_on_work_record(queue):
    assert queue.add(add_args(sensitivity="org-ok")) == 2
    assert entries(queue) == []


def test_knowledge_sensitivity_defaults_down(queue):
    assert queue.add(add_args(kind="knowledge")) == 0
    assert queue.add(add_args(kind="knowledge", sensitivity="org-ok")) == 0
    unsure, ok = entries(queue)
    assert unsure["sensitivity"] == "unsure"
    assert ok["sensitivity"] == "org-ok"


def test_drain_archives_by_id_and_is_idempotent(queue):
    queue.add(add_args(title="one"))
    queue.add(add_args(title="two"))
    a, b = entries(queue)
    assert queue.drain(argparse.Namespace(done=[a["id"]])) == 0
    (left,) = entries(queue)
    assert left["id"] == b["id"]
    (archived,) = queue.read_entries(queue.drained_path())
    assert archived["id"] == a["id"] and archived["drained_ts"]
    # Unknown / already-drained ids are reported, not fatal.
    assert queue.drain(argparse.Namespace(done=[a["id"]])) == 0
    assert len(entries(queue)) == 1


def test_list_tolerates_absence(queue):
    assert entries(queue) == []


# ------------------------------------------------------------- stop hook ----


MOUNTS = {
    "contexts": {
        "easygo": {"vaults": {"wiki": {"name": "PKB", "path": "/vaults/pkb"}}},
        "personal": {"vaults": {"journal": {"name": "Journal", "path": "/vaults/journal"}}},
    }
}


def run_stop(tmp_path, monkeypatch, capsys, context):
    mod = _load(STOP, "eos_stop")
    monkeypatch.setattr(mod, "STATE", str(tmp_path / "state"))
    transcript = tmp_path / "transcript.jsonl"
    edit = json.dumps({"message": {"content": [{"type": "tool_use", "name": "Edit", "input": {}}]}})
    transcript.write_text((edit + "\n") * 5)
    ctx = {
        "context": context, "branch": "main", "ticket": None,
        "repo": {"slug": "bearmoth/dotfiles"},
    }
    monkeypatch.setattr(
        mod, "eos_json",
        lambda args: ctx if args[0] == "context" else MOUNTS,
    )
    mod.main({
        "session_id": f"sess-{context}",  # one nudge per session, by design
        "transcript_path": str(transcript),
        "cwd": str(tmp_path),
    })
    out = capsys.readouterr().out
    return json.loads(out)["reason"] if out.strip() else None


def test_stop_nudges_queue_never_wiki(tmp_path, monkeypatch, capsys):
    reason = run_stop(tmp_path, monkeypatch, capsys, "easygo")
    assert "eos-queue add --kind work-record" in reason
    assert "--context easygo" in reason
    assert "--session sess-easygo" in reason
    assert "--kind knowledge" in reason
    assert "log/" not in reason  # no wiki worklog task, ever (ADR-0009)


def test_stop_capture_only_for_journal_context(tmp_path, monkeypatch, capsys):
    assert "SESSION CAPTURE" not in run_stop(tmp_path, monkeypatch, capsys, "easygo")
    assert "SESSION CAPTURE" in run_stop(tmp_path, monkeypatch, capsys, "personal")


# ----------------------------------------------------------------- pulse ----


def iso(days_ago):
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(time.time() - days_ago * 86400))


def day(days_ago):
    return time.strftime("%Y-%m-%d", time.localtime(time.time() - days_ago * 86400))


def test_worklog_ages_merge_queue_and_ledger(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    state = tmp_path / "state"
    state.mkdir()
    (state / "queue.jsonl").write_text(
        json.dumps({"kind": "work-record", "ts": iso(0), "machine": "mbp-work",
                    "attribution": {"context": "easygo"}}) + "\n"
    )
    (state / "queue-drained.jsonl").write_text(
        json.dumps({"kind": "work-record", "ts": iso(9), "machine": "mbp-work",
                    "attribution": {"context": "personal"}}) + "\n"
    )
    journal = tmp_path / "journal"
    logdir = journal / "log"
    logdir.mkdir(parents=True)
    # Ledger note: explicit about: wins; synced from another machine.
    (logdir / f"{day(2)} metabox.md").write_text("---\ntags: [type/worklog]\nabout: [easygo]\n---\n")
    # No about: -> inherits the journal's own context.
    (logdir / f"{day(4)} mbp-work.md").write_text("---\ntags: [type/worklog]\n---\n")

    ages, count, oldest, unresolved = resolver.worklog_ages(str(journal), "personal")
    assert ages["easygo"] == 0        # fresh queue entry beats the 2d ledger note
    assert ages["personal"] == 4      # ledger note beats the 9d drained entry
    assert count == 1 and oldest == 0 and unresolved is False


def test_pulse_flags_undeclared_machine_immediately(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    state = tmp_path / "state"
    state.mkdir()
    (state / "queue.jsonl").write_text(
        json.dumps({"kind": "work-record", "ts": iso(0),
                    "machine": "UNRESOLVED-MacBook-Pro",
                    "attribution": {"context": "personal"}}) + "\n"
    )
    reg = {"contexts": {"personal": {"vaults": {}}}}
    lines, data = resolver.compute_pulse(reg)
    assert data["queue"]["unresolved_machine"] is True
    assert any("UNDECLARED machine.id" in l for l in lines)


def test_pulse_queue_line_gates_on_age(resolver, tmp_path, monkeypatch):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    state = tmp_path / "state"
    state.mkdir()
    (state / "queue.jsonl").write_text(
        json.dumps({"kind": "work-record", "ts": iso(10), "machine": "mbp-work",
                    "attribution": {"context": "personal"}}) + "\n"
    )
    reg = {"contexts": {"personal": {"vaults": {}}}}
    lines, data = resolver.compute_pulse(reg)
    assert data["queue"] == {"count": 1, "oldest_days": 10, "unresolved_machine": False}
    assert any(l.startswith("queue: 1 pending, oldest 10d") for l in lines)
