from conftest import drain, hop, png, upload


def events(client, mission, limit=200) -> list[dict]:
    return client.get(f"/api/v1/missions/{mission}/events?limit={limit}").json()


def test_hop_events_and_wording(client, mission) -> None:
    base = f"/api/v1/missions/{mission}/hops"
    client.put(f"{base}/1", json=hop("F", metal=(1, "ok"), second=1))
    client.put(f"{base}/2", json=hop("R", voc=(1, "ok"), second=2))
    client.put(f"{base}/3", json=hop("F", metal=(None, "error"), voc=(None, "missing"), second=3))
    got = events(client, mission)
    assert got[0]["id"] > got[-1]["id"]  # newest first
    messages = [e["message"] for e in reversed(got)]
    assert messages == [
        "Hop 1 landed at (0, 1)",
        "Metal anomaly at (0, 1)",
        "Hop 2 landed at (1, 1)",
        "VOC cue at (1, 1)",
        "Hop 3 landed at (1, 2)",
        "Metal sensor error at (1, 2)",
        "VOC reading missing at (1, 2)",
    ]
    by_message = {e["message"]: e for e in got}
    metal = by_message["Metal anomaly at (0, 1)"]
    assert metal["kind"] == "metal_detected" and metal["level"] == "alert"
    assert (metal["hop_id"], metal["x"], metal["y"]) == (1, 0, 1)
    assert metal["at"] == "2026-09-25T08:00:01Z"
    assert by_message["VOC cue at (1, 1)"]["kind"] == "voc_detected"
    assert by_message["Metal sensor error at (1, 2)"]["level"] == "warning"
    assert all("—" not in e["message"] for e in got)
    assert len(events(client, mission, limit=2)) == 2


def test_duplicate_conflict_and_out_of_order_events(client, mission) -> None:
    base = f"/api/v1/missions/{mission}/hops"
    client.put(f"{base}/2", json=hop("R"))
    pending = events(client, mission)[0]
    assert pending["kind"] == "hop_pending" and pending["level"] == "warning"
    assert pending["message"] == "Hop 2 arrived out of order, waiting for hop 1"
    assert pending["x"] is None

    client.put(f"{base}/1", json=hop("F"))
    kinds = [e["kind"] for e in events(client, mission)[:2]]
    assert kinds == ["hop_accepted", "hop_accepted"]  # hop 1, then the released hop 2

    assert client.put(f"{base}/1", json=hop("F")).status_code == 200
    dup = events(client, mission)[0]
    assert (dup["kind"], dup["level"]) == ("hop_duplicate", "debug")

    assert client.put(f"{base}/1", json=hop("B")).status_code == 409
    conflict = events(client, mission)[0]
    assert (conflict["kind"], conflict["level"], conflict["x"]) == ("hop_conflict", "warning", 0)
    cells = client.get(f"/api/v1/missions/{mission}/cells").json()["cells"]
    assert next(c for c in cells if c["hop_ids"] == [1])["quality"] == "conflicting"


def test_classification_events(client, mission) -> None:
    client.put(f"/api/v1/missions/{mission}/hops/1", json=hop("F"))
    client.put(f"/api/v1/missions/{mission}/hops/2", json=hop("F"))
    upload(client, mission, 1, png(), label_hint="soil", confidence_hint=0.93)
    upload(client, mission, 2, png(), label_hint="leaf_litter", confidence_hint=0.62)
    drain(client)
    by_kind = {}
    for e in events(client, mission):
        by_kind.setdefault(e["kind"], e)
    assert by_kind["classification_succeeded"]["message"] == "Hop 1 classified as soil (0.93)"
    low = by_kind["classification_low_confidence"]
    assert low["message"] == "Low confidence at (0, 2)" and low["level"] == "warning"
    assert by_kind["image_stored"]["level"] == "debug"
    assert by_kind["classification_queued"]["level"] == "debug"


def test_events_unknown_mission(client) -> None:
    assert client.get("/api/v1/missions/nope/events").status_code == 404
