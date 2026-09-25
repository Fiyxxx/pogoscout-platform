import json
import shutil
import time

from conftest import FIXTURE_DIR


def test_step_and_state(client) -> None:
    created = client.post(
        "/api/v1/replays", json={"scenario_id": "clean_baseline_v1", "mission_id": "r1"}
    )
    assert created.status_code == 201
    summary = created.json()
    assert summary["status"] == "live" and summary["source"] == "mock"
    assert summary["scenario_id"] == "clean_baseline_v1" and summary["name"] == "Clean baseline"
    assert summary["stats"]["hops"] == 0

    state = client.get("/api/v1/missions/r1/replay").json()
    assert state == {
        "scenario_id": "clean_baseline_v1",
        "cursor": 0,
        "total": 44,
        "playing": False,
        "speed": 1,
        "finished": False,
    }
    for _ in range(3):
        state = client.post("/api/v1/missions/r1/replay/step").json()
    assert state["cursor"] == 3
    assert len(client.get("/api/v1/missions/r1/hops").json()) == 2
    image = client.get("/api/v1/missions/r1/hops/1/image")
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"


def test_replay_errors(client, mission) -> None:
    assert client.post("/api/v1/replays", json={"scenario_id": "nope"}).status_code == 404
    assert client.get(f"/api/v1/missions/{mission}/replay").status_code == 404
    assert client.get("/api/v1/missions/nope/replay").status_code == 404
    body = {"scenario_id": "clean_baseline_v1", "mission_id": mission}
    assert client.post("/api/v1/replays", json=body).status_code == 409
    auto = client.post("/api/v1/replays", json={"scenario_id": "failures_v1", "name": "X"})
    assert auto.json()["id"].startswith("m-") and auto.json()["name"] == "X"
    mid = auto.json()["id"]
    bad_speed = client.post(f"/api/v1/missions/{mid}/replay/play", json={"speed": 3})
    assert bad_speed.status_code == 422


def fast_fixture_dir(tmp_path, delta_ms: int):
    """Copy failures_v1 with compressed timing so timed play finishes quickly."""
    root = tmp_path / "fixtures"
    shutil.copytree(FIXTURE_DIR / "failures_v1", root / "failures_v1")
    path = root / "failures_v1" / "scenario.json"
    scenario = json.loads(path.read_text())
    for index, event in enumerate(scenario["events"]):
        event["at_ms"] = index * delta_ms
    path.write_text(json.dumps(scenario))
    return root


def wait_for(predicate, timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("condition not met in time")


def test_timed_play_to_completion(make_client, tmp_path) -> None:
    client = make_client(fixture_dir=fast_fixture_dir(tmp_path, 16))
    client.post("/api/v1/replays", json={"scenario_id": "failures_v1", "mission_id": "p"})
    started = time.monotonic()
    state = client.post("/api/v1/missions/p/replay/play", json={"speed": 8}).json()
    assert state["playing"] and state["speed"] == 8
    wait_for(lambda: client.get("/api/v1/missions/p/replay").json()["finished"])
    elapsed = time.monotonic() - started
    assert elapsed >= 18 * 16 / 8 / 1000  # deltas divided by speed are respected
    state = client.get("/api/v1/missions/p/replay").json()
    assert state["cursor"] == state["total"] == 19 and not state["playing"]
    assert client.get("/api/v1/missions/p").json()["status"] == "complete"


def test_pause_stops_play(make_client, tmp_path) -> None:
    client = make_client(fixture_dir=fast_fixture_dir(tmp_path, 400))
    client.post("/api/v1/replays", json={"scenario_id": "failures_v1", "mission_id": "p"})
    client.post("/api/v1/missions/p/replay/play", json={"speed": 1})
    wait_for(lambda: client.get("/api/v1/missions/p/replay").json()["cursor"] >= 1)
    paused = client.post("/api/v1/missions/p/replay/pause").json()
    assert not paused["playing"]
    cursor = paused["cursor"]
    time.sleep(0.5)
    assert client.get("/api/v1/missions/p/replay").json()["cursor"] == cursor
    assert client.post("/api/v1/missions/p/replay/step").json()["cursor"] == cursor + 1


def test_abort_pauses_play(make_client, tmp_path) -> None:
    client = make_client(fixture_dir=fast_fixture_dir(tmp_path, 400))
    client.post("/api/v1/replays", json={"scenario_id": "failures_v1", "mission_id": "p"})
    client.post("/api/v1/missions/p/replay/play", json={"speed": 1})
    client.patch("/api/v1/missions/p", json={"status": "aborted", "status_note": "Link lost"})
    wait_for(lambda: not client.get("/api/v1/missions/p/replay").json()["playing"])
