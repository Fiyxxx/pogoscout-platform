from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pogoscout_api.config import Settings
from pogoscout_api.main import create_app

FIXTURE_DIR = Path(__file__).resolve().parents[3] / "fixtures"


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    config = Settings(
        database_url=f"sqlite+pysqlite:///{tmp_path / 'test.sqlite3'}",
        image_dir=tmp_path / "images",
        fixture_dir=FIXTURE_DIR,
    )
    return TestClient(create_app(config))


@pytest.fixture
def mission(client: TestClient) -> str:
    response = client.post("/api/v1/missions", json={"name": "test", "mission_id": "t-1"})
    assert response.status_code == 201
    return "t-1"


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
