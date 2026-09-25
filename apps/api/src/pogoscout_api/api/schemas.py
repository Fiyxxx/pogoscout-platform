"""Response and request models. Field names and enums follow docs/API.md exactly."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from pogoscout_api.domain.geo import GeoAnchor
from pogoscout_api.domain.hops import HopPayload, HopSource, Movement, SensorReading
from pogoscout_api.domain.projection import SensorCellState
from pogoscout_api.domain.quality import ClassificationStatus, Flag, Quality

MissionStatus = Literal["live", "complete", "aborted"]
EventLevel = Literal["debug", "info", "warning", "alert"]
EventKind = Literal[
    "hop_accepted",
    "hop_duplicate",
    "hop_conflict",
    "hop_pending",
    "image_stored",
    "classification_queued",
    "classification_succeeded",
    "classification_low_confidence",
    "classification_failed",
    "metal_detected",
    "voc_detected",
    "sensor_error",
    "mission_status",
]
MISSION_ID_PATTERN = r"^[a-zA-Z0-9_-]{1,64}$"


class MissionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    source: HopSource = "mock"
    mission_id: str | None = Field(default=None, pattern=MISSION_ID_PATTERN)
    geo: GeoAnchor | None = None


class MissionPatch(BaseModel):
    status: MissionStatus
    status_note: str | None = Field(default=None, max_length=500)


class MissionStats(BaseModel):
    hops: int
    cells: int
    metal: int
    voc: int
    flags: int
    materials: dict[str, int]


class MissionSummary(BaseModel):
    id: str
    name: str
    source: HopSource
    status: MissionStatus
    status_note: str | None
    created_at: datetime
    started_at: datetime | None
    last_hop_at: datetime | None
    scenario_id: str | None
    geo: GeoAnchor | None = None
    stats: MissionStats


class HopOut(BaseModel):
    mission_id: str
    hop_id: int
    payload: HopPayload
    content_hash: str
    received_at: datetime


class ImageRecord(BaseModel):
    mission_id: str
    hop_id: int
    sha256: str
    content_type: str
    bytes: int
    received_at: datetime
    url: str


class Classification(BaseModel):
    status: ClassificationStatus
    label: str | None = None
    confidence: float | None = None
    model_version: str | None = None
    taxonomy_version: str | None = None
    requested_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None


class Point(BaseModel):
    x: int
    y: int


class PathPoint(Point):
    hop_id: int


class Observation(BaseModel):
    hop_id: int
    observed_at: datetime
    movement: Movement
    metal: SensorReading
    voc: SensorReading
    image: ImageRecord | None
    classification: Classification
    classification_history: list[Classification]


class Cell(Point):
    visit_count: int
    hop_ids: list[int]
    metal: SensorCellState
    voc: SensorCellState
    material: Classification
    quality: Quality
    flags: list[Flag]
    observations: list[Observation]


class Bounds(BaseModel):
    min_x: int
    max_x: int
    min_y: int
    max_y: int


class CellsResponse(BaseModel):
    mission_id: str
    origin: Point
    current: Point
    path: list[PathPoint]
    pending_hop_ids: list[int]
    bounds: Bounds
    cells: list[Cell]


class EventOut(BaseModel):
    id: int
    at: datetime
    kind: EventKind
    level: EventLevel
    hop_id: int | None
    x: int | None
    y: int | None
    message: str


class ScenarioInfo(BaseModel):
    scenario_id: str
    description: str
    hops: int
    events: int


class ReplayCreate(BaseModel):
    scenario_id: str
    mission_id: str | None = Field(default=None, pattern=MISSION_ID_PATTERN)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    # Defaults to the scenario's simulated start fix.
    geo: GeoAnchor | None = None


class ReplayPlay(BaseModel):
    speed: Literal[1, 2, 4, 8] = 1


class ReplayAdvance(BaseModel):
    events: int = Field(ge=1, le=100_000)


class ReplayState(BaseModel):
    scenario_id: str
    cursor: int
    total: int
    playing: bool
    speed: int
    finished: bool


class HealthOut(BaseModel):
    status: Literal["ok"]
    classifier: Literal["mock", "http", "disabled"]
    classifier_status: Literal["ok", "degraded", "offline"]
    model_version: str | None
