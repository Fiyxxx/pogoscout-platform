from conftest import hop


def test_missions_without_a_fix_stay_off_the_theatre(client, mission) -> None:
    assert client.get(f"/api/v1/missions/{mission}").json()["geo"] is None
    assert client.get("/api/v1/world").json() == {"missions": []}


def test_world_lists_anchored_missions_with_compact_cells(client) -> None:
    geo = {"lat": 1.3571, "lon": 103.7362, "heading_deg": 20.0, "cell_m": 1.0}
    created = client.post("/api/v1/missions", json={"name": "Fix", "mission_id": "g1", "geo": geo})
    assert created.json()["geo"] == geo
    client.put("/api/v1/missions/g1/hops/1", json=hop("F", metal=(1, "ok")))
    client.put("/api/v1/missions/g1/hops/2", json=hop("R", voc=(1, "ok")))

    world = client.get("/api/v1/world").json()["missions"]
    assert [w["mission"]["id"] for w in world] == ["g1"]
    entry = world[0]
    assert entry["geo"] == geo
    assert entry["current"] == {"x": 1, "y": 1}
    assert sorted(entry["cells"]) == [[0, 1, None, 1, 0], [1, 1, None, 0, 1]]

    client.put("/api/v1/missions/g1/hops/3", json=hop("F"))
    again = client.get("/api/v1/world").json()["missions"][0]
    assert len(again["cells"]) == 3 and again["current"] == {"x": 1, "y": 2}


def test_replays_default_to_their_scenario_site(client) -> None:
    body = {"scenario_id": "park_connector_v1", "mission_id": "p1"}
    summary = client.post("/api/v1/replays", json=body).json()
    assert summary["geo"]["lat"] == 1.3406 and summary["geo"]["cell_m"] == 1.0


def test_invalid_anchor_is_rejected(client) -> None:
    geo = {"lat": 95, "lon": 103.7, "heading_deg": 0, "cell_m": 2}
    body = {"name": "Bad", "geo": geo}
    assert client.post("/api/v1/missions", json=body).status_code == 422


def test_cell_size_is_fixed_for_every_mission(client) -> None:
    geo = {"lat": 1.3571, "lon": 103.7362, "heading_deg": 20.0}
    created = client.post("/api/v1/missions", json={"name": "Fix", "geo": geo}).json()
    assert created["geo"]["cell_m"] == 1.0
    bad = {**geo, "cell_m": 2.0}
    assert client.post("/api/v1/missions", json={"name": "Bad", "geo": bad}).status_code == 422
