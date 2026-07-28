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
