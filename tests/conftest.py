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
