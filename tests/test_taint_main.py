import io
import json
import os
from contextlib import redirect_stdout


def _run_main(taint_gate, monkeypatch, world, payload, tainted_marker=None,
              tmp_path=None, session_ctx="easygo"):
    monkeypatch.setattr(taint_gate, "get_vaults", lambda: world)
    monkeypatch.setattr(taint_gate, "get_session_context", lambda cwd: session_ctx)
    monkeypatch.setattr(taint_gate, "STATE", str(tmp_path))
    sdir = os.path.join(str(tmp_path), "sessions", payload.get("session_id", "s"))
    if tainted_marker is not None:
        os.makedirs(sdir, exist_ok=True)
        with open(os.path.join(sdir, "tainted"), "w") as f:
            f.write(tainted_marker)
    buf = io.StringIO()
    with redirect_stdout(buf):
        taint_gate.main(payload)
    out = buf.getvalue().strip()
    return (json.loads(out) if out else None), sdir


def test_scenario_worklog_routine_no_taint_no_gate(taint_gate, monkeypatch, world, tmp_path):
    """Acceptance test: easygo session writes PKB worklog (org, same ctx, clean)
    then Journal capture (private write-down). Neither gates; no taint set."""
    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/log/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res is None
    assert not os.path.exists(os.path.join(sdir, "tainted"))

    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/journal/captures/sessions/x.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res is None
    assert not os.path.exists(os.path.join(sdir, "tainted"))


def test_scenario_easygo_reads_journal_denied(taint_gate, monkeypatch, world, tmp_path):
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Read",
         "tool_input": {"file_path": "/vaults/journal/diary/today.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_scenario_easygo_reads_easygo_then_writes_pkb_gates(taint_gate, monkeypatch, world, tmp_path):
    # read the Easygo private vault (same ctx) -> taint set, read allowed
    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Read",
         "tool_input": {"file_path": "/vaults/easygo/dm/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res is None
    marker = os.path.join(sdir, "tainted")
    assert os.path.exists(marker)
    info = json.loads(open(marker).read())
    assert info["detail"].endswith("/vaults/easygo/dm/2026-07.md")

    # now write to PKB (org, same ctx) while tainted -> gate fires, self-sufficient
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/log/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo", tainted_marker=json.dumps(info))
    reason = res["hookSpecificOutput"]["permissionDecisionReason"]
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"
    assert "/vaults/easygo/dm/2026-07.md" in reason
    assert "Approve" in reason and "Reject" in reason


def test_repo_paths_never_gated(taint_gate, monkeypatch, world, tmp_path):
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/repo/src/main.py"}},
        tmp_path=tmp_path, session_ctx="personal")
    assert res is None


def test_cross_context_org_write_asks_even_when_clean(taint_gate, monkeypatch, world, tmp_path):
    # personal session -> PKB (easygo org) is a cross-context org write
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/notes/x.md"}},
        tmp_path=tmp_path, session_ctx="personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_bash_writedown_into_journal_does_not_taint(taint_gate, monkeypatch, world, tmp_path):
    # appending a worklog into the Journal via Bash must not taint (write-down)
    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "echo entry >> /vaults/journal/log/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="personal")
    assert res is None
    assert not os.path.exists(os.path.join(sdir, "tainted"))


def test_bash_cross_context_private_read_denied(taint_gate, monkeypatch, world, tmp_path):
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "cat /vaults/journal/diary/today.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res["hookSpecificOutput"]["permissionDecision"] == "deny"


def test_empty_payload_is_silent(taint_gate, monkeypatch, world, tmp_path):
    # no vaults registered -> return early, never crash
    monkeypatch.setattr(taint_gate, "get_vaults", lambda: [])
    buf = io.StringIO()
    with redirect_stdout(buf):
        taint_gate.main({"session_id": "s", "cwd": "/repo",
                         "tool_name": "Read", "tool_input": {"file_path": "/x"}})
    assert buf.getvalue().strip() == ""
