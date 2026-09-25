from datetime import datetime

from pydantic import BaseModel, Field

from pogoscout_api.domain.hops import HopPayload, HopSource
from pogoscout_api.domain.projection import SensorCellState


class MissionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    source: HopSource = "mock"
    mission_id: str | None = Field(default=None, pattern=r"^[a-zA-Z0-9_-]{1,64}$")


class MissionOut(BaseModel):
    id: str
    name: str
    source: HopSource
    created_at: datetime


class HopOut(BaseModel):
    mission_id: str
    hop_id: int
    payload: HopPayload
    content_hash: str
    received_at: datetime


class Point(BaseModel):
    x: int
    y: int


class PathPoint(Point):
    hop_id: int


class CellObservation(BaseModel):
    hop_id: int
    observed_at: datetime
    metal: dict
    voc: dict


class CellOut(Point):
    visit_count: int
    hop_ids: list[int]
    metal: SensorCellState
    voc: SensorCellState
    observations: list[CellObservation]


class Bounds(BaseModel):
    min_x: int
    max_x: int
    min_y: int
    max_y: int


class CellsOut(BaseModel):
    mission_id: str
    origin: Point
    current: Point
    path: list[PathPoint]
    pending_hop_ids: list[int]
    bounds: Bounds
    cells: list[CellOut]
