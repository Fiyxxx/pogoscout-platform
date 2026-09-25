import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.application import events
from pogoscout_api.application.notify import Notifier, NullNotifier
from pogoscout_api.domain.hops import HopPayload, HopSource
from pogoscout_api.domain.projection import Projection, project
from pogoscout_api.persistence.db import HopRejectionRow, HopRow, MissionRow

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
    notifier: Notifier = NULL_NOTIFIER,
) -> MissionRow:
    mission_id = mission_id or f"m-{uuid.uuid4().hex[:8]}"
    if session.get(MissionRow, mission_id):
        raise Conflict(f"mission {mission_id} already exists")
    row = MissionRow(
        id=mission_id, name=name, source=source, status="live", scenario_id=scenario_id
    )
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


def load_payloads(session: Session, mission_id: str) -> dict[int, HopPayload]:
    rows = session.scalars(select(HopRow).where(HopRow.mission_id == mission_id))
    return {r.hop_id: HopPayload.model_validate(r.payload) for r in rows}


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

    before = project(load_payloads(session, mission_id))
    row = HopRow(
        mission_id=mission_id,
        hop_id=hop_id,
        payload=payload.model_dump(mode="json"),
        content_hash=content_hash,
    )
    session.add(row)
    session.flush()
    after = project(load_payloads(session, mission_id))
    for placed in after.placed[len(before.placed) :]:
        events.record_placement(session, mission_id, placed)
    if hop_id in after.pending_hop_ids:
        waiting_for = len(after.placed) + 1
        events.record(
            session,
            mission_id,
            "hop_pending",
            f"Hop {hop_id} arrived out of order, waiting for hop {waiting_for}",
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


def project_mission(session: Session, mission_id: str) -> Projection:
    rows = list_hops(session, mission_id)
    return project({r.hop_id: HopPayload.model_validate(r.payload) for r in rows})
