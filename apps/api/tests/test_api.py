from conftest import hop


def test_mission_lifecycle(client) -> None:
    created = client.post("/api/v1/missions", json={"name": "alpha"}).json()
    assert created["id"].startswith("m-")
    assert client.get(f"/api/v1/missions/{created['id']}").json()["name"] == "alpha"
    assert [m["id"] for m in client.get("/api/v1/missions").json()] == [created["id"]]
    assert client.get("/api/v1/missions/nope").status_code == 404


def test_duplicate_mission_id_conflicts(client, mission) -> None:
    response = client.post("/api/v1/missions", json={"name": "x", "mission_id": mission})
    assert response.status_code == 409


def test_hop_idempotent_and_conflict(client, mission) -> None:
    url = f"/api/v1/missions/{mission}/hops/1"
    assert client.put(url, json=hop("F")).status_code == 201
    assert client.put(url, json=hop("F")).status_code == 200
    assert client.put(url, json=hop("R")).status_code == 409
    assert len(client.get(f"/api/v1/missions/{mission}/hops").json()) == 1


def test_hop_validation_and_unknown_mission(client, mission) -> None:
    bad = hop()
    bad["sensors"]["metal"] = {"value": None, "status": "ok"}
    assert client.put(f"/api/v1/missions/{mission}/hops/1", json=bad).status_code == 422
    assert client.put(f"/api/v1/missions/{mission}/hops/0", json=hop()).status_code == 422
    assert client.put("/api/v1/missions/nope/hops/1", json=hop()).status_code == 404


def test_cells_out_of_order(client, mission) -> None:
    base = f"/api/v1/missions/{mission}"
    client.put(f"{base}/hops/2", json=hop("R", metal=(1, "ok")))
    cells = client.get(f"{base}/cells").json()
    assert cells["cells"] == [] and cells["pending_hop_ids"] == [2]

    client.put(f"{base}/hops/1", json=hop("F", voc=(None, "error")))
    cells = client.get(f"{base}/cells").json()
    assert cells["pending_hop_ids"] == []
    assert cells["current"] == {"x": 1, "y": 1}
    by_xy = {(c["x"], c["y"]): c for c in cells["cells"]}
    assert by_xy[(0, 1)]["voc"] == "sensor_error"
    assert by_xy[(1, 1)]["metal"] == "detected"
