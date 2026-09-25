"""Screenshot evidence: validate, store once per hop (by SHA-256), then queue inference."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.application import events, inference
from pogoscout_api.application.missions import (
    NULL_NOTIFIER,
    Conflict,
    Invalid,
    NotFound,
    get_mission,
)
from pogoscout_api.application.notify import Notifier
from pogoscout_api.domain.materials import MATERIAL_LABELS
from pogoscout_api.evidence.store import ImageStore, InvalidImage, sha256_hex, validate_image
from pogoscout_api.persistence.db import ImageRow

StoreOutcome = Literal["created", "duplicate"]


@dataclass(frozen=True)
class StoreResult:
    outcome: StoreOutcome
    row: ImageRow


def store_image(
    session: Session,
    store: ImageStore,
    mission_id: str,
    hop_id: int,
    data: bytes,
    declared_type: str | None,
    *,
    max_bytes: int,
    label_hint: str | None = None,
    confidence_hint: float | None = None,
    notifier: Notifier = NULL_NOTIFIER,
) -> StoreResult:
    """The hop need not exist yet: screenshots may arrive before telemetry."""
    get_mission(session, mission_id)
    try:
        content_type = validate_image(data, declared_type, max_bytes)
    except InvalidImage as exc:
        raise Invalid(str(exc)) from exc
    if label_hint is not None and label_hint not in MATERIAL_LABELS:
        raise Invalid(f"label_hint {label_hint!r} is not in the material taxonomy")
    if confidence_hint is not None and not 0 <= confidence_hint <= 1:
        raise Invalid("confidence_hint must be between 0 and 1")

    digest = sha256_hex(data)
    existing = session.get(ImageRow, (mission_id, hop_id))
    position = events.hop_position(session, mission_id, hop_id)
    if existing is not None:
        if existing.sha256 == digest:
            return StoreResult("duplicate", existing)
        events.record(
            session,
            mission_id,
            "hop_conflict",
            f"Screenshot for hop {hop_id} differs from stored evidence, rejected",
            hop_id=hop_id,
            position=position,
        )
        session.commit()
        notifier.publish(mission_id, ["events"], hop_id)
        raise Conflict(f"hop {hop_id} already has a different screenshot")

    relative = store.relative_path(mission_id, hop_id, content_type)
    store.write(relative, data)
    row = ImageRow(
        mission_id=mission_id,
        hop_id=hop_id,
        sha256=digest,
        content_type=content_type,
        bytes=len(data),
        path=relative,
        label_hint=label_hint,
        confidence_hint=confidence_hint,
    )
    session.add(row)
    events.record(
        session,
        mission_id,
        "image_stored",
        f"Screenshot stored for hop {hop_id}",
        hop_id=hop_id,
        position=position,
    )
    inference.enqueue(session, row, position)
    session.commit()
    notifier.publish(mission_id, ["cells", "events"], hop_id)
    return StoreResult("created", row)


def get_image(session: Session, mission_id: str, hop_id: int) -> ImageRow:
    get_mission(session, mission_id)
    row = session.get(ImageRow, (mission_id, hop_id))
    if row is None:
        raise NotFound(f"no screenshot for hop {hop_id}")
    return row


def list_images(session: Session, mission_id: str) -> list[ImageRow]:
    query = select(ImageRow).where(ImageRow.mission_id == mission_id).order_by(ImageRow.hop_id)
    return list(session.scalars(query))
