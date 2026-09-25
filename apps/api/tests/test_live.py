import pytest
from conftest import hop
from starlette.websockets import WebSocketDisconnect


def test_changed_notifications(client, mission) -> None:
    with client.websocket_connect(f"/api/v1/missions/{mission}/live") as ws:
        client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
        message = ws.receive_json()
        assert message == {
            "type": "changed",
            "mission_id": mission,
            "topics": ["hops", "cells", "events", "mission"],
            "hop_id": 1,
        }
        client.patch(f"/api/v1/missions/{mission}", json={"status": "complete"})
        assert ws.receive_json()["topics"] == ["events", "mission"]


def test_replay_step_notifies(client) -> None:
    client.post("/api/v1/replays", json={"scenario_id": "clean_baseline_v1", "mission_id": "r"})
    with client.websocket_connect("/api/v1/missions/r/live") as ws:
        client.post("/api/v1/missions/r/replay/step")
        topics = set()
        for _ in range(2):
            topics.update(ws.receive_json()["topics"])
        assert {"hops", "cells", "replay"} <= topics


def test_ping(make_client) -> None:
    client = make_client(live_ping_s=0.05)
    client.post("/api/v1/missions", json={"name": "p", "mission_id": "p"})
    with client.websocket_connect("/api/v1/missions/p/live") as ws:
        assert ws.receive_json() == {"type": "ping"}


def test_unknown_mission_closes(client) -> None:
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect("/api/v1/missions/nope/live") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_disconnect_unsubscribes(client, mission) -> None:
    hub = client.app.state.ctx.hub
    with client.websocket_connect(f"/api/v1/missions/{mission}/live"):
        client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
    client.put(f"/api/v1/missions/{mission}/hops/2", json=hop("F"))  # no subscriber, no error
    import time

    deadline = time.monotonic() + 2
    while hub.subscriber_count(mission) and time.monotonic() < deadline:
        time.sleep(0.01)
    assert hub.subscriber_count(mission) == 0
