"""Pulse queue line (ADR-0009): distinguish "machine.id never declared" (the
chezmoi init remedy) from "id declared but entries pre-date it" (drain to
clear — re-running init cannot rewrite already-stamped entries)."""

import json
import time


def iso(days_ago=0):
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(time.time() - days_ago * 86400))


def seed_queue(tmp_path, resolver, monkeypatch, machine_stamp):
    monkeypatch.setattr(resolver, "STATE", str(tmp_path / "state"))
    state = tmp_path / "state"
    state.mkdir()
    (state / "queue.jsonl").write_text(
        json.dumps({"kind": "work-record", "ts": iso(), "machine": machine_stamp,
                    "attribution": {"context": "personal"}}) + "\n"
    )


def test_undeclared_id_says_chezmoi_init(resolver, tmp_path, monkeypatch):
    seed_queue(tmp_path, resolver, monkeypatch, "UNRESOLVED-MacBook-Pro")
    reg = {"contexts": {"personal": {"vaults": {}}}}  # no machine.id declared
    lines, data = resolver.compute_pulse(reg)
    assert data["queue"]["unresolved_machine"] is True
    (qline,) = [l for l in lines if l.startswith("queue:")]
    assert "UNDECLARED machine.id" in qline
    assert "chezmoi init" in qline


def test_declared_id_with_stale_stamps_says_drain(resolver, tmp_path, monkeypatch):
    seed_queue(tmp_path, resolver, monkeypatch, "UNRESOLVED-MacBook-Pro")
    reg = {"machine": {"id": "easygo-laptop"},
           "contexts": {"personal": {"vaults": {}}}}
    lines, data = resolver.compute_pulse(reg)
    assert data["queue"]["unresolved_machine"] is True
    (qline,) = [l for l in lines if l.startswith("queue:")]
    assert "UNRESOLVED-MacBook-Pro" in qline
    assert "queued before machine.id was declared" in qline
    assert "drain to clear" in qline
    assert "chezmoi init" not in qline  # init already taken; don't resuggest


def test_declared_id_clean_stamps_stays_quiet(resolver, tmp_path, monkeypatch):
    seed_queue(tmp_path, resolver, monkeypatch, "easygo-laptop")
    reg = {"machine": {"id": "easygo-laptop"},
           "contexts": {"personal": {"vaults": {}}}}
    lines, data = resolver.compute_pulse(reg)
    assert data["queue"]["unresolved_machine"] is False
    assert not [l for l in lines if "UNDECLARED" in l or "UNRESOLVED" in l]
