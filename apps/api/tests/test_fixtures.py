import pytest
from conftest import FIXTURE_DIR, drain

from pogoscout_api.replay.generate import BUILDERS
from pogoscout_api.replay.scenario import load_expected, load_scenario


def replay_to_end(client, scenario_id: str, mission_id: str) -> dict:
    body = {"scenario_id": scenario_id, "mission_id": mission_id}
    assert client.post("/api/v1/replays", json=body).status_code == 201
    total = len(load_scenario(FIXTURE_DIR / scenario_id).events)
    for _ in range(total):
        state = client.post(f"/api/v1/missions/{mission_id}/replay/step").json()
    assert state["finished"] and state["cursor"] == total
    drain(client)
    return client.get(f"/api/v1/missions/{mission_id}/cells").json()


@pytest.mark.parametrize("name", list(BUILDERS))
def test_fixture_replays_to_expected_projection(client, name) -> None:
    """Golden test: replaying through the public services yields the expected projection."""
    expected = load_expected(FIXTURE_DIR / name)
    cells = replay_to_end(client, name, "golden")
    assert cells["current"] == expected["current"]
    assert cells["path"] == expected["path"]
    assert cells["pending_hop_ids"] == expected["pending_hop_ids"]
    keys = ("x", "y", "hop_ids", "metal", "voc", "quality", "flags")
    got = [
        {
            **{k: c[k] for k in keys},
            "material": {k: c["material"][k] for k in ("status", "label", "confidence")},
        }
        for c in cells["cells"]
    ]
    want = [{k: c[k] for k in (*keys, "material")} for c in expected["cells"]]
    assert got == want
    summary = client.get("/api/v1/missions/golden").json()
    assert summary["status"] == "complete"
    assert summary["scenario_id"] == name


@pytest.mark.parametrize("name", list(BUILDERS))
def test_generator_is_deterministic(tmp_path, name) -> None:
    BUILDERS[name](tmp_path / name)
    generated = sorted(p.relative_to(tmp_path / name) for p in (tmp_path / name).rglob("*.*"))
    committed = sorted(
        p.relative_to(FIXTURE_DIR / name)
        for p in (FIXTURE_DIR / name).rglob("*.*")
        if p.name != ".gitkeep"
    )
    assert generated == committed
    for rel in generated:
        assert (tmp_path / name / rel).read_bytes() == (FIXTURE_DIR / name / rel).read_bytes()


def test_park_connector_layout() -> None:
    scenario = load_scenario(FIXTURE_DIR / "park_connector_v1")
    expected = load_expected(FIXTURE_DIR / "park_connector_v1")
    assert len({e.hop_id for e in scenario.events}) == 36
    assert len(expected["cells"]) == 36
    by_xy = {(c["x"], c["y"]): c for c in expected["cells"]}
    assert by_xy[(5, 3)]["material"] == {
        "status": "succeeded",
        "label": "water",
        "confidence": 0.97,
    }
    assert by_xy[(1, 1)]["material"]["label"] == "water"
    assert by_xy[(1, 2)]["flags"] == ["metal", "low_confidence"]
    assert by_xy[(4, 3)]["metal"] == "detected" and by_xy[(0, 5)]["voc"] == "detected"


def test_failures_fixture_quality_states(client) -> None:
    cells = replay_to_end(client, "failures_v1", "faults")
    by_xy = {(c["x"], c["y"]): c for c in cells["cells"]}
    assert by_xy[(1, 2)]["quality"] == "conflicting"
    assert by_xy[(2, 2)]["quality"] == "missing" and by_xy[(2, 2)]["material"]["status"] == "none"
    assert by_xy[(1, 0)]["quality"] == "missing"
    assert by_xy[(2, 0)]["metal"] == "sensor_error"
    assert by_xy[(0, 1)]["quality"] == "low_confidence" and by_xy[(0, 1)]["visit_count"] == 2
    kinds = [e["kind"] for e in client.get("/api/v1/missions/faults/events?limit=500").json()]
    for kind in ("hop_duplicate", "hop_conflict", "hop_pending", "sensor_error"):
        assert kind in kinds
    hops = client.get("/api/v1/missions/faults/hops").json()
    assert [h["hop_id"] for h in hops] == list(range(1, 10))


def test_scenarios_endpoint(client) -> None:
    scenarios = {s["scenario_id"]: s for s in client.get("/api/v1/scenarios").json()}
    assert set(scenarios) == set(BUILDERS)
    assert scenarios["clean_baseline_v1"]["hops"] == 22
    assert scenarios["clean_baseline_v1"]["events"] == 44
    assert scenarios["park_connector_v1"]["hops"] == 36
