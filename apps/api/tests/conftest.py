import asyncio
import io
from collections.abc import Callable, Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from pogoscout_api.config import Settings
from pogoscout_api.main import create_app

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "fixtures"


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption("--run-slow", action="store_true", help="also run @pytest.mark.slow tests")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    if config.getoption("--run-slow"):
        return
    skip = pytest.mark.skip(reason="slow: run with --run-slow")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip)


def make_settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "database_url": f"sqlite+pysqlite:///{tmp_path / 'test.sqlite3'}",
        "image_dir": tmp_path / "images",
        "fixture_dir": FIXTURE_DIR,
        "worker_enabled": False,  # tests drain jobs deterministically
        "mock_latency_s": 0.0,
        "retry_base_s": 0.0,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture
def make_client(tmp_path: Path) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(classifier_client=None, **overrides) -> TestClient:
        app = create_app(make_settings(tmp_path, **overrides), classifier=classifier_client)
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()


@pytest.fixture
def mission(client: TestClient) -> str:
    response = client.post("/api/v1/missions", json={"name": "test", "mission_id": "t-1"})
    assert response.status_code == 201
    return "t-1"


def drain(client: TestClient) -> int:
    """Run every due inference job to completion (the background worker is off in tests)."""
    app: FastAPI = client.app  # type: ignore[assignment]
    return asyncio.run(app.state.ctx.worker.drain())


def hop(command: str = "F", metal=(0, "ok"), voc=(0, "ok"), second: int = 0) -> dict:
    vectors = {"F": (0, 1), "B": (0, -1), "L": (-1, 0), "R": (1, 0)}
    dx, dy = vectors[command]
    return {
        "schema_version": "1.0",
        "observed_at": f"2026-09-25T08:00:{second:02d}Z",
        "producer_id": "test",
        "source": "mock",
        "movement": {"command": command, "dx": dx, "dy": dy},
        "sensors": {
            "metal": {"value": metal[0], "status": metal[1]},
            "voc": {"value": voc[0], "status": voc[1]},
        },
    }


def png(colour: tuple[int, int, int] = (138, 74, 44), size: tuple[int, int] = (32, 32)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, colour).save(buffer, format="PNG")
    return buffer.getvalue()


def upload(
    client: TestClient,
    mission_id: str,
    hop_id: int,
    data: bytes,
    content_type: str = "image/png",
    **hints,
):
    return client.put(
        f"/api/v1/missions/{mission_id}/hops/{hop_id}/image",
        files={"file": (f"hop_{hop_id}.png", data, content_type)},
        data={k: str(v) for k, v in hints.items()},
    )


def cell_at(client: TestClient, mission_id: str, x: int, y: int) -> dict:
    cells = client.get(f"/api/v1/missions/{mission_id}/cells").json()["cells"]
    return next(c for c in cells if (c["x"], c["y"]) == (x, y))
