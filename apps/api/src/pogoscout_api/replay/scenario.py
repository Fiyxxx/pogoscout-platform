"""Scenario fixture format. Events are replayed through the public API, never written to the DB."""

import json
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, model_validator

from pogoscout_api.domain.hops import HopPayload, HopSource


class HopEvent(BaseModel):
    type: Literal["hop"] = "hop"
    seq: int
    at_ms: int
    hop_id: int
    payload: HopPayload


class ImageEvent(BaseModel):
    """A screenshot for a hop: either a committed `file`, or `generate: true`, in which case the
    runner renders the synthetic mock image in memory (deterministic per scenario seed and hop).
    """

    type: Literal["image"] = "image"
    seq: int
    at_ms: int
    hop_id: int
    file: str | None = None
    generate: bool = False
    mock_label: str
    mock_confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def one_source(self) -> Self:
        if self.generate == (self.file is not None):
            raise ValueError("an image event needs exactly one of `file` or `generate: true`")
        return self


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
