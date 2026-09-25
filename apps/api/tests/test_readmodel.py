"""Fast read model: identical to the Pydantic reference, cached, and never stale."""

import json

import pytest
from conftest import drain, hop, png, upload
from sqlalchemy import event, text

from pogoscout_api.application import readmodel, views
from pogoscout_api.persistence.db import Database, HopRow, MissionRow


def reference(client, mission_id: str) -> tuple[dict, dict]:
    with client.app.state.ctx.db.session_scope() as session:
        cells = json.loads(views.mission_cells(session, mission_id).model_dump_json())
        data = views.load_mission_data(session, mission_id)
        summary = views.build_summary(data).model_dump(mode="json")
    return cells, summary


@pytest.mark.parametrize("scenario_id", ["failures_v1", "park_connector_v1"])
def test_cells_and_summary_match_pydantic_reference(client, scenario_id) -> None:
    body = {"scenario_id": scenario_id, "mission_id": "r"}
    client.post("/api/v1/replays", json=body)
    for events in (7, 100):  # mid-replay (pending, queued) and complete
        client.post("/api/v1/missions/r/replay/advance", json={"events": events})
        for _ in range(2):  # before and after classification
            cells, summary = reference(client, "r")
            response = client.get("/api/v1/missions/r/cells")
            assert response.headers["content-type"] == "application/json"
            assert response.json() == cells
            assert client.get("/api/v1/missions/r").json() == summary
            assert client.get("/api/v1/missions").json() == [summary]
            drain(client)


def test_empty_mission_cells(client, mission) -> None:
    cells, summary = reference(client, mission)
    assert client.get(f"/api/v1/missions/{mission}/cells").json() == cells
    assert client.get(f"/api/v1/missions/{mission}").json() == summary


def test_cache_follows_every_write(client, mission) -> None:
    def cells() -> list[dict]:
        return client.get(f"/api/v1/missions/{mission}/cells").json()["cells"]

    assert cells() == []
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
    assert [c["hop_ids"] for c in cells()] == [[1]]
    upload(client, mission, 1, png())
    assert cells()[0]["material"]["status"] == "queued"
    drain(client)
    assert cells()[0]["material"]["status"] == "succeeded"
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F", metal=(1, "ok")))  # conflict
    assert cells()[0]["quality"] == "conflicting"
    client.put(f"/api/v1/missions/{mission}/hops/3", json=hop("F"))  # pending
    body = client.get(f"/api/v1/missions/{mission}/cells").json()
    assert body["pending_hop_ids"] == [3]
    client.patch(f"/api/v1/missions/{mission}", json={"status": "aborted", "status_note": "x"})
    summary = client.get(f"/api/v1/missions/{mission}").json()
    assert summary["status"] == "aborted" and summary["stats"]["hops"] == 2


def test_cached_reads_skip_the_heavy_queries(client, mission) -> None:
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
    client.get(f"/api/v1/missions/{mission}/cells")
    statements: list[str] = []
    engine = client.app.state.ctx.db.engine
    listener = lambda *args: statements.append(args[2])  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        client.get(f"/api/v1/missions/{mission}/cells")
        client.get("/api/v1/missions")
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    assert not any("hops.payload" in s for s in statements)
    assert not any("FROM classifications" in s and "GROUP BY" not in s for s in statements)


def test_readcache_is_bounded() -> None:
    cache = readmodel.ReadCache(capacity=2)
    stats = readmodel.StatsView(
        stats=readmodel.MissionStats(hops=0, cells=0, metal=0, voc=0, flags=0, materials={}),
        started_at=None,
        last_hop_at=None,
    )
    for mission_id in "abc":
        cache.put(mission_id, readmodel._Entry((0, 0, 0, 0), stats))
    assert cache.get("a", (0, 0, 0, 0)) is None
    assert cache.get("c", (0, 0, 0, 0)) is not None
    assert cache.get("c", (1, 0, 0, 0)) is None


def test_dx_dy_backfilled_for_old_databases(tmp_path) -> None:
    url = f"sqlite+pysqlite:///{tmp_path / 'old.sqlite3'}"
    db = Database(url)
    db.create_all()
    with db.session_scope() as session:
        session.add(MissionRow(id="m", name="m", source="mock"))
        payload = hop("R")
        session.add(HopRow(mission_id="m", hop_id=1, payload=payload, content_hash="x"))
        session.commit()
        session.execute(text("UPDATE hops SET dx = NULL, dy = NULL"))
        session.commit()
    Database(url).create_all()
    with db.session_scope() as session:
        row = session.get(HopRow, ("m", 1))
        session.refresh(row)
        assert (row.dx, row.dy) == (1, 0)
