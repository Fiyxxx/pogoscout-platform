import uuid
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.domain.hops import HopPayload, HopSource
from pogoscout_api.domain.projection import Projection, project
from pogoscout_api.persistence.db import HopRow, MissionRow


class NotFound(Exception):
    pass


class Conflict(Exception):
    pass


IngestOutcome = Literal["created", "duplicate"]


@dataclass(frozen=True)
class IngestResult:
    outcome: IngestOutcome
    row: HopRow


def create_mission(
    session: Session, name: str, source: HopSource, mission_id: str | None
) -> MissionRow:
    mission_id = mission_id or f"m-{uuid.uuid4().hex[:8]}"
    if session.get(MissionRow, mission_id):
        raise Conflict(f"mission {mission_id} already exists")
    row = MissionRow(id=mission_id, name=name, source=source)
    session.add(row)
    session.commit()
    return row


def get_mission(session: Session, mission_id: str) -> MissionRow:
    row = session.get(MissionRow, mission_id)
    if row is None:
        raise NotFound(f"mission {mission_id} not found")
    return row


def list_missions(session: Session) -> list[MissionRow]:
    return list(session.scalars(select(MissionRow).order_by(MissionRow.created_at.desc())))


def ingest_hop(session: Session, mission_id: str, hop_id: int, payload: HopPayload) -> IngestResult:
    """Idempotent on identical content; a different payload for the same identity is a conflict."""
    get_mission(session, mission_id)
    content_hash = payload.content_hash()
    existing = session.get(HopRow, (mission_id, hop_id))
    if existing is not None:
        if existing.content_hash == content_hash:
            return IngestResult("duplicate", existing)
        raise Conflict(f"hop {hop_id} already stored with different content")
    row = HopRow(
        mission_id=mission_id,
        hop_id=hop_id,
        payload=payload.model_dump(mode="json"),
        content_hash=content_hash,
    )
    session.add(row)
    session.commit()
    return IngestResult("created", row)


def list_hops(session: Session, mission_id: str) -> list[HopRow]:
    get_mission(session, mission_id)
    query = select(HopRow).where(HopRow.mission_id == mission_id).order_by(HopRow.hop_id)
    return list(session.scalars(query))


def project_mission(session: Session, mission_id: str) -> Projection:
    rows = list_hops(session, mission_id)
    return project({r.hop_id: HopPayload.model_validate(r.payload) for r in rows})
