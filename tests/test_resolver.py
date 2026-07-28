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
