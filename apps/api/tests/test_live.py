import asyncio
import time

import pytest
from conftest import hop
from starlette.websockets import WebSocketDisconnect

from pogoscout_api.live.hub import LiveHub


def test_changed_notifications(client, mission) -> None:
    with client.websocket_connect(f"/api/v1/missions/{mission}/live") as ws:
        client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
        message = ws.receive_json()
        assert message == {
            "type": "changed",
            "mission_id": mission,
            "topics": ["hops", "cells", "events", "mission"],
            "hop_id": 1,
            "hop_ids": [1],
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


async def test_hub_coalesces_bursts() -> None:
    hub = LiveHub(coalesce_s=0.1)
    subscriber = hub.subscribe("m")
    started = time.monotonic()
    for hop_id in range(1, 51):
        hub.publish("m", ["hops", "cells"], hop_id)
    hub.publish("m", ["replay"])
    first = await asyncio.wait_for(subscriber.queue.get(), 1)
    assert first["hop_ids"] == [1] and first["topics"] == ["hops", "cells"]
    merged = await asyncio.wait_for(subscriber.queue.get(), 1)
    assert time.monotonic() - started >= 0.09
    assert merged == {
        "type": "changed",
        "mission_id": "m",
        "topics": ["hops", "cells", "replay"],
        "hop_id": 50,
        "hop_ids": list(range(2, 51)),
    }
    assert subscriber.queue.empty()
    await asyncio.sleep(0.15)  # quiet period over: the next change goes out at once
    hub.publish("m", ["events"])
    assert (await asyncio.wait_for(subscriber.queue.get(), 0.05))["topics"] == ["events"]


async def test_hub_coalesces_per_mission_and_across_threads() -> None:
    hub = LiveHub(coalesce_s=0.1)
    a, b = hub.subscribe("a"), hub.subscribe("b")
    await asyncio.gather(
        *(asyncio.to_thread(hub.publish, m, ["cells"], h) for m in "ab" for h in range(1, 21))
    )
    for subscriber in (a, b):
        messages = [await asyncio.wait_for(subscriber.queue.get(), 1) for _ in range(2)]
        seen = sorted(h for message in messages for h in message["hop_ids"])
        assert seen == list(range(1, 21))
        await asyncio.sleep(0.15)
        assert subscriber.queue.empty()
