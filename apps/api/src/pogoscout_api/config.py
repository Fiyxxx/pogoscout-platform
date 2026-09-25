from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="POGOSCOUT_", env_file=".env", extra="ignore")

    database_url: str = "sqlite+pysqlite:///../../data/pogoscout.sqlite3"
    image_dir: Path = Path("../../data/images")
    fixture_dir: Path = Path("../../fixtures")
    classifier: Literal["mock", "http", "disabled"] = "mock"
    ml_service_url: str | None = None
    taxonomy_version: str = "pogo-materials-v2"
    cors_origins: list[str] = ["http://localhost:5173"]


settings = Settings()
