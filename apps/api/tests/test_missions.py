from conftest import drain, hop, png, upload


def test_summary_stats(client, mission) -> None:
    empty = client.get(f"/api/v1/missions/{mission}").json()
    assert empty["status"] == "live" and empty["status_note"] is None
    assert empty["started_at"] is None and empty["last_hop_at"] is None
    assert empty["scenario_id"] is None
    assert empty["stats"] == {
        "hops": 0,
        "cells": 0,
        "metal": 0,
        "voc": 0,
        "flags": 0,
        "materials": {},
    }

    base = f"/api/v1/missions/{mission}/hops"
    client.put(f"{base}/1", json=hop("F", metal=(1, "ok"), second=1))
    client.put(f"{base}/2", json=hop("B", voc=(1, "ok"), second=2))
    client.put(f"{base}/3", json=hop("F", second=3))  # revisits (0, 1)
    client.put(f"{base}/5", json=hop("F", second=5))  # pending
    for hop_id, label in [(1, "soil"), (2, "concrete"), (3, "soil")]:
        upload(client, mission, hop_id, png(), label_hint=label, confidence_hint=0.9)
    drain(client)
    summary = client.get(f"/api/v1/missions/{mission}").json()
    assert summary["started_at"] == "2026-09-25T08:00:01Z"
    assert summary["last_hop_at"] == "2026-09-25T08:00:03Z"
    assert summary["stats"] == {
        "hops": 4,
        "cells": 2,
        "metal": 1,
        "voc": 1,
        "flags": 2,
        "materials": {"concrete": 1, "soil": 1},
    }


def test_patch_status(client, mission) -> None:
    url = f"/api/v1/missions/{mission}"
    body = {"status": "aborted", "status_note": "Link lost after hop 9"}
    patched = client.patch(url, json=body).json()
    assert patched["status"] == "aborted" and patched["status_note"] == "Link lost after hop 9"
    event = client.get(f"{url}/events").json()[0]
    assert event["kind"] == "mission_status" and event["level"] == "info"
    assert event["message"] == "Mission marked aborted: Link lost after hop 9"
    assert client.patch(url, json={"status": "paused"}).status_code == 422
    assert client.patch("/api/v1/missions/nope", json={"status": "live"}).status_code == 404
    assert client.patch(url, json={"status": "complete"}).json()["status_note"] is None


def test_list_newest_first(client) -> None:
    for name in ("a", "b", "c"):
        client.post("/api/v1/missions", json={"name": name, "mission_id": name})
    assert [m["id"] for m in client.get("/api/v1/missions").json()] == ["c", "b", "a"]
