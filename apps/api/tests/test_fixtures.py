import pytest
from conftest import FIXTURE_DIR

from pogoscout_api.replay.generate import BUILDERS
from pogoscout_api.replay.scenario import HopEvent, load_expected, load_scenario


@pytest.mark.parametrize("name", list(BUILDERS))
def test_fixture_replays_to_expected_projection(client, name) -> None:
    """Golden test: replaying a fixture through the public API yields its expected projection."""
    directory = FIXTURE_DIR / name
    scenario = load_scenario(directory)
    expected = load_expected(directory)
    mission = client.post("/api/v1/missions", json={"name": scenario.mission.name}).json()["id"]
    for event in scenario.events:
        if isinstance(event, HopEvent):
            response = client.put(
                f"/api/v1/missions/{mission}/hops/{event.hop_id}",
                json=event.payload.model_dump(mode="json"),
            )
            assert response.status_code == 201

    cells = client.get(f"/api/v1/missions/{mission}/cells").json()
    assert cells["current"] == expected["current"]
    assert cells["path"] == expected["path"]
    assert cells["pending_hop_ids"] == expected["pending_hop_ids"]
    got = [{k: c[k] for k in ("x", "y", "hop_ids", "metal", "voc")} for c in cells["cells"]]
    assert got == expected["cells"]


@pytest.mark.parametrize("name", list(BUILDERS))
def test_generator_is_deterministic(tmp_path, name) -> None:
    BUILDERS[name](tmp_path / name)
    for rel in ["scenario.json", "expected_projection.json", "images/hop_001.png"]:
        assert (tmp_path / name / rel).read_bytes() == (FIXTURE_DIR / name / rel).read_bytes()
