"""Scenario fixture format. Events are replayed through the public API, never written to the DB."""

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from pogoscout_api.domain.hops import HopPayload, HopSource


class HopEvent(BaseModel):
    type: Literal["hop"] = "hop"
    seq: int
    at_ms: int
    hop_id: int
    payload: HopPayload


class ImageEvent(BaseModel):
    type: Literal["image"] = "image"
    seq: int
    at_ms: int
    hop_id: int
    file: str
    mock_label: str
    mock_confidence: float = Field(ge=0, le=1)


Event = Annotated[HopEvent | ImageEvent, Field(discriminator="type")]


class ScenarioMission(BaseModel):
    name: str
    source: HopSource = "mock"


class Scenario(BaseModel):
    scenario_id: str
    format_version: Literal["1"] = "1"
    description: str
    seed: int
    mission: ScenarioMission
    events: list[Event]


def load_scenario(directory: Path) -> Scenario:
    return Scenario.model_validate_json((directory / "scenario.json").read_text())


def load_expected(directory: Path) -> dict:
    return json.loads((directory / "expected_projection.json").read_text())
