"""Append-only mission event log. Messages are operator-facing: cautious wording, no em-dashes."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.application import positions
from pogoscout_api.domain.projection import PlacedHop
from pogoscout_api.persistence.db import EventRow, utcnow

LEVELS: dict[str, str] = {
    "hop_accepted": "info",
    "hop_duplicate": "debug",
    "hop_conflict": "warning",
    "hop_pending": "warning",
    "image_stored": "debug",
    "classification_queued": "debug",
    "classification_succeeded": "info",
    "classification_low_confidence": "warning",
    "classification_failed": "warning",
    "metal_detected": "alert",
    "voc_detected": "alert",
    "sensor_error": "warning",
    "mission_status": "info",
}


def xy(x: int, y: int) -> str:
    return f"({x}, {y})"


def record(
    session: Session,
    mission_id: str,
    kind: str,
    message: str,
    *,
    at: datetime | None = None,
    hop_id: int | None = None,
    position: tuple[int, int] | None = None,
) -> EventRow:
    """Add an event to the session. The caller commits."""
    x, y = position if position is not None else (None, None)
    row = EventRow(
        mission_id=mission_id,
        at=at or utcnow(),
        kind=kind,
        level=LEVELS[kind],
        hop_id=hop_id,
        x=x,
        y=y,
        message=message,
    )
    session.add(row)
    return row


def record_placement(session: Session, mission_id: str, hop: PlacedHop) -> None:
    """Events for a hop that has just been placed on the grid (on arrival or when a gap fills)."""
    at = hop.payload.observed_at
    where = xy(hop.x, hop.y)
    pos = (hop.x, hop.y)
    kw = {"at": at, "hop_id": hop.hop_id, "position": pos}
    record(session, mission_id, "hop_accepted", f"Hop {hop.hop_id} landed at {where}", **kw)
    sensors = hop.payload.sensors
    for reading, name, detected_kind, detected_msg in (
        (sensors.metal, "Metal", "metal_detected", f"Metal anomaly at {where}"),
        (sensors.voc, "VOC", "voc_detected", f"VOC cue at {where}"),
    ):
        if reading.status == "ok" and reading.value == 1:
            record(session, mission_id, detected_kind, detected_msg, **kw)
        elif reading.status == "error":
            record(session, mission_id, "sensor_error", f"{name} sensor error at {where}", **kw)
        elif reading.status == "missing":
            record(session, mission_id, "sensor_error", f"{name} reading missing at {where}", **kw)


def hop_position(session: Session, mission_id: str, hop_id: int) -> tuple[int, int] | None:
    return positions.hop_position(session, mission_id, hop_id)


def list_events(session: Session, mission_id: str, limit: int) -> list[EventRow]:
    query = (
        select(EventRow)
        .where(EventRow.mission_id == mission_id)
        .order_by(EventRow.id.desc())
        .limit(limit)
    )
    return list(session.scalars(query))
