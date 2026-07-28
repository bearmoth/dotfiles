import json
import pathlib
import re
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


def test_template_source_sets_private_on_both_entries():
    """The eos-registry template whitelists vault fields; both the vault and
    the roleless entry dicts must carry `private` or it never reaches JSON."""
    src = TEMPLATE.read_text()
    entries = re.findall(r'\$entry := dict [^\n]*', src)
    assert len(entries) == 2, entries
    for e in entries:
        assert '"private" $v.private' in e, e


@pytest.mark.skipif(shutil.which("chezmoi") is None, reason="chezmoi not installed")
def test_template_render_propagates_split_fields():
    """Render the real template against this source tree and prove the split
    fields survive into registry.json."""
    out = subprocess.run(
        ["chezmoi", "--source", str(REPO), "execute-template", TEMPLATE.read_text()],
        capture_output=True, text=True,
    )
    assert out.returncode == 0, out.stderr
    rendered = json.loads(out.stdout)
    tech = rendered["contexts"]["personal"]["vaults"]["wiki"]
    assert tech["exposure"] == "personal"
    assert tech["private"] is False
    pkb = rendered["contexts"]["easygo"]["vaults"]["wiki"]
    assert pkb["exposure"] == "org"
    assert pkb["private"] is False
    journal = rendered["contexts"]["personal"]["vaults"]["journal"]
    assert journal["private"] is True
