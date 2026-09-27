from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POGOSCOUT_", env_file=".env", extra="ignore")

    database_url: str = "sqlite+pysqlite:///../../data/pogoscout.sqlite3"
    image_dir: Path = Path("../../data/images")
    tile_cache_dir: Path = Path("../../data/tiles")
    fixture_dir: Path = Path("../../fixtures")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    # Material classifier (separate ML service, reached by contract only).
    classifier: Literal["mock", "http", "disabled"] = "mock"
    ml_service_url: str | None = None
    taxonomy_version: str = "pogo-materials-v2"
    classifier_timeout_s: float = 10.0
    mock_model_version: str = "mock-material 0.1.0"
    mock_latency_s: float = 0.1

    # Evidence
    max_image_bytes: int = 10 * 1024 * 1024

    # Inference worker (persisted outbox in SQLite)
    worker_enabled: bool = True
    worker_poll_s: float = 0.3
    worker_concurrency: int = 8
    max_attempts: int = 3
    retry_base_s: float = 1.0

    # Live
    live_ping_s: float = 15.0
    live_coalesce_s: float = 0.25  # at most one `changed` message per mission per window

    # Live ground demo: each session the demo page creates plays the drone, making one hop per
    # tick and recording the ground-classification service's latest reading for it
    # (contracts/ground-latest.v1).
    ground_service_url: str = "http://127.0.0.1:8765"
    ground_hop_interval_s: float = 2.0  # one hop and one /latest fetch per tick
    ground_timeout_s: float = 0.5


settings = Settings()
