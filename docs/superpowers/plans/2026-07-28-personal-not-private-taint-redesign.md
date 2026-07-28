# Personal ≠ Private — Vault Governance & Taint Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the overloaded `exposure: private` axis with two orthogonal per-vault facts (`exposure: org|personal` + `private: true|false`), turn vault governance into stateless read/write ACLs over context × privacy, and demote session taint to a directionality-correct transitional backstop with a self-sufficient gate prompt.

**Architecture:** Registry gains a `private` boolean per vault (chezmoi source `contexts.yaml` → `eos-registry` template → rendered `registry.json`). The taint-gate hook is rewired around **pure decision functions** (`read_decision`, `write_decision`, `evaluate`, directionality heuristic, prompt/marker builders) fed by two **injectable I/O wrappers** (`get_vaults`, `get_session_context`) so the whole matrix is unit-testable with no subprocess/filesystem coupling. Governance: private-vault reads are same-context-only (cross-context → hard deny); org-vault writes are same-context-only (cross-context → ask); writes *into* private vaults never taint; taint is set only by an actual same-context private **read** and only backstops the one surviving private-read→org-write path (the draining Easygo vault).

**Tech Stack:** Python 3 (stdlib only for the shipped hooks/resolver — no third-party imports at runtime, matching the existing fail-open scripts); chezmoi Go templates; pytest (dev-only, run via `uv`, never deployed).

## Global Constraints

- **Fail-open is sacrosanct.** Every shipped hook keeps its top-level `try/except → print to stderr → issue_breadcrumb → sys.exit(0)`. No decision function may raise into the tool call. (Spec: "Fail-open philosophy and the crash-breadcrumb-to-eos-issues behavior are unchanged.")
- **Runtime code is stdlib-only.** The taint gate and resolver import only the standard library. pytest/pyyaml are dev-time only.
- **Tests live at repo root `tests/` and must never deploy.** chezmoi source root is the repo root; add `tests/`, `.venv/`, `.pytest_cache/`, and any root `pyproject.toml`/`conftest.py` to `.chezmoiignore`. (Spec: "not under `dot_claude/`, so chezmoi never deploys it".)
- **Canonical test command:** `uv run --with pytest --with pyyaml --no-project -- pytest tests/ -v` (run from the worktree root). Verified: pytest 9.1.1.
- **exposure values are exactly `org` | `personal`.** The value `private` is retired as an exposure value (it becomes the separate `private:` boolean). Legacy `exposure: private` in a half-rendered registry is tolerated as "not org" (personal-exposed) — never crash.
- **`private` is a boolean, absent ⇒ `false`.** Readers use `bool(vault.get("private"))` so an un-migrated registry (field absent) parses without error (fail-open on the read gate for the tiny window before `chezmoi apply`).
- **Registry edits go through the registry-maintenance skill.** Task 2 edits `.chezmoidata/contexts.yaml`; invoke `Skill(registry-maintenance)` before making those edits and verify with `eos-resolve` after `chezmoi apply`.
- **Attribution tuple for commits/notes:** `(personal, bearmoth/dotfiles, no-ticket, taint-gate-personal-not-private)`.
- **Vocabulary in prose:** worklog `log/` writes are "plumbing-into-wiki" (mirror the De-spec Queue's "transient plumbing" precedent) — same ACL as any vault write. Use that phrasing in ADR/doc prose (Spec rule 4).

**The target governance matrix (the contract every task serves):**

| Vault | context | exposure | private |
|---|---|---|---|
| Engagement PKB | easygo | org | false |
| Easygo (roleless) | easygo | personal | true |
| Tech Notes | personal | personal | false |
| Journal | personal | personal | true |

- **Read** of a `private: true` vault: same session-context ⇒ **allow + taint**; different context ⇒ **deny** (hard, no prompt). `private: false` ⇒ **allow**, never taint.
- **Write** to an `exposure: org` vault: same context & not tainted ⇒ **allow**; same context & tainted ⇒ **ask** (backstop); different context ⇒ **ask**. Writes to personal-exposed vaults (incl. write-down into `private: true`) ⇒ **allow**, never taint.
- **Repos are never vaults** — only paths under a registered vault root are gated.

---

## File Structure

- `.chezmoidata/contexts.yaml` — **modify.** Rename `exposure: private` → `personal`; add `private:` to all four vaults; update the schema-comment header.
- `.chezmoitemplates/eos-registry` — **modify.** Add `"private" $v.private` to the vault entry dict (line ~21) and the roleless entry dict (line ~30) so the field propagates to `registry.json`.
- `dot_local/bin/executable_eos-resolve` — **modify.** `mounts_lines` shows the `private` marker; confirm `all_vaults`/`vaults --json` carry `private` (automatic via `**v`). No behavioural change to `resolve_context`.
- `dot_claude/hooks/executable_eos-taint-gate.py` — **rewrite the decision core.** Add pure functions + injectable wrappers; rewire `main()`. Keep fail-open scaffolding, `audit`, `issue_breadcrumb` verbatim.
- `docs/adr/0008-personal-is-not-private.md` — **create.**
- `docs/adr/0002-exposure-is-a-one-way-ratchet.md`, `docs/adr/0005-session-taint-gates-org-writes.md` — **modify.** Forward-amendment notes only; do not rewrite history.
- `CONTEXT.md` — **modify.** Glossary: exposure + taint entries reflect the split.
- `dot_claude/skills/knowledge-routing/SKILL.md`, `dot_claude/skills/registry-maintenance/SKILL.md` — **modify.** Schema/vocabulary lines.
- `dot_claude/CLAUDE.md` — **modify.** Line 33 exposure/ratchet wording.
- `tests/conftest.py`, `tests/test_*.py` — **create.** pytest suite (repo-root, ignored by chezmoi).
- `.chezmoiignore` — **modify.** Add `tests/`, `.venv/`, `.pytest_cache/`.

**No-change-but-verify (registry readers that do NOT touch `exposure`):**
- `dot_claude/hooks/executable_eos-session-start.py` — shim over `eos-resolve banner`; no exposure literal.
- `dot_claude/hooks/executable_eos-stop.py` — keys on `wiki`/`journal` roles + paths; no exposure literal; must still **not** pre-create month shards.
- `dot_claude/hooks/executable_eos-git-guardrail.py` — path-only vault exemption; no exposure literal.

---

## Task 1: Test harness scaffold

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_harness_smoke.py`
- Modify: `.chezmoiignore`

**Interfaces:**
- Produces: pytest fixtures `taint_gate` (the loaded hook module) and `resolver` (the loaded `eos-resolve` module), each an imported module object; a `world()` helper returning the fixture vault list matching the governance matrix.

- [ ] **Step 1: Write the failing smoke test**

`tests/test_harness_smoke.py`:
```python
def test_modules_load(taint_gate, resolver):
    # Both scripts import cleanly despite non-.py names / executable_ prefix.
    assert hasattr(taint_gate, "main")
    assert hasattr(resolver, "all_vaults")


def test_world_fixture_matches_matrix(world):
    by_name = {v["name"]: v for v in world}
    assert by_name["Engagement PKB"]["exposure"] == "org"
    assert by_name["Engagement PKB"]["private"] is False
    assert by_name["Journal"]["exposure"] == "personal"
    assert by_name["Journal"]["private"] is True
    assert by_name["Easygo"]["context"] == "easygo"
    assert by_name["Easygo"]["private"] is True
```

- [ ] **Step 2: Run it to verify it fails**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/ -v`
Expected: FAIL — `conftest.py` missing / fixtures `taint_gate`, `resolver`, `world` not defined.

- [ ] **Step 3: Write the conftest**

`tests/conftest.py`:
```python
import importlib.machinery
import importlib.util
import pathlib

import pytest

REPO = pathlib.Path(__file__).resolve().parents[1]
TAINT_GATE = REPO / "dot_claude" / "hooks" / "executable_eos-taint-gate.py"
RESOLVER = REPO / "dot_local" / "bin" / "executable_eos-resolve"


def _load(path, name):
    """Load a script by path, tolerating hyphens / missing .py extension."""
    loader = importlib.machinery.SourceFileLoader(name, str(path))
    spec = importlib.util.spec_from_loader(name, loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


@pytest.fixture
def taint_gate():
    return _load(TAINT_GATE, "eos_taint_gate")


@pytest.fixture
def resolver():
    return _load(RESOLVER, "eos_resolve")


@pytest.fixture
def world():
    """The governance matrix as `eos-resolve vaults --json` would emit it."""
    return [
        {"context": "easygo", "role": "wiki", "name": "Engagement PKB",
         "repo": "github.com/primeslice/engagement-pkb",
         "exposure": "org", "private": False,
         "path": "/vaults/pkb"},
        {"context": "easygo", "role": None, "name": "Easygo",
         "repo": "github.com/bearmoth/notes-easygo",
         "exposure": "personal", "private": True,
         "path": "/vaults/easygo"},
        {"context": "personal", "role": "wiki", "name": "Tech Notes",
         "repo": "github.com/bearmoth/notes-tech",
         "exposure": "personal", "private": False,
         "path": "/vaults/tech"},
        {"context": "personal", "role": "journal", "name": "Journal",
         "repo": "github.com/bearmoth/notes-journal",
         "exposure": "personal", "private": True,
         "path": "/vaults/journal"},
    ]
```

- [ ] **Step 4: Add ignore rules so tests never deploy**

Append to `.chezmoiignore` (after the existing `# Docs` block, add a new block):
```
# Repo-only Python test suite + dev env (never a dotfile)
tests/
.venv/
.pytest_cache/
```

- [ ] **Step 5: Run to verify pass**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/ -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Verify chezmoi will not deploy the suite**

Run: `chezmoi --source="$(pwd)" managed --path-style=absolute 2>/dev/null | grep -E '/tests/|/\.pytest_cache/' || echo "NOT MANAGED (good)"`
Expected: `NOT MANAGED (good)`.

- [ ] **Step 7: Commit**

```bash
git add tests/conftest.py tests/test_harness_smoke.py .chezmoiignore
git commit -m "test(eos): scaffold repo-root pytest harness, keep it off chezmoi"
```

---

## Task 2: Registry schema split — contexts.yaml + template propagation

**REQUIRED SKILL:** Invoke `Skill(registry-maintenance)` before editing `.chezmoidata/contexts.yaml` (per user mandate + CLAUDE.md standing directive). The edit stays in the shared layer; re-render with `chezmoi apply` and verify with `eos-resolve`.

**Files:**
- Modify: `.chezmoidata/contexts.yaml`
- Modify: `.chezmoitemplates/eos-registry:21` and `:30`
- Modify: `dot_claude/skills/registry-maintenance/SKILL.md:14,18` (schema doc coupled to this change)
- Test: `tests/test_registry_schema.py`

**Interfaces:**
- Produces: rendered `registry.json` in which every vault dict has `exposure ∈ {"org","personal"}` and a boolean `private`. Consumed by Tasks 3–6 (via `eos-resolve vaults --json`) and the `world` fixture shape.

- [ ] **Step 1: Write the failing schema tests**

`tests/test_registry_schema.py`:
```python
import pathlib
import shutil
import subprocess

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
CONTEXTS = REPO / ".chezmoidata" / "contexts.yaml"
TEMPLATE = REPO / ".chezmoitemplates" / "eos-registry"


def _all_vault_defs(doc):
    for cdef in doc["contexts"].values():
        for v in (cdef.get("vaults") or {}).values():
            yield v
        for v in (cdef.get("roleless") or []):
            yield v


def test_every_vault_has_split_fields():
    doc = yaml.safe_load(CONTEXTS.read_text())
    vaults = list(_all_vault_defs(doc))
    assert vaults, "no vaults parsed"
    for v in vaults:
        assert v["exposure"] in ("org", "personal"), v
        assert isinstance(v["private"], bool), v


def test_no_legacy_private_exposure_value():
    doc = yaml.safe_load(CONTEXTS.read_text())
    assert all(v["exposure"] != "private" for v in _all_vault_defs(doc))


@pytest.mark.skipif(shutil.which("chezmoi") is None, reason="chezmoi not installed")
def test_template_propagates_private_to_rendered_json():
    """The eos-registry template whitelists vault fields; prove `private`
    and the renamed exposure survive rendering into registry.json."""
    data = {"contexts": yaml.safe_load(CONTEXTS.read_text())["contexts"]}
    import json
    out = subprocess.run(
        ["chezmoi", "execute-template", TEMPLATE.read_text()],
        input=json.dumps(data), capture_output=True, text=True,
        # feed .contexts via --init data file
    )
    # execute-template exposes template data via `--init` promptString/data;
    # simplest portable path: render with a data file (see Step 4 note).
    assert out.returncode == 0, out.stderr
    rendered = json.loads(out.stdout)
    tech = rendered["contexts"]["personal"]["vaults"]["wiki"]
    assert tech["exposure"] == "personal"
    assert tech["private"] is False
    pkb = rendered["contexts"]["easygo"]["vaults"]["wiki"]
    assert pkb["exposure"] == "org" and pkb["private"] is False
```

> Note: `chezmoi execute-template` reads template data from the machine's chezmoi config, not stdin JSON. If passing `.contexts` inline proves awkward, replace the render assertion with a data-file form: write the contexts under a temp `~/.config/chezmoi`-style `data:` and call `chezmoi execute-template --init --promptString ...`, OR shell `chezmoi execute-template` with `--config` pointing at a temp TOML whose `[data]` holds `contexts`. Keep the test **skipped** when chezmoi is absent. The load-bearing assertion is: rendered JSON contains `private` and `exposure: personal`. If a reliable inline render can't be achieved in-session, downgrade this to `test_template_source_sets_private` that asserts the template *source* contains `"private" $v.private` in both entry dicts (regex over `TEMPLATE.read_text()`), which is a real regression guard for the whitelist bug.

- [ ] **Step 2: Run to verify failure**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_registry_schema.py -v`
Expected: FAIL — current `contexts.yaml` still has `exposure: private`, no `private:` key.

- [ ] **Step 3: Edit `.chezmoidata/contexts.yaml`**

Update the schema-comment lines 17-20:
```yaml
#   vaults:     role -> vault definition; at most one vault per role (#9)
#     <role>:   {name, repo, exposure, private}   role ∈ {wiki, journal}
#               exposure ∈ {org, personal} (who may see it); private is a
#               separate boolean (contents sensitive — never flow outward
#               without Phil's eyes). ADR-0008: personal ≠ private.
#   roleless:   vaults registered but ineligible as routing destinations
#               (e.g. a draining vault), list of {name, repo, exposure, private}
```

Set the four vault definitions (personal.wiki, personal.journal, easygo.wiki, easygo.roleless[0]):
```yaml
  personal:
    ownership:
      - "github.com/bearmoth/*"
    vaults:
      wiki:
        name: "Tech Notes"
        repo: "github.com/bearmoth/notes-tech"
        exposure: personal
        private: false
      journal:
        name: "Journal"
        repo: "github.com/bearmoth/notes-journal"
        exposure: personal
        private: true
  easygo:
    span:
      start: "2024-04-23"
      end: null
    ownership:
      - "github.com/primeslice/*"
      - "github.com/StakeEngine/*"
    vaults:
      wiki:
        name: "Engagement PKB"
        repo: "github.com/primeslice/engagement-pkb"
        exposure: org
        private: false
    roleless:
      - name: "Easygo"
        repo: "github.com/bearmoth/notes-easygo"
        exposure: personal
        private: true # DM-mirror-grade sensitive; draining (#9), leaves when drained
```

- [ ] **Step 4: Edit `.chezmoitemplates/eos-registry` to propagate `private`**

Line ~21 (vault entry):
```
{{-     $entry := dict "name" $v.name "repo" $v.repo "exposure" $v.exposure "private" $v.private -}}
```
Line ~30 (roleless entry):
```
{{-       $entry := dict "name" $v.name "repo" $v.repo "exposure" $v.exposure "private" $v.private -}}
```

- [ ] **Step 5: Update the registry-maintenance schema doc**

`dot_claude/skills/registry-maintenance/SKILL.md`:
- Line 14 table cell: `vault defs (name/repo/exposure/private/role)`.
- Line 18 schema note — replace "`exposure` is `org`/`private` per vault (the registry's one sensitivity fact)" with:
  > `exposure` is `org`/`personal` per vault (who may see it); `private` is a separate boolean (contents sensitive — governs read ACL + taint). ADR-0008: personal ≠ private, they are orthogonal.

- [ ] **Step 6: Render and verify with the real toolchain**

```bash
chezmoi apply --source="$(pwd)" 2>&1 | tail -5   # or: chezmoi execute-template to a temp
~/.local/bin/eos-resolve vaults --json | python3 -m json.tool | grep -E '"exposure"|"private"'
```
Expected: each vault shows `"exposure": "org"|"personal"` and `"private": true|false`. No `"private"` exposure value remains.

> If applying to the live machine registry is undesirable mid-plan, verify via `chezmoi execute-template` render instead and defer `chezmoi apply` — but Tasks 3+ integration checks that shell `eos-resolve` need the rendered registry to reflect the new schema. Prefer rendering to the real `~/.config/engineering-os/registry.json` since that is this machine's own registry and the change is the intended one.

- [ ] **Step 7: Run tests**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_registry_schema.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add .chezmoidata/contexts.yaml .chezmoitemplates/eos-registry \
        dot_claude/skills/registry-maintenance/SKILL.md tests/test_registry_schema.py
git commit -m "feat(eos): split vault exposure into exposure(org|personal)+private bool (ADR-0008)"
```

---

## Task 3: Resolver surfaces both fields; mounts display gains the private marker

**Files:**
- Modify: `dot_local/bin/executable_eos-resolve` — `mounts_lines` only.
- Test: `tests/test_resolver.py`

**Interfaces:**
- Consumes: `resolver.all_vaults(reg)` (existing generator yielding `(ctx, role, vault_dict)`), `resolver.mounts_lines(reg)`.
- Produces: `mounts_lines` output that appends `, private` when a vault is `private: true`, e.g. `personal journal: Journal (personal, private) — <loc>`, `easygo roleless: Easygo (personal, private, not a routing destination) — <loc>`. `all_vaults` continues to spread `**v` so `private` flows to `vaults --json` unchanged.

- [ ] **Step 1: Write the failing tests**

`tests/test_resolver.py`:
```python
def _reg():
    return {
        "machine": {"clone_root": "/Users/x/Dev", "worktree_root": "/Users/x/wt"},
        "contexts": {
            "personal": {"ownership": [], "roots": [], "vaults": {
                "wiki": {"name": "Tech Notes", "repo": "r", "exposure": "personal",
                         "private": False, "path": "/vaults/tech"},
                "journal": {"name": "Journal", "repo": "r", "exposure": "personal",
                            "private": True, "path": "/vaults/journal"},
            }},
            "easygo": {"ownership": [], "roots": [], "vaults": {
                "wiki": {"name": "Engagement PKB", "repo": "r", "exposure": "org",
                         "private": False, "path": "/vaults/pkb"},
            }, "roleless": [
                {"name": "Easygo", "repo": "r", "exposure": "personal",
                 "private": True, "path": "/vaults/easygo"},
            ]},
        },
    }


def test_all_vaults_carries_private(resolver):
    vaults = {v["name"]: v for _, _, v in resolver.all_vaults(_reg())}
    assert vaults["Journal"]["private"] is True
    assert vaults["Engagement PKB"]["private"] is False


def test_mounts_line_shows_private_marker(resolver):
    lines = "\n".join(resolver.mounts_lines(_reg()))
    assert "Journal (personal, private)" in lines
    assert "Engagement PKB (org)" in lines           # non-private: no marker
    assert "Easygo (personal, private, not a routing destination)" in lines


def test_registry_parsing_tolerates_missing_private(resolver):
    reg = _reg()
    del reg["contexts"]["personal"]["vaults"]["wiki"]["private"]  # un-migrated
    # Must not raise; mounts_lines renders without a private marker for it.
    lines = "\n".join(resolver.mounts_lines(reg))
    assert "Tech Notes (personal)" in lines
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_resolver.py -v`
Expected: FAIL — `mounts_lines` does not yet emit the `private` marker.

- [ ] **Step 3: Edit `mounts_lines` in the resolver**

Replace the two `lines.append(...)` bodies inside `mounts_lines` with a helper that folds in the private marker:
```python
def mounts_lines(reg):
    def tag(v):
        t = v.get("exposure", "?")
        if v.get("private"):
            t += ", private"
        return t

    lines = []
    for ctx in sorted(reg.get("contexts", {})):
        cdef = reg["contexts"][ctx]
        for role in sorted(cdef.get("vaults") or {}):
            v = cdef["vaults"][role]
            loc = home_tilde(v.get("path")) if v.get("path") else "not on this machine"
            lines.append(f"{ctx} {role}: {v['name']} ({tag(v)}) — {loc}")
        for v in cdef.get("roleless") or []:
            loc = home_tilde(v.get("path")) if v.get("path") else "not on this machine"
            lines.append(
                f"{ctx} roleless: {v['name']} ({tag(v)}, not a routing destination) — {loc}"
            )
    machine = reg.get("machine", {})
    if machine.get("clone_root") or machine.get("worktree_root"):
        lines.append(
            f"clone root: {home_tilde(machine.get('clone_root', '?'))} | worktree root: {home_tilde(machine.get('worktree_root', '?'))}"
        )
    return lines
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_resolver.py -v`
Expected: PASS.

- [ ] **Step 5: Behavioural spot-check against the live registry**

Run: `~/.local/bin/eos-resolve mounts`
Expected: Journal line reads `... Journal (personal, private) — ...`; Engagement PKB reads `(org)`.

- [ ] **Step 6: Commit**

```bash
git add dot_local/bin/executable_eos-resolve tests/test_resolver.py
git commit -m "feat(eos): surface private flag in vaults JSON and mounts banner"
```

---

## Task 4: Taint gate — pure read/write ACL decision core

**Files:**
- Modify: `dot_claude/hooks/executable_eos-taint-gate.py` (add pure functions; do not yet rewire `main`).
- Test: `tests/test_taint_acl.py`

**Interfaces:**
- Produces (all pure, no I/O):
  - `is_org(vault) -> bool` — `vault.get("exposure") == "org"`.
  - `is_private(vault) -> bool` — `bool(vault.get("private"))`.
  - `vault_for_path(path, vaults) -> dict | None` — the vault whose realpath contains `path` (uses existing `under`).
  - `read_decision(vault, session_context) -> "deny" | "taint" | "allow"`.
  - `write_decision(vault, session_context, tainted) -> "ask" | "allow"`.
  - `mention_is_write_dest_only(command, root) -> bool` — directionality heuristic.
  - `bash_reads_private(command, private_roots) -> bool`.
- Consumed by Task 6's `evaluate`/`main`.

- [ ] **Step 1: Write the failing ACL matrix tests**

`tests/test_taint_acl.py`:
```python
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
        f"cp {R}/secret.md /tmp/x.md",       # reading FROM the vault
        f"echo hi > /tmp/x && cat {R}/y.md",  # mixed: one read present
    ]:
        assert taint_gate.mention_is_write_dest_only(cmd, R) is False, cmd


def test_bash_reads_private_conservative(taint_gate):
    assert taint_gate.bash_reads_private(f"cat {R}/x.md", [R]) is True
    assert taint_gate.bash_reads_private(f"echo hi >> {R}/log.md", [R]) is False
    assert taint_gate.bash_reads_private("ls /tmp", [R]) is False
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_acl.py -v`
Expected: FAIL — functions not defined.

- [ ] **Step 3: Add the pure functions to the hook**

Insert after the existing `under(...)` helper (keep `mentions`, `under`, `BASH_WRITE_RE`):
```python
def is_org(vault):
    return vault.get("exposure") == "org"


def is_private(vault):
    return bool(vault.get("private"))


def vault_for_path(path, vaults):
    """The registered vault whose root contains `path`, or None."""
    for v in vaults:
        root = v.get("path")
        if root and under(path, [os.path.realpath(root)]):
            return v
    return None


def read_decision(vault, session_context):
    """Governance rule 1 (ADR-0008). Private vaults are same-context-only."""
    if is_private(vault):
        return "taint" if vault.get("context") == session_context else "deny"
    return "allow"


def write_decision(vault, session_context, tainted):
    """Governance rule 2 (ADR-0008) + taint backstop. Only org-exposed vaults
    are gated; personal-exposed writes (incl. write-down into private) pass."""
    if is_org(vault):
        if vault.get("context") != session_context:
            return "ask"          # cross-context org write
        return "ask" if tainted else "allow"   # same context: taint backstop
    return "allow"


# Redirection immediately before a path => write destination.
_REDIR_BEFORE = re.compile(r"(>>?|\btee\b)\s*(?:-\S+\s+)*$")
# cp/mv/rsync/install anywhere earlier => path-as-final-arg is a destination.
_COPY_CMD = re.compile(r"\b(cp|mv|rsync|install)\b")


def _path_forms(root):
    home = os.path.expanduser("~")
    return {root, root.replace(home, "~")}


def mention_is_write_dest_only(command, root):
    """True iff EVERY occurrence of the vault path in `command` is a write
    destination (target of >/>>/tee, or the last arg of cp/mv/rsync/install).
    Ambiguous or read-position occurrences => False (caller taints). Crude in
    the safe direction, per ADR-0008."""
    forms = _path_forms(root)
    seen = False
    for form in forms:
        start = 0
        while True:
            i = command.find(form, start)
            if i < 0:
                break
            seen = True
            before = command[:i]
            after = command[i + len(form):]
            # occurrence ends the token? (dest args are usually terminal)
            terminal = after.strip() == "" or after.lstrip().startswith(("|", ";", "&", ">"))
            redir = bool(_REDIR_BEFORE.search(before))
            copy_dest = bool(_COPY_CMD.search(before)) and terminal and ">" not in after
            if not (redir or copy_dest):
                return False
            start = i + len(form)
    return seen  # only True when at least one mention existed and all were dests


def bash_reads_private(command, private_roots):
    """A private vault path mentioned in any non-write-destination position
    means the session read it (conservative: ambiguous counts as a read)."""
    for root in private_roots:
        if any(f in command for f in _path_forms(root)) and not mention_is_write_dest_only(command, root):
            return True
    return False
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_acl.py -v`
Expected: PASS (all ACL + directionality cases).

- [ ] **Step 5: Commit**

```bash
git add dot_claude/hooks/executable_eos-taint-gate.py tests/test_taint_acl.py
git commit -m "feat(taint): pure read/write ACL + directionality heuristic (ADR-0008)"
```

---

## Task 5: Taint gate — enriched marker, self-sufficient prompt, audit fields

**Files:**
- Modify: `dot_claude/hooks/executable_eos-taint-gate.py` (marker + prompt builders).
- Test: `tests/test_taint_marker_prompt.py`

**Interfaces:**
- Produces (pure except the two marker I/O fns, which take an explicit path):
  - `write_taint_marker(path, tool, detail) -> None` — writes JSON `{ts, tool, detail}`.
  - `read_taint_marker(path) -> dict | None` — `None` if absent; `{"provenance": "unknown"}` for a legacy empty marker; parsed dict otherwise.
  - `gate_prompt(taint_info, target_desc) -> str` — the four-element ask reason built from state.
- Consumed by Task 6's `main`.

- [ ] **Step 1: Write the failing tests**

`tests/test_taint_marker_prompt.py`:
```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_marker_prompt.py -v`
Expected: FAIL — builders not defined.

- [ ] **Step 3: Implement marker + prompt builders**

Add to the hook:
```python
def write_taint_marker(path, tool, detail):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "tool": tool, "detail": detail},
            f,
        )


def read_taint_marker(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    except OSError:
        return {"provenance": "unknown"}
    if not raw.strip():
        return {"provenance": "unknown"}   # legacy empty-file marker
    try:
        return json.loads(raw)
    except ValueError:
        return {"provenance": "unknown"}


def gate_prompt(taint_info, target_desc):
    """Self-sufficient ask reason built from state (ADR-0005/0008). Keeps all
    four elements: tainting read, write target, what Approve/Reject do."""
    if taint_info.get("provenance") == "unknown":
        source = "private material (provenance unknown — tainted in an earlier session)"
    else:
        source = f"{taint_info.get('detail', 'private material')} at {taint_info.get('ts', 'an earlier point')}"
    return (
        "Taint gate (ADR-0005/0008, docs/adr/): this session read private "
        f"material — {source} — so this write to org-visible {target_desc} needs "
        "your review. Approve = this one write proceeds exactly as shown. "
        "Reject = it's blocked; re-derive the content from org-visible sources "
        "and continue."
    )
```

- [ ] **Step 4: Run to verify pass**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_marker_prompt.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dot_claude/hooks/executable_eos-taint-gate.py tests/test_taint_marker_prompt.py
git commit -m "feat(taint): enriched taint marker + self-sufficient gate prompt"
```

---

## Task 6: Taint gate — orchestrator `evaluate` + rewired `main` + scenario replays

**Files:**
- Modify: `dot_claude/hooks/executable_eos-taint-gate.py` — add `evaluate`, injectable wrappers `get_vaults`/`get_session_context`, rewire `main`, retire the old `vault_paths`/`touched_paths` inline logic (fold into helpers). Keep fail-open scaffolding + `audit` + `issue_breadcrumb` verbatim.
- Test: `tests/test_taint_main.py`

**Interfaces:**
- Consumes: everything from Tasks 4–5.
- Produces:
  - `read_targets(tool, tool_input, cwd) -> list[str]` — realpaths for `Read/Grep/Glob` (Grep with no path ⇒ cwd), reusing existing `touched_paths` shape.
  - `write_targets(tool, tool_input) -> list[str]` — realpaths for `Edit/Write/MultiEdit/NotebookEdit`.
  - `evaluate(tool, tool_input, command, vaults, session_context, tainted) -> dict` with keys `{"deny": str|None, "ask": str|None, "taint": bool, "taint_detail": str|None, "target_desc": str|None}` (pure; `ask` reason left as a stub filled by `main` using `gate_prompt`, OR built here if `taint_info` available — see Step 3).
  - `get_vaults() -> list[dict]` and `get_session_context(cwd) -> str|None` — thin `eos-resolve` subprocess wrappers, monkeypatched in tests.
  - `main(data)` — resolves facts via the wrappers, calls `evaluate`, prints deny/ask JSON, writes the enriched marker on taint, enriches audit.

- [ ] **Step 1: Write the failing orchestrator + scenario tests**

`tests/test_taint_main.py`:
```python
import io
import json
import os
from contextlib import redirect_stdout

import pytest

VAULTS = None  # filled from the `world` fixture per test


def _run_main(taint_gate, monkeypatch, world, payload, tainted_marker=None, tmp_path=None, session_ctx="easygo"):
    monkeypatch.setattr(taint_gate, "get_vaults", lambda: world)
    monkeypatch.setattr(taint_gate, "get_session_context", lambda cwd: session_ctx)
    # isolate STATE so marker writes/reads hit tmp_path
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
    return json.loads(out) if out else None, sdir


def test_scenario_worklog_routine_no_taint_no_gate(taint_gate, monkeypatch, world, tmp_path):
    """Acceptance test: easygo session writes PKB worklog (org, same ctx, clean)
    then Journal capture (private write-down). Neither gates; no taint set."""
    # 1. write PKB worklog
    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/log/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res is None                                  # allow, silent
    assert not os.path.exists(os.path.join(sdir, "tainted"))
    # 2. write Journal capture (private write-down)
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
    # read the Easygo private vault (same ctx) -> taint set
    res, sdir = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Read",
         "tool_input": {"file_path": "/vaults/easygo/dm/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo")
    assert res is None                                  # read allowed
    marker = os.path.join(sdir, "tainted")
    assert os.path.exists(marker)
    info = json.loads(open(marker).read())
    assert info["detail"].endswith("/vaults/easygo/dm/2026-07.md")
    # now write to PKB (org, same ctx) -> gate fires with self-sufficient prompt
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/log/2026-07.md"}},
        tmp_path=tmp_path, session_ctx="easygo", tainted_marker=json.dumps(info))
    reason = res["hookSpecificOutput"]["permissionDecisionReason"]
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"
    assert "/vaults/easygo/dm/2026-07.md" in reason      # tainting read
    assert "Approve" in reason and "Reject" in reason


def test_repo_paths_never_gated(taint_gate, monkeypatch, world, tmp_path):
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/repo/src/main.py"}},
        tmp_path=tmp_path, session_ctx="personal")
    assert res is None


def test_cross_context_org_write_asks_even_when_clean(taint_gate, monkeypatch, world, tmp_path):
    res, _ = _run_main(
        taint_gate, monkeypatch, world,
        {"session_id": "s", "cwd": "/repo", "tool_name": "Write",
         "tool_input": {"file_path": "/vaults/pkb/notes/x.md"}},
        tmp_path=tmp_path, session_ctx="personal")     # personal session -> PKB is cross-ctx
    assert res["hookSpecificOutput"]["permissionDecision"] == "ask"
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_main.py -v`
Expected: FAIL — `get_vaults`/`get_session_context`/`evaluate` not defined; `main` still uses old logic.

- [ ] **Step 3: Add wrappers + `evaluate`, then rewire `main`**

Add the I/O wrappers (replace the old `vault_paths`):
```python
def get_vaults():
    """All registered vaults with context/exposure/private/path. Injectable."""
    r = subprocess.run([EOS, "vaults", "--json"], capture_output=True, text=True, timeout=15)
    if r.returncode != 0:
        return []
    try:
        return json.loads(r.stdout)
    except ValueError:
        return []


def get_session_context(cwd):
    """Owning context of the session cwd (None if unresolved). Injectable."""
    r = subprocess.run([EOS, "context", "--json", cwd], capture_output=True, text=True, timeout=15)
    try:
        return json.loads(r.stdout).get("context")
    except ValueError:
        return None


def read_targets(tool, ti, cwd):
    if tool not in READ_TOOLS:
        return []
    paths = []
    for key in ("file_path", "path", "notebook_path"):
        if ti.get(key):
            paths.append(ti[key])
    if tool == "Grep" and ti.get("path") is None:
        paths.append(cwd)
    return [os.path.realpath(os.path.expanduser(p)) for p in paths]


def write_targets(tool, ti):
    if tool not in WRITE_TOOLS:
        return []
    paths = [ti[k] for k in ("file_path", "path", "notebook_path") if ti.get(k)]
    return [os.path.realpath(os.path.expanduser(p)) for p in paths]
```

Add the pure orchestrator:
```python
def evaluate(tool, ti, command, vaults, session_context, tainted):
    """Pure decision over a fixed world. Priority: deny > ask > taint > allow.
    Returns dict {deny, ask_target, taint, taint_detail}. `ask_target` is the
    org write target description (main builds the prompt via gate_prompt)."""
    result = {"deny": None, "ask_target": None, "taint": False, "taint_detail": None}
    private_roots = [os.path.realpath(v["path"]) for v in vaults
                     if v.get("path") and is_private(v)]

    # --- reads (structured tools) ---
    for p in read_targets(tool, ti, os.getcwd()):
        v = vault_for_path(p, vaults)
        if not v:
            continue
        d = read_decision(v, session_context)
        if d == "deny":
            result["deny"] = _deny_reason(v, p)
            return result
        if d == "taint":
            result["taint"] = True
            result["taint_detail"] = p

    # --- writes (structured tools) ---
    for p in write_targets(tool, ti):
        v = vault_for_path(p, vaults)
        if not v:
            continue
        if write_decision(v, session_context, tainted) == "ask":
            result["ask_target"] = _target_desc(v, p)

    # --- Bash: reads (deny/taint) then org writes (ask) ---
    if tool == "Bash" and command:
        # cross-context private read via Bash -> deny; same-context -> taint
        for v in vaults:
            root = v.get("path")
            if not (root and is_private(v)):
                continue
            root = os.path.realpath(root)
            if any(f in command for f in _path_forms(root)) and not mention_is_write_dest_only(command, root):
                if v.get("context") != session_context:
                    result["deny"] = _deny_reason(v, root)
                    return result
                result["taint"] = True
                result["taint_detail"] = root
        # org write via Bash
        for v in vaults:
            root = v.get("path")
            if not (root and is_org(v)):
                continue
            root = os.path.realpath(root)
            if any(f in command for f in _path_forms(root)) and BASH_WRITE_RE.search(command):
                if write_decision(v, session_context, tainted) == "ask":
                    result["ask_target"] = _target_desc(v, root)

    return result


def _deny_reason(vault, path):
    return (
        f"Cross-context read blocked (ADR-0008): {vault.get('name', 'a')} is a "
        f"private vault owned by the '{vault.get('context')}' context and this "
        "session is elsewhere. It is not readable here — ask Phil to paste in "
        "anything you need from it."
    )


def _target_desc(vault, path):
    root = vault.get("path")
    rel = os.path.relpath(path, os.path.realpath(root)) if root else os.path.basename(path)
    return f"{vault.get('name', 'vault')}/{rel}"
```

Rewire `main` (replacing the current body from the `private, org = vault_paths()` line down):
```python
def main(data):
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    session = data.get("session_id", "unknown")
    cwd = data.get("cwd") or os.getcwd()

    vaults = get_vaults()
    if not vaults:
        return
    session_context = get_session_context(cwd)

    sdir = os.path.join(STATE, "sessions", session)
    taint_file = os.path.join(sdir, "tainted")
    taint_info = read_taint_marker(taint_file)
    tainted = taint_info is not None

    command = ti.get("command", "") if tool == "Bash" else ""
    verdict = evaluate(tool, ti, command, vaults, session_context, tainted)

    # 1. Hard deny (cross-context private read) — highest priority.
    if verdict["deny"]:
        audit("read_deny", session, {"tool": tool, "detail": verdict["taint_detail"]})
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": verdict["deny"],
        }}))
        return

    # 2. Set/enrich taint on an allowed same-context private read.
    if verdict["taint"] and not tainted:
        write_taint_marker(taint_file, tool, verdict["taint_detail"])
        audit("taint_set", session, {"tool": tool, "path": verdict["taint_detail"]})
        taint_info = read_taint_marker(taint_file)

    # 3. Gate an org write (cross-context, or same-context while tainted).
    if verdict["ask_target"]:
        audit("gate_trip", session, {
            "tool": tool, "target": verdict["ask_target"],
            "command": (command[:200] if command else None),
        })
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "ask",
            "permissionDecisionReason": gate_prompt(taint_info or {"provenance": "unknown"}, verdict["ask_target"]),
        }}))
```

Delete the now-dead `vault_paths` and the old inline `touched_paths` if fully superseded (keep `touched_paths` only if still referenced; `read_targets`/`write_targets` replace it). Keep `mentions`/`under` (still used).

> **Important:** an org write that is `ask` should still fire even if the session is *not* tainted (cross-context case). And a same-context org write while tainted must `ask`. `evaluate` already encodes both via `write_decision`. When `ask_target` is set but the session was never tainted (cross-context), `gate_prompt` receives `{"provenance": "unknown"}` — acceptable, but tighten the wording: if not tainted, prefer a cross-context reason. Optionally branch in `main`: if `not tainted and verdict["ask_target"]`, use a cross-context prompt string instead of `gate_prompt`. Add a test `test_cross_context_org_write_asks_even_when_clean` already covers the decision; extend its assertions if you special-case the wording.

- [ ] **Step 4: Run to verify pass**

Run: `uv run --with pytest --with pyyaml --no-project -- pytest tests/test_taint_main.py -v`
Expected: PASS (all scenarios incl. the acceptance test).

- [ ] **Step 5: Full suite + syntax/exec sanity**

```bash
uv run --with pytest --with pyyaml --no-project -- pytest tests/ -v
python3 -c "import ast; ast.parse(open('dot_claude/hooks/executable_eos-taint-gate.py').read())"
echo '{}' | python3 dot_claude/hooks/executable_eos-taint-gate.py; echo "exit=$?"   # empty payload => exit 0, no crash
```
Expected: all tests pass; `ast.parse` clean; empty-payload run exits 0.

- [ ] **Step 6: Commit**

```bash
git add dot_claude/hooks/executable_eos-taint-gate.py tests/test_taint_main.py
git commit -m "feat(taint): stateless ACL orchestrator + directionality-correct taint (ADR-0008)"
```

---

## Task 7: ADR-0008, forward amendments, glossary + skill + CLAUDE.md sweep

**Files:**
- Create: `docs/adr/0008-personal-is-not-private.md`
- Modify: `docs/adr/0002-exposure-is-a-one-way-ratchet.md` (append forward note)
- Modify: `docs/adr/0005-session-taint-gates-org-writes.md` (append forward note)
- Modify: `CONTEXT.md` (exposure + taint glossary entries)
- Modify: `dot_claude/skills/knowledge-routing/SKILL.md` (exposure/roleless wording)
- Modify: `dot_claude/CLAUDE.md:33` (exposure/ratchet wording)
- Test: none (prose). Verification is a literal re-sweep (Step 6).

**Interfaces:** none (documentation).

- [ ] **Step 1: Write ADR-0008**

`docs/adr/0008-personal-is-not-private.md` — cover, in the house ADR voice (short lede + Considered options + Consequences), all of:
- The split: `exposure: org|personal` (visibility) ⟂ `private: true|false` (sensitivity), with the governance matrix table (copy from Global Constraints).
- Governance as stateless read/write ACLs over context × privacy (the two rules verbatim from the spec's "Governance rules").
- **Repos are never vaults** — a stated guarantee (previously an implementation accident).
- Worklog `log/` writes are plumbing-into-wiki — same ACL as any vault write (mirror the De-spec Queue "transient plumbing" precedent).
- The three defects it fixes (directionality bug, illegible prompt, overloaded vocabulary) with the 2026-07-28 audit evidence (every `taint_set` that day was the worklog-routine false positive).
- Taint demoted to transitional backstop; **retirement condition** recorded: Easygo vault migrated (#25) AND zero gate trips over 30 consecutive audit days ⇒ delete the taint machinery in a follow-up (data-triggered, per ADR-0005's own principle).

- [ ] **Step 2: Forward-amend ADR-0002**

Append a section (do not rewrite history):
```markdown
## Amendment (2026-07-28, ADR-0008)

The single fact `exposure: org | private` this ADR introduced is superseded by
two orthogonal per-vault facts — `exposure: org | personal` (who may see it)
and `private: true | false` (whether contents are sensitive). "Personal" is
not "private": Tech Notes is personal-exposed yet non-private. The one-way
ratchet and source-visibility rule are unchanged in spirit; see
[ADR-0008](0008-personal-is-not-private.md).
```

- [ ] **Step 3: Forward-amend ADR-0005**

Append:
```markdown
## Amendment (2026-07-28, ADR-0008)

This ADR set taint on any *touch* of a private path, including writes *into*
the Journal — which tripped the gate on the end-of-session worklog routine
(a false positive on nearly every easygo session; see the 2026-07-28 audit).
[ADR-0008](0008-personal-is-not-private.md) demotes taint to a transitional
backstop: it is set only by an actual same-context **read** from a
`private: true` vault; writes-down never taint; cross-context private reads
are hard-denied upstream. "Reads stay unrestricted everywhere" is amended —
private-vault reads are now same-context-only. Retirement of the taint
machinery is data-triggered (see ADR-0008).
```

- [ ] **Step 4: Update CONTEXT.md glossary**

- **Exposure** entry (line ~21): reframe as `org | personal` (who can read the vault), and add that a separate **`private`** boolean marks sensitive contents; note "personal ≠ private" with Tech Notes as the example. Preserve the "property of the vault, never per-note" point and the contrast with sensitivity classification.
- **Taint** entry (line ~49): rewrite to the ADR-0008 model — set only by a same-context read of a `private: true` vault; cross-context private reads hard-denied; writes-down never taint; transitional backstop for the draining Easygo path. Keep the "no laundering" and "conservative provenance" points.
- Leave the **Promotion**, **De-specification**, **Cross-vault reference** entries' use of "exposure" intact (still valid — they speak of exposure-direction, which survives the rename). Only fix places that assert `exposure` has the value `private`.

- [ ] **Step 5: Update knowledge-routing SKILL.md + CLAUDE.md**

- `knowledge-routing/SKILL.md:43` "private→org as URL; org→private never" — still valid as exposure-direction; leave unless it reads as a value. Line 27 "exposure doubt → default down" — still valid. No change needed unless a literal `exposure: private` value appears (it does not). **Verify, minimal/no edit.**
- `dot_claude/CLAUDE.md:33` "Exposure only ever ratchets up via a human gate" — still conceptually valid (the ratchet survives). Leave the ratchet sentence; if desired, add a half-line pointer: "(exposure ∈ org|personal; sensitivity is the separate `private` flag — ADR-0008)". Keep edits minimal — this file is deployed.

- [ ] **Step 6: Re-sweep for stale literals**

```bash
grep -rniE 'exposure:\s*private|"private"\s*if|exposure == "private"' \
  .chezmoidata dot_claude dot_local docs CONTEXT.md .chezmoitemplates 2>/dev/null \
  | grep -v docs/superpowers/  || echo "NO STALE LITERALS (good)"
```
Expected: `NO STALE LITERALS (good)` — no code compares `exposure == "private"`, no YAML sets `exposure: private`.

- [ ] **Step 7: Commit**

```bash
git add docs/adr/0008-personal-is-not-private.md \
        docs/adr/0002-exposure-is-a-one-way-ratchet.md \
        docs/adr/0005-session-taint-gates-org-writes.md \
        CONTEXT.md dot_claude/skills/knowledge-routing/SKILL.md dot_claude/CLAUDE.md
git commit -m "docs(eos): ADR-0008 + forward amendments + glossary/skill sweep for the split"
```

---

## Final verification (run before declaring done)

- [ ] **Full test suite green:** `uv run --with pytest --with pyyaml --no-project -- pytest tests/ -v` — all pass.
- [ ] **All shipped scripts parse & fail-open:** for each of the four hooks + the resolver, `python3 -c "import ast; ast.parse(open(P).read())"`, and `echo '{}' | python3 <hook>` exits 0.
- [ ] **Registry renders & resolves:** `eos-resolve vaults --json` shows `exposure ∈ {org,personal}` + `private` on every vault; `eos-resolve mounts` shows the private markers.
- [ ] **chezmoi will not deploy tests:** `chezmoi --source="$(pwd)" managed --path-style=absolute | grep -E '/tests/' || echo clean`.
- [ ] **Acceptance criterion (directionality bug dead):** `test_scenario_worklog_routine_no_taint_no_gate` passes — the end-of-session worklog routine produces zero gate interaction.
- [ ] **No stale literals:** the Step-6 sweep prints the clean sentinel.
- [ ] **Do not push / open PR** — stop and ask Phil (per session directive).

---

## Self-Review (author checklist — completed at plan-writing time)

**Spec coverage:**
- Directionality bug (Problem 1) → Task 4 heuristic + Task 6 `evaluate`/scenario (a). ✓
- Illegible prompt (Problem 2) → Task 5 `gate_prompt` (four elements) + Task 6 wiring. ✓
- Overloaded vocabulary (Problem 3) → Task 2 schema split + Task 7 docs. ✓
- Decision/ADR-0008 matrix → Task 2 (data) + Task 7 (ADR). ✓
- Governance rule 1 reads → Task 4 `read_decision` + Task 6 deny path. ✓
- Governance rule 2 writes → Task 4 `write_decision` + Task 6 ask path. ✓
- Rule 3 repos-not-vaults → Task 6 `test_repo_paths_never_gated` + ADR guarantee. ✓
- Rule 4 log/ plumbing vocabulary → Task 7 ADR/doc prose (no code special-case needed — path resolves to its vault). ✓
- Taint set only by same-context private read → Task 4/6 + scenario (c). ✓
- Bash directionality carve-outs + ambiguous → Task 4 tests. ✓
- Marker records {ts,tool,detail}; legacy empty ⇒ unknown → Task 5. ✓
- Self-sufficient prompt from state → Task 5. ✓
- Audit enrichment (taint_set path; gate_trip target+command) → Task 6 `main`. ✓
- Retirement condition recorded in ADR-0008 → Task 7. ✓
- Registry schema via registry-maintenance; resolver emits both; readers keep working → Tasks 2/3 + no-change-verify list. ✓
- Pulse/worklog non-regression through rename → Stop hook & pulse untouched (no exposure literal); verified in Final verification. ✓
- Stop hook must not pre-create shards → unchanged (not modified). ✓
- Fail-open + breadcrumb unchanged → Global Constraints + Final verification. ✓
- Tests at repo root, never deployed → Task 1 `.chezmoiignore`. ✓
- Scenario replays (a)(b)(c) → Task 6. ✓

**Type consistency:** `evaluate` returns `{deny, ask_target, taint, taint_detail}`; `main` consumes exactly those keys. `read_decision`→{"deny","taint","allow"}; `write_decision`→{"ask","allow"}; both consumed in `evaluate`. `read_taint_marker`→dict|None consumed by `main` (`tainted = info is not None`) and `gate_prompt`. Fixture `world` shape matches `get_vaults()` contract (context/role/name/exposure/private/path). Consistent.

**Placeholder scan:** the only deferred decision is the `chezmoi execute-template` inline-data mechanism in Task 2 Step 1 (explicit fallback provided: assert template *source* contains `"private" $v.private`). No TODO/TBD/"handle errors" placeholders.
