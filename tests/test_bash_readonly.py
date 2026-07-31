"""Read-only Bash classification (ADR-0008): reads of non-private org vaults
are unrestricted, so a provably read-only command must not trip the org-write
gate — and anything doubtful must keep the ask."""

import io
import json
import os
from contextlib import redirect_stdout


# --- classification: positives ----------------------------------------------

READ_ONLY = [
    "ls /vaults/pkb",
    "ls -la /vaults/pkb/notes",
    "cat /vaults/pkb/notes/x.md",
    "head -20 /vaults/pkb/x.md",
    "tail -f /vaults/pkb/x.md",
    "grep -r foo /vaults/pkb",
    "rg 'pattern' /vaults/pkb --glob '*.md'",
    "find /vaults/pkb -name '*.md'",
    "wc -l /vaults/pkb/x.md",
    "awk '{print $1}' /vaults/pkb/x.md",
    "sed -n '1,10p' /vaults/pkb/x.md",
    "jq .foo /vaults/pkb/x.json",
    "git -C /vaults/pkb status",
    "git -C /vaults/pkb log --oneline",
    "git -C /vaults/pkb diff",
    "git -C /vaults/pkb show HEAD",
    "git -C /vaults/pkb ls-files",
    "cat /vaults/pkb/x.md | grep foo | sort | uniq | head",
    "du -sh /vaults/pkb",
    "stat /vaults/pkb/x.md; file /vaults/pkb/x.md",
    "echo hello",
    "cut -d: -f1 /vaults/pkb/x.md | tr a-z A-Z",
]


def test_read_only_positives(taint_gate):
    for cmd in READ_ONLY:
        assert taint_gate.bash_command_is_read_only(cmd) is True, cmd


# --- classification: negatives (definite writes) -----------------------------

WRITES = [
    "echo hi > /vaults/pkb/x.md",
    "echo hi >> /vaults/pkb/x.md",
    "cat a | tee /vaults/pkb/x.md",
    "sed -i 's/a/b/' /vaults/pkb/x.md",
    "sed -i.bak 's/a/b/' /vaults/pkb/x.md",
    "rm /vaults/pkb/x.md",
    "mv /tmp/a /vaults/pkb/a",
    "cp /tmp/a /vaults/pkb/a",
    "mkdir /vaults/pkb/new",
    "touch /vaults/pkb/x.md",
    "truncate -s0 /vaults/pkb/x.md",
    "chmod +w /vaults/pkb/x.md",
    "git -C /vaults/pkb add .",
    "git -C /vaults/pkb commit -m x",
    "git -C /vaults/pkb rm x.md",
    "git -C /vaults/pkb checkout -- .",
    "git -C /vaults/pkb restore x.md",
    "git -C /vaults/pkb clean -fd",
    "find /vaults/pkb -name '*.tmp' -delete",
    "find /vaults/pkb -name '*.md' -exec rm {} ;",
    "awk '{print > \"/vaults/pkb/out\"}' in",   # awk internal redirection
]


def test_write_negatives(taint_gate):
    for cmd in WRITES:
        assert taint_gate.bash_command_is_read_only(cmd) is False, cmd


# --- classification: doubt-cases stay not-read-only --------------------------

DOUBT = [
    "python3 -c 'open(\"/vaults/pkb/x\",\"w\")'",
    "python script.py /vaults/pkb",
    "node -e 'fs.writeFileSync(...)'",
    "uv run tool.py /vaults/pkb",
    "xargs rm < list",
    "cat $(ls /vaults/pkb)",           # command substitution
    "cat `ls /vaults/pkb`",            # backticks
    "sort < /vaults/pkb/x.md",         # input redirection: conservative
    "FOO=1 cat /vaults/pkb/x.md",      # env prefix: unknown leader
    "somecmd /vaults/pkb",             # unknown command
    "bash -c 'cat /vaults/pkb/x'",     # interpreter
    "cat 'unterminated /vaults/pkb",   # unparsable quoting
    "git -C /vaults/pkb",              # bare git, no subcommand
    "git -C /vaults/pkb push",         # non-allow-listed subcommand
    "",
]


def test_doubt_cases_not_read_only(taint_gate):
    for cmd in DOUBT:
        assert taint_gate.bash_command_is_read_only(cmd) is False, repr(cmd)


# --- through main(): read-only allows, doubt asks ----------------------------


def _run_main(taint_gate, monkeypatch, world, payload, tmp_path, session_ctx):
    monkeypatch.setattr(taint_gate, "get_vaults", lambda: world)
    monkeypatch.setattr(taint_gate, "get_session_context", lambda cwd: session_ctx)
    monkeypatch.setattr(taint_gate, "STATE", str(tmp_path))
    buf = io.StringIO()
    with redirect_stdout(buf):
        taint_gate.main(payload)
    out = buf.getvalue().strip()
    return json.loads(out) if out else None


def test_cross_context_readonly_bash_on_org_vault_allows(taint_gate, monkeypatch, world, tmp_path):
    # personal session reading the (non-private, org) PKB via Bash: no gate.
    res = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "rg 'foo' /vaults/pkb | head -5"}},
        tmp_path, session_ctx="personal")
    assert res is None


def test_cross_context_write_bash_on_org_vault_asks(taint_gate, monkeypatch, world, tmp_path):
    res = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "cp /tmp/a.md /vaults/pkb/notes/a.md"}},
        tmp_path, session_ctx="personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_cross_context_doubtful_bash_on_org_vault_asks(taint_gate, monkeypatch, world, tmp_path):
    res = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "python3 tool.py /vaults/pkb/notes"}},
        tmp_path, session_ctx="personal")
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"


def test_readonly_mention_of_private_vault_still_taints_and_denies(taint_gate, monkeypatch, world, tmp_path):
    # Read-only detection loosens the ORG gate only; private-vault rules hold.
    res = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "cat /vaults/journal/diary/today.md"}},
        tmp_path, session_ctx="easygo")
    assert res["hookSpecificOutput"]["permissionDecision"] == "deny"
    res = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s2", "cwd": "/repo", "tool_name": "Bash",
         "tool_input": {"command": "cat /vaults/easygo/dm/x.md"}},
        tmp_path, session_ctx="easygo")
    assert res is None
    assert os.path.exists(os.path.join(str(tmp_path), "sessions", "s2", "tainted"))
