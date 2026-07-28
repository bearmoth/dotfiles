def test_marker_roundtrip(taint_gate, tmp_path):
    m = tmp_path / "tainted"
    taint_gate.write_taint_marker(str(m), "Read", "/vaults/journal/diary/x.md")
    info = taint_gate.read_taint_marker(str(m))
    assert info["tool"] == "Read"
    assert info["detail"] == "/vaults/journal/diary/x.md"
    assert "ts" in info


def test_absent_marker_is_none(taint_gate, tmp_path):
    assert taint_gate.read_taint_marker(str(tmp_path / "nope")) is None


def test_legacy_empty_marker_is_unknown_provenance(taint_gate, tmp_path):
    m = tmp_path / "tainted"
    m.write_text("")                       # old empty-file format
    assert taint_gate.read_taint_marker(str(m)) == {"provenance": "unknown"}


def test_prompt_has_all_four_elements_with_real_paths(taint_gate):
    info = {"tool": "Read", "detail": "/vaults/easygo/dm/2026-07.md", "ts": "2026-07-28T10:00:00"}
    p = taint_gate.gate_prompt(info, "Engagement PKB/log/2026-07.md")
    assert "/vaults/easygo/dm/2026-07.md" in p          # 1. tainting read
    assert "Engagement PKB/log/2026-07.md" in p         # 2. write target
    assert "Approve" in p                               # 3. what approve does
    assert "Reject" in p                                # 4. what reject does
    assert "ADR-0005/0008" in p or ("ADR-0008" in p and "ADR-0005" in p)


def test_prompt_degrades_gracefully_for_unknown_provenance(taint_gate):
    p = taint_gate.gate_prompt({"provenance": "unknown"}, "Engagement PKB/x.md")
    assert "provenance unknown" in p.lower()
    assert "Engagement PKB/x.md" in p
    assert "Approve" in p and "Reject" in p
