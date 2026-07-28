PKB = {"context": "easygo", "exposure": "org", "private": False, "path": "/vaults/pkb"}
EASYGO = {"context": "easygo", "exposure": "personal", "private": True, "path": "/vaults/easygo"}
TECH = {"context": "personal", "exposure": "personal", "private": False, "path": "/vaults/tech"}
JOURNAL = {"context": "personal", "exposure": "personal", "private": True, "path": "/vaults/journal"}


# --- reads -----------------------------------------------------------------
def test_private_read_same_context_taints(taint_gate):
    assert taint_gate.read_decision(JOURNAL, "personal") == "taint"
    assert taint_gate.read_decision(EASYGO, "easygo") == "taint"


def test_private_read_cross_context_denied(taint_gate):
    assert taint_gate.read_decision(JOURNAL, "easygo") == "deny"
    assert taint_gate.read_decision(EASYGO, "personal") == "deny"


def test_private_read_unresolved_session_denied(taint_gate):
    assert taint_gate.read_decision(JOURNAL, None) == "deny"


def test_nonprivate_read_always_allowed_never_taints(taint_gate):
    assert taint_gate.read_decision(PKB, "personal") == "allow"
    assert taint_gate.read_decision(TECH, "easygo") == "allow"


# --- writes ----------------------------------------------------------------
def test_org_write_same_context_clean_allowed(taint_gate):
    assert taint_gate.write_decision(PKB, "easygo", tainted=False) == "allow"


def test_org_write_same_context_tainted_asks(taint_gate):
    assert taint_gate.write_decision(PKB, "easygo", tainted=True) == "ask"


def test_org_write_cross_context_asks(taint_gate):
    assert taint_gate.write_decision(PKB, "personal", tainted=False) == "ask"


def test_writedown_into_private_always_allowed(taint_gate):
    # session capture / worklog into a private vault, even cross-context
    assert taint_gate.write_decision(JOURNAL, "easygo", tainted=True) == "allow"
    assert taint_gate.write_decision(TECH, "easygo", tainted=True) == "allow"


# --- directionality heuristic ----------------------------------------------
R = "/vaults/journal"


def test_write_dest_only_forms(taint_gate):
    for cmd in [
        f"echo hi > {R}/log/2026-07.md",
        f"echo hi >> {R}/log/2026-07.md",
        f"printf x | tee {R}/note.md",
        f"cp /tmp/a.md {R}/captures/a.md",
        f"mv /tmp/a.md {R}/captures/a.md",
    ]:
        assert taint_gate.mention_is_write_dest_only(cmd, R) is True, cmd


def test_read_and_ambiguous_forms_are_not_write_dest_only(taint_gate):
    for cmd in [
        f"cat {R}/diary/today.md",
        f"grep foo {R}/notes.md",
        f"cp {R}/secret.md /tmp/x.md",        # reading FROM the vault
        f"echo hi > /tmp/x && cat {R}/y.md",   # mixed: one read present
    ]:
        assert taint_gate.mention_is_write_dest_only(cmd, R) is False, cmd


def test_bash_reads_private_conservative(taint_gate):
    assert taint_gate.bash_reads_private(f"cat {R}/x.md", [R]) is True
    assert taint_gate.bash_reads_private(f"echo hi >> {R}/log.md", [R]) is False
    assert taint_gate.bash_reads_private("ls /tmp", [R]) is False
