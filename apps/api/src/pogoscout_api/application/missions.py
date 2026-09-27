import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from pogoscout_api.application import events, positions
from pogoscout_api.application.notify import Notifier, NullNotifier
from pogoscout_api.domain.geo import GeoAnchor
from pogoscout_api.domain.hops import HopPayload, HopSource
from pogoscout_api.domain.projection import PlacedHop
from pogoscout_api.persistence.db import (
    ClassificationRow,
    EventRow,
    HopRejectionRow,
    HopRow,
    ImageRow,
    InferenceJobRow,
    MissionRow,
)

MissionStatus = Literal["live", "complete", "aborted"]
NULL_NOTIFIER = NullNotifier()


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


class Invalid(Exception):
    pass


IngestOutcome = Literal["created", "duplicate"]


@dataclass(frozen=True)
class IngestResult:
    outcome: IngestOutcome
    row: HopRow


def create_mission(
    session: Session,
    name: str,
    source: HopSource,
    mission_id: str | None,
    *,
    scenario_id: str | None = None,
    geo: GeoAnchor | None = None,
    notifier: Notifier = NULL_NOTIFIER,
) -> MissionRow:
    mission_id = mission_id or f"m-{uuid.uuid4().hex[:8]}"
    if session.get(MissionRow, mission_id):
        raise Conflict(f"mission {mission_id} already exists")
    row = MissionRow(
        id=mission_id, name=name, source=source, status="live", scenario_id=scenario_id
    )
    row.set_geo(geo)
    session.add(row)
    session.commit()
    notifier.publish(mission_id, ["mission"])
    return row


def get_mission(session: Session, mission_id: str) -> MissionRow:
    row = session.get(MissionRow, mission_id)
    if row is None:
        raise NotFound(f"mission {mission_id} not found")
    return row


def list_missions(session: Session) -> list[MissionRow]:
    query = select(MissionRow).order_by(MissionRow.created_at.desc(), MissionRow.id.desc())
    return list(session.scalars(query))


def delete_mission(session: Session, mission_id: str) -> None:
    """Delete a mission and every row that belongs to it. The caller removes its image files
    and commits."""
    get_mission(session, mission_id)
    for row in (
        ClassificationRow,
        InferenceJobRow,
        ImageRow,
        EventRow,
        HopRejectionRow,
        HopRow,
    ):
        session.execute(delete(row).where(row.mission_id == mission_id))
    session.execute(delete(MissionRow).where(MissionRow.id == mission_id))


def set_status(
    session: Session,
    mission_id: str,
    status: MissionStatus,
    note: str | None = None,
    *,
    notifier: Notifier = NULL_NOTIFIER,
) -> MissionRow:
    row = get_mission(session, mission_id)
    row.status = status
    row.status_note = note
    message = f"Mission marked {status}" + (f": {note}" if note else "")
    events.record(session, mission_id, "mission_status", message)
    session.commit()
    notifier.publish(mission_id, ["mission", "events"])
    return row


def ingest_hop(
    session: Session,
    mission_id: str,
    hop_id: int,
    payload: HopPayload,
    *,
    notifier: Notifier = NULL_NOTIFIER,
) -> IngestResult:
    """Idempotent on identical content; a different payload for the same identity is a conflict.

    A conflicting resend is rejected but kept as evidence so the cell can show `conflicting`.
    """
    get_mission(session, mission_id)
    content_hash = payload.content_hash()
    existing = session.get(HopRow, (mission_id, hop_id))
    if existing is not None:
        if existing.content_hash == content_hash:
            events.record(
                session,
                mission_id,
                "hop_duplicate",
                f"Hop {hop_id} duplicate ignored",
                at=payload.observed_at,
                hop_id=hop_id,
                position=events.hop_position(session, mission_id, hop_id),
            )
            session.commit()
            notifier.publish(mission_id, ["events"], hop_id)
            return IngestResult("duplicate", existing)
        session.add(
            HopRejectionRow(
                mission_id=mission_id,
                hop_id=hop_id,
                payload=payload.model_dump(mode="json"),
                content_hash=content_hash,
            )
        )
        events.record(
            session,
            mission_id,
            "hop_conflict",
            f"Hop {hop_id} resent with different content, rejected",
            at=payload.observed_at,
            hop_id=hop_id,
            position=events.hop_position(session, mission_id, hop_id),
        )
        session.commit()
        notifier.publish(mission_id, ["cells", "events", "mission"], hop_id)
        raise Conflict(f"hop {hop_id} already stored with different content")

    # Hops 1..hop_id-1 all stored means this hop fills the next slot (hop ids are unique, >= 1).
    before, x, y = positions.prefix_sum(session, mission_id, hop_id - 1)
    movement = payload.movement
    row = HopRow(
        mission_id=mission_id,
        hop_id=hop_id,
        payload=payload.model_dump(mode="json"),
        content_hash=content_hash,
        dx=movement.dx,
        dy=movement.dy,
    )
    session.add(row)
    session.flush()
    if before == hop_id - 1:
        # Place it and any pending run that now follows it.
        following = session.scalars(
            select(HopRow)
            .where(HopRow.mission_id == mission_id)
            .where(HopRow.hop_id >= hop_id)
            .order_by(HopRow.hop_id)
        )
        expected = hop_id
        for stored in following:
            if stored.hop_id != expected:
                break
            hop_payload = (
                payload if stored.hop_id == hop_id else HopPayload.model_validate(stored.payload)
            )
            x, y = x + hop_payload.movement.dx, y + hop_payload.movement.dy
            events.record_placement(
                session, mission_id, PlacedHop(stored.hop_id, x, y, hop_payload)
            )
            expected += 1
    else:
        events.record(
            session,
            mission_id,
            "hop_pending",
            f"Hop {hop_id} arrived out of order, waiting for hop "
            f"{positions.placed_count(session, mission_id) + 1}",
            at=payload.observed_at,
            hop_id=hop_id,
        )
    session.commit()
    notifier.publish(mission_id, ["hops", "cells", "events", "mission"], hop_id)
    return IngestResult("created", row)


def list_hops(session: Session, mission_id: str) -> list[HopRow]:
    get_mission(session, mission_id)
    query = select(HopRow).where(HopRow.mission_id == mission_id).order_by(HopRow.hop_id)
    return list(session.scalars(query))
