"""Live ground demo: the runner, the ground adapter and the ground-demo routes.

The ground service is an httpx.MockTransport, and the runner is driven one tick at a time; its
own clock is set to an hour so it never ticks during a test.
"""

import asyncio
import base64
import io
from collections.abc import Callable, Iterator
from pathlib import Path

import httpx
import pytest
from conftest import make_settings, png
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import func, select

from pogoscout_api.adapters.ground import GroundClient
from pogoscout_api.application.ground import GroundDemo, lawnmower_command
from pogoscout_api.domain.hops import MOVEMENT_VECTORS, HopPayload
from pogoscout_api.main import create_app
from pogoscout_api.persistence.db import InferenceJobRow

MODEL = "clip-vit-base-patch32+prompts-3f9a2c1d"


def jpeg(colour: tuple[int, int, int] = (120, 110, 100)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (48, 48), colour).save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


class FakeGround:
    """Stands in for the ground service. `reply` answers each /latest request."""

    def __init__(self) -> None:
        self.latest_calls = 0
        self.reply: Callable[[httpx.Request], httpx.Response] = lambda r: httpx.Response(
            503, json={"error": "no confident classification yet"}
        )

    def reading(self, label="gravel", confidence=0.91, captured_at=0.0, image=None, **extra):
        body = {
            "label": label,
            "confidence": confidence,
            "captured_at": captured_at,
            "age_s": 0.4,
            "model_version": MODEL,
            "image_jpeg_b64": base64.b64encode(image or jpeg()).decode(),
            **extra,
        }
        self.reply = lambda r: httpx.Response(200, json=body)
        return body

    def fail(self, exc: type[httpx.TransportError]) -> None:
        def reply(request: httpx.Request) -> httpx.Response:
            raise exc("simulated", request=request)

        self.reply = reply

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200, json={"status": "ok", "model_version": MODEL})
        self.latest_calls += 1
        return self.reply(request)


@pytest.fixture
def ground() -> FakeGround:
    return FakeGround()


@pytest.fixture
def make_demo(tmp_path: Path, ground: FakeGround) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(**overrides) -> TestClient:
        values = {"ground_enabled": True, "ground_hop_interval_s": 3600.0, **overrides}
        client = GroundClient("http://ground.test", transport=httpx.MockTransport(ground.handler))
        app = create_app(make_settings(tmp_path, **values), ground_client=client)
        test_client = TestClient(app)
        test_client.__enter__()
        clients.append(test_client)
        return test_client

    yield factory
    for test_client in clients:
        test_client.__exit__(None, None, None)


@pytest.fixture
def demo(make_demo) -> TestClient:
    return make_demo()


def runner(client: TestClient) -> GroundDemo:
    return client.app.state.ctx.ground  # type: ignore[attr-defined]


def start_time(client: TestClient) -> float:
    run = runner(client)._run
    assert run is not None
    return run.started_at


def tick(client: TestClient, at: float) -> int:
    return asyncio.run(runner(client).tick(at))


def mission_id(client: TestClient) -> str:
    return client.get("/api/v1/ground-demo").json()["mission_id"]


def events(client: TestClient, mid: str, kind: str) -> list[dict]:
    return [e for e in client.get(f"/api/v1/missions/{mid}/events").json() if e["kind"] == kind]


def classification(client: TestClient, mid: str, hop_id: int) -> dict:
    cells = client.get(f"/api/v1/missions/{mid}/cells").json()["cells"]
    for cell in cells:
        for observation in cell["observations"]:
            if observation["hop_id"] == hop_id:
                return observation
    raise AssertionError(f"hop {hop_id} not in cells")


def jobs(client: TestClient) -> int:
    with client.app.state.ctx.db.session_scope() as session:  # type: ignore[attr-defined]
        return session.scalar(select(func.count()).select_from(InferenceJobRow))


# A tick --------------------------------------------------------------------------------------


def test_tick_ingests_one_hop_with_its_reading(demo, ground):
    t0 = start_time(demo)
    mid = mission_id(demo)
    image = jpeg((200, 30, 30))
    ground.reading("gravel", 0.91, captured_at=t0 + 1.5, image=image)

    assert tick(demo, t0 + 2) == 1
    assert ground.latest_calls == 1
    hops = demo.get(f"/api/v1/missions/{mid}/hops").json()
    assert [h["hop_id"] for h in hops] == [1]

    observation = classification(demo, mid, 1)
    assert observation["image"]["content_type"] == "image/jpeg"
    result = observation["classification"]
    assert result["status"] == "succeeded"
    assert (result["label"], result["confidence"]) == ("gravel", 0.91)
    assert result["model_version"] == MODEL
    assert result["taxonomy_version"] == "ground-v1"
    assert jobs(demo) == 0  # the reading carries its own label: nothing is queued
    assert len(events(demo, mid, "image_stored")) == 1
    assert "gravel (0.91)" in events(demo, mid, "classification_succeeded")[0]["message"]
    assert not events(demo, mid, "classification_queued")


def test_low_confidence_reading_records_low_confidence_event(demo, ground):
    t0 = start_time(demo)
    ground.reading("mud", 0.55, captured_at=t0 + 1)
    tick(demo, t0 + 2)
    mid = mission_id(demo)
    (event,) = events(demo, mid, "classification_low_confidence")
    assert event["message"] == "Low confidence at (1, 0): mud (0.55)"
    assert not events(demo, mid, "classification_succeeded")


def test_wood_is_stored_as_wood(demo, ground):
    t0 = start_time(demo)
    ground.reading("wood", 0.93, captured_at=t0 + 1)
    tick(demo, t0 + 2)
    mid = mission_id(demo)
    assert classification(demo, mid, 1)["classification"]["label"] == "wood"
    # The existing views cope with a label outside pogo-materials-v2.
    assert demo.get(f"/api/v1/missions/{mid}").status_code == 200
    assert demo.get(f"/api/v1/missions/{mid}/risk").status_code == 200
    assert demo.get("/api/v1/world").status_code == 200


# Hops ----------------------------------------------------------------------------------------


def test_lawnmower_path_is_eight_cells_across_then_a_step():
    commands = "".join(lawnmower_command(n) for n in range(1, 34))
    assert commands == "RRRRRRRR" + "FLLLLLLL" + "FRRRRRRR" + "FLLLLLLL" + "F"
    x = y = 0
    visited = []
    for n in range(1, 34):
        dx, dy = MOVEMENT_VECTORS[lawnmower_command(n)]
        x, y = x + dx, y + dy
        visited.append((x, y))
    assert len(set(visited)) == len(visited)  # never revisits a cell
    assert {x for x, _ in visited} == set(range(1, 9))


def test_hops_are_numbered_in_order_with_valid_demo_payloads(demo, ground):
    t0 = start_time(demo)
    ground.reading(captured_at=t0)
    for n in range(1, 11):
        assert tick(demo, t0 + 2 * n) == n
    hops = demo.get(f"/api/v1/missions/{mission_id(demo)}/hops").json()
    assert [h["hop_id"] for h in hops] == list(range(1, 11))
    for n, stored in enumerate(hops, start=1):
        payload = HopPayload.model_validate(stored["payload"])
        assert payload.movement.command == lawnmower_command(n)
        assert payload.schema_version == "2.0"
        assert payload.source == "hardware"
        assert payload.producer_id == "ground-demo"
        assert payload.observed_at.timestamp() == pytest.approx(t0 + 2 * n)
        for sensor in (payload.sensors.metal, payload.sensors.voc):
            assert (sensor.value, sensor.status) == (None, "missing")


# Stale readings ------------------------------------------------------------------------------


def test_reading_not_replaced_since_the_previous_tick_is_stale(demo, ground):
    t0 = start_time(demo)
    mid = mission_id(demo)
    ground.reading("sand", 0.9, captured_at=t0 + 1.0)
    tick(demo, t0 + 2)  # captured after the start: fresh
    tick(demo, t0 + 4)  # the same reading again, captured before the previous tick: stale
    ground.reading("sand", 0.9, captured_at=t0 + 5.0, age_s=0.2)
    tick(demo, t0 + 6)  # new since the previous tick: fresh

    recent = demo.get(f"/api/v1/ground-demo/{mid}/hops").json()
    assert [(h["hop_id"], h["stale"]) for h in recent] == [(3, False), (2, True), (1, False)]
    messages = [e["message"] for e in events(demo, mid, "classification_succeeded")]
    stale = [m for m in messages if "stale" in m]
    assert stale == ["Hop 2 classified as sand (0.90) (stale reading, 0.4 s old)"]


# Failures ------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("setup", "reason"),
    [
        (lambda g: g.fail(httpx.ReadTimeout), "timeout: ReadTimeout"),
        (lambda g: g.fail(httpx.ConnectError), "unreachable: ConnectError"),
        (lambda g: None, "no confident classification yet"),  # the default reply is a 503
    ],
)
def test_unreachable_or_no_label_still_ingests_the_hop_as_unavailable(demo, ground, setup, reason):
    t0 = start_time(demo)
    mid = mission_id(demo)
    setup(ground)
    tick(demo, t0 + 2)
    assert ground.latest_calls == 1  # no retry

    observation = classification(demo, mid, 1)
    assert observation["image"] is None
    assert observation["classification"]["status"] == "unavailable"
    assert observation["classification"]["error"] == reason
    (event,) = events(demo, mid, "classification_failed")
    assert event["message"] == f"Ground service unavailable for hop 1: {reason}"

    ground.reading("concrete", 0.95, captured_at=t0 + 3)
    tick(demo, t0 + 4)  # the next tick fetches again as normal
    assert ground.latest_calls == 2
    assert classification(demo, mid, 2)["classification"]["status"] == "succeeded"


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        ({"label": "lava"}, "label 'lava' not in ground-v1"),
        ({"label": "no_decision"}, "label 'no_decision' not in ground-v1"),
        ({"confidence": 1.2}, "schema (confidence)"),
        ({"confidence": "0.9"}, "schema (confidence)"),
        ({"captured_at": "yesterday"}, "schema (captured_at)"),
        ({"image": png()}, "image is PNG, not JPEG"),
        ({"image": b"\xff\xd8\xff not really a jpeg"}, "image does not decode"),
    ],
)
def test_invalid_reading_is_failed_with_no_image_stored(demo, ground, fields, reason):
    t0 = start_time(demo)
    mid = mission_id(demo)
    ground.reading(**{"captured_at": t0 + 1, **fields})
    tick(demo, t0 + 2)

    observation = classification(demo, mid, 1)
    assert observation["image"] is None
    result = observation["classification"]
    assert result["status"] == "failed"
    assert result["error"] == f"invalid response: {reason}"
    assert not events(demo, mid, "image_stored")
    (event,) = events(demo, mid, "classification_failed")
    assert event["message"].startswith("Ground reading failed for hop 1: invalid response")


def test_invalid_base64_and_missing_fields_are_failed(demo, ground):
    t0 = start_time(demo)
    mid = mission_id(demo)
    body = ground.reading(captured_at=t0 + 1)
    body["image_jpeg_b64"] = "not base64!"
    tick(demo, t0 + 2)
    del body["model_version"]
    tick(demo, t0 + 4)
    errors = [classification(demo, mid, n)["classification"]["error"] for n in (1, 2)]
    assert errors == [
        "invalid response: image is not valid base64",
        "invalid response: schema (model_version)",
    ]


def test_failed_row_keeps_the_response_without_the_image(demo, ground):
    t0 = start_time(demo)
    ground.reading("lava", captured_at=t0 + 1)
    tick(demo, t0 + 2)
    with demo.app.state.ctx.db.session_scope() as session:  # type: ignore[attr-defined]
        from pogoscout_api.persistence.db import ClassificationRow

        row = session.scalars(select(ClassificationRow)).one()
    assert row.image_sha256 == "none"
    assert row.request_id.startswith("gnd_")
    assert row.raw_response["label"] == "lava"
    assert "image_jpeg_b64" not in row.raw_response


# Start and stop ------------------------------------------------------------------------------


def test_start_stop_and_restart(demo):
    state = demo.get("/api/v1/ground-demo").json()
    assert state["running"] is True  # started with the platform
    assert state["ground"] == "ok"
    assert state["ground_model_version"] == MODEL
    assert state["interval_s"] == 3600.0
    first = state["mission_id"]
    assert first.startswith("GD-")
    mission = demo.get(f"/api/v1/missions/{first}").json()
    assert (mission["status"], mission["source"]) == ("live", "hardware")
    assert mission["name"].startswith("Ground demo ")

    assert demo.post("/api/v1/ground-demo/start").status_code == 409

    stopped = demo.post("/api/v1/ground-demo/stop").json()
    assert (stopped["running"], stopped["mission_id"]) == (False, first)
    assert demo.get(f"/api/v1/missions/{first}").json()["status"] == "complete"
    with pytest.raises(Exception, match="no ground demo is running"):
        tick(demo, 0)

    restarted = demo.post("/api/v1/ground-demo/start")
    assert restarted.status_code == 200
    second = restarted.json()["mission_id"]
    assert second != first  # each start makes a new mission, even within the same second
    assert demo.get(f"/api/v1/missions/{second}").json()["status"] == "live"
    assert restarted.json()["hops"] == 0


def test_shutdown_leaves_the_mission_live(make_demo):
    client = make_demo()
    mid = mission_id(client)
    client.__exit__(None, None, None)
    with client.app.state.ctx.db.session_scope() as session:  # type: ignore[attr-defined]
        from pogoscout_api.persistence.db import MissionRow

        assert session.get(MissionRow, mid).status == "live"


def test_ground_offline_is_reported(demo, ground):
    ground.fail(httpx.ConnectError)
    tick(demo, start_time(demo) + 2)  # a failed fetch marks the service offline at once
    assert demo.get("/api/v1/ground-demo").json()["ground"] == "offline"


def test_disabled_demo_starts_nothing(make_demo, ground):
    client = make_demo(ground_enabled=False)
    assert client.get("/api/v1/ground-demo").json() == {
        "running": False,
        "mission_id": None,
        "hops": 0,
        "interval_s": 3600.0,
        "ground": "off",
        "ground_model_version": None,
    }
    response = client.post("/api/v1/ground-demo/start")
    assert response.status_code == 409
    assert "off" in response.json()["detail"]
    assert client.get("/api/v1/missions").json() == []
    assert ground.latest_calls == 0
    assert "ground" not in client.get("/api/v1/health").json()


def test_clock_ticks_on_its_own(make_demo, ground):
    client = make_demo(ground_hop_interval_s=0.05)
    ground.reading(captured_at=start_time(client))
    for _ in range(100):
        if runner(client)._run.hops >= 3:  # type: ignore[union-attr]
            break
        asyncio.run(asyncio.sleep(0.05))
    client.post("/api/v1/ground-demo/stop")
    assert runner(client)._run.hops >= 3  # type: ignore[union-attr]
    assert ground.latest_calls == runner(client)._run.hops  # type: ignore[union-attr]


# Through the existing endpoints --------------------------------------------------------------


def test_cells_and_images_through_existing_endpoints(demo, ground):
    t0 = start_time(demo)
    mid = mission_id(demo)
    images = {1: jpeg((10, 200, 10)), 2: jpeg((10, 10, 200)), 3: jpeg((200, 200, 10))}
    labels = {1: "grass_vegetation", 2: "water", 3: "wood"}
    for n in (1, 2, 3):
        ground.reading(labels[n], 0.9, captured_at=t0 + 2 * n - 1, image=images[n])
        tick(demo, t0 + 2 * n)

    cells = demo.get(f"/api/v1/missions/{mid}/cells").json()["cells"]
    by_position = {(c["x"], c["y"]): c for c in cells}
    for n in (1, 2, 3):
        cell = by_position[(n, 0)]
        assert cell["material"]["label"] == labels[n]
        url = cell["observations"][0]["image"]["url"]
        assert url == f"/api/v1/missions/{mid}/hops/{n}/image"
        response = demo.get(url)
        assert response.headers["content-type"] == "image/jpeg"
        assert response.content == images[n]  # the exact bytes the ground service sent


def test_recent_hops_newest_first(demo, ground):
    t0 = start_time(demo)
    mid = mission_id(demo)
    ground.reading("asphalt", 0.88, captured_at=t0 + 1.5, age_s=0.5)
    tick(demo, t0 + 2)
    ground.fail(httpx.ConnectError)
    tick(demo, t0 + 4)
    for n in range(3, 13):
        ground.reading("asphalt", 0.88, captured_at=t0 + 2 * n - 0.5)
        tick(demo, t0 + 2 * n)

    recent = demo.get(f"/api/v1/ground-demo/{mid}/hops").json()
    assert [h["hop_id"] for h in recent] == list(range(12, 2, -1))  # the default limit is 10

    everything = demo.get(f"/api/v1/ground-demo/{mid}/hops?limit=20").json()
    first, failed = everything[-1], everything[-2]
    assert first == {
        "hop_id": 1,
        "x": 1,
        "y": 0,
        "observed_at": first["observed_at"],
        "status": "succeeded",
        "label": "asphalt",
        "confidence": 0.88,
        "model_version": MODEL,
        "captured_at": t0 + 1.5,
        "age_s": 0.5,
        "stale": False,
        "error": None,
        "image_url": f"/api/v1/missions/{mid}/hops/1/image",
    }
    assert failed["status"] == "unavailable"
    assert failed["error"] == "unreachable: ConnectError"
    assert (failed["image_url"], failed["stale"], failed["captured_at"]) == (None, None, None)
    assert (failed["x"], failed["y"]) == (2, 0)

    assert demo.get("/api/v1/ground-demo/nope/hops").status_code == 404
    assert demo.get(f"/api/v1/ground-demo/{mid}/hops?limit=0").status_code == 422
