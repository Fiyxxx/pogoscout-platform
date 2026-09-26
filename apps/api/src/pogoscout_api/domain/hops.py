"""Hop payload contract and validation rules.

A hop is one completed movement of exactly one grid cell plus the observation taken on landing.

Schema 2.0: a sensor value is a signal strength from 0 to 1 against the calibrated background
(0 is a clean negative, 1 the strongest signal). It is not a probability. Schema 1.0 producers send
0 or 1, which are valid 2.0 values. Missing or failed readings carry `value: null` and a status.
"""

import hashlib
import json
from datetime import datetime
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MovementCommand = Literal["F", "B", "L", "R"]
SensorStatus = Literal["ok", "missing", "error"]
HopSource = Literal["mock", "manual", "hardware"]

# Mock-mode convention: fixed-north translations, not turns. North is +y, east is +x.
MOVEMENT_VECTORS: dict[str, tuple[int, int]] = {
    "F": (0, 1),
    "B": (0, -1),
    "L": (-1, 0),
    "R": (1, 0),
}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Movement(StrictModel):
    command: MovementCommand
    dx: int
    dy: int

    @model_validator(mode="after")
    def matches_command(self) -> Self:
        if (self.dx, self.dy) != MOVEMENT_VECTORS[self.command]:
            raise ValueError(
                f"dx/dy {self.dx, self.dy} do not match command {self.command} "
                f"(expected {MOVEMENT_VECTORS[self.command]})"
            )
        return self


SignalStrength = Annotated[float, Field(ge=0.0, le=1.0, allow_inf_nan=False)]


class SensorReading(StrictModel):
    value: SignalStrength | None
    status: SensorStatus

    @field_validator("value", mode="before")
    @classmethod
    def not_boolean(cls, value: Any) -> Any:
        if isinstance(value, bool):
            raise ValueError("value must be a number from 0 to 1, not a boolean")
        return value

    @model_validator(mode="after")
    def value_matches_status(self) -> Self:
        if self.status == "ok" and self.value is None:
            raise ValueError("status 'ok' requires a value from 0 to 1")
        if self.status != "ok" and self.value is not None:
            raise ValueError(f"status '{self.status}' requires value null")
        return self


class Sensors(StrictModel):
    metal: SensorReading
    voc: SensorReading


class HopPayload(StrictModel):
    schema_version: Literal["1.0", "2.0"]
    observed_at: datetime
    producer_id: str
    source: HopSource
    movement: Movement
    sensors: Sensors

    def content_hash(self) -> str:
        canonical = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode()).hexdigest()
