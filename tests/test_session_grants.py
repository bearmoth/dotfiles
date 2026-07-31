"""Session grants (ask once per (session, vault), not per write): PostToolUse
records a grant when a cross-context org write actually executed; the next
PreToolUse ask for the same (session, vault-root) allows under that grant.
Grants never cross sessions or vaults, never launder taint, and age out."""

import io
import json
import os
import time
from contextlib import redirect_stdout


def _run(taint_gate, monkeypatch, world, payload, tmp_path, session_ctx):
    monkeypatch.setattr(taint_gate, "get_vaults", lambda: world)
    monkeypatch.setattr(taint_gate, "get_session_context", lambda cwd: session_ctx)
    monkeypatch.setattr(taint_gate, "STATE", str(tmp_path))
    buf = io.StringIO()
    with redirect_stdout(buf):
        taint_gate.main(payload)
    out = buf.getvalue().strip()
    return json.loads(out) if out else None


def write_payload(session, path, event=None):
    p = {"session_id": session, "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": path}}
    if event:
        p["hook_event_name"] = event
    return p


def test_grant_flow_ask_once_then_allow(taint_gate, monkeypatch, world, tmp_path):
    # 1. First cross-context org write asks.
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/pkb/notes/a.md"),
               tmp_path, session_ctx="personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"

    # 2. The write executed (user approved) -> PostToolUse records the grant.
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/pkb/notes/a.md", event="PostToolUse"),
               tmp_path, session_ctx="personal")
    assert res is None
    gfile = os.path.join(str(tmp_path), "session-grants", "s1.json")
    assert os.path.exists(gfile)
    grants = json.load(open(gfile))
    assert os.path.realpath("/vaults/pkb") in grants

    # 3. Next write to the same vault in the same session allows, explicitly.
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/pkb/notes/b.md"),
               tmp_path, session_ctx="personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "allow"
    assert "session grant" in res["hookSpecificOutput"]["permissionDecisionReason"]


def test_grant_does_not_cover_other_vault(taint_gate, monkeypatch, tmp_path):
    world = [
        {"context": "easygo", "name": "PKB", "exposure": "org",
         "private": False, "path": "/vaults/pkb"},
        {"context": "easygo", "name": "Other Org", "exposure": "org",
         "private": False, "path": "/vaults/other"},
    ]
    _run(taint_gate, monkeypatch, world,
         write_payload("s1", "/vaults/pkb/a.md", event="PostToolUse"),
         tmp_path, session_ctx="personal")
    # granted vault allows...
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/pkb/b.md"), tmp_path, "personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "allow"
    # ...the other org vault still asks.
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/other/b.md"), tmp_path, "personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_grant_does_not_cover_other_session(taint_gate, monkeypatch, world, tmp_path):
    _run(taint_gate, monkeypatch, world,
         write_payload("s1", "/vaults/pkb/a.md", event="PostToolUse"),
         tmp_path, session_ctx="personal")
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s2", "/vaults/pkb/b.md"), tmp_path, "personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_grant_never_launders_taint(taint_gate, monkeypatch, world, tmp_path):
    # A personal session earns a PKB grant, then reads its private Journal:
    # the taint backstop must still ask despite the grant.
    _run(taint_gate, monkeypatch, world,
         write_payload("s1", "/vaults/pkb/a.md", event="PostToolUse"),
         tmp_path, session_ctx="personal")
    assert os.path.exists(os.path.join(str(tmp_path), "session-grants", "s1.json"))
    res = _run(taint_gate, monkeypatch, world,
               {"session_id": "s1", "cwd": "/repo", "tool_name": "Read",
                "tool_input": {"file_path": "/vaults/journal/diary/x.md"}},
               tmp_path, session_ctx="personal")
    assert res is None  # same-context private read: allowed, taints
    res = _run(taint_gate, monkeypatch, world,
               write_payload("s1", "/vaults/pkb/b.md"), tmp_path, "personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_post_records_no_grant_for_same_context_or_readonly(taint_gate, monkeypatch, world, tmp_path):
    # Same-context org write: no ask happened, no grant to infer.
    _run(taint_gate, monkeypatch, world,
         write_payload("s1", "/vaults/pkb/a.md", event="PostToolUse"),
         tmp_path, session_ctx="easygo")
    assert not os.path.exists(os.path.join(str(tmp_path), "session-grants", "s1.json"))
    # Read-only Bash touching the vault: not a write, no grant.
    _run(taint_gate, monkeypatch, world,
         {"session_id": "s2", "cwd": "/repo", "tool_name": "Bash",
          "hook_event_name": "PostToolUse",
          "tool_input": {"command": "cat /vaults/pkb/a.md"}},
         tmp_path, session_ctx="personal")
    assert not os.path.exists(os.path.join(str(tmp_path), "session-grants", "s2.json"))


def test_prune_drops_stale_grant_files(taint_gate, monkeypatch, tmp_path):
    monkeypatch.setattr(taint_gate, "STATE", str(tmp_path))
    gdir = tmp_path / "session-grants"
    gdir.mkdir()
    stale, fresh = gdir / "old.json", gdir / "new.json"
    stale.write_text("{}")
    fresh.write_text("{}")
    old = time.time() - 8 * 86400
    os.utime(stale, (old, old))
    taint_gate.prune_grants()
    assert not stale.exists()
    assert fresh.exists()
