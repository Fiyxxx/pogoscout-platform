"""Inference outbox: enqueue on screenshot, claim due jobs, append classification results.

Job lifecycle: queued -> running -> succeeded | failed, or running -> retrying -> running ...
Every state visible to operators is also appended to `classifications` (never updated).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from pogoscout_api.adapters.classifier.base import ClassifyResult, RetryableClassifierError
from pogoscout_api.application import events
from pogoscout_api.domain.quality import LOW_CONFIDENCE
from pogoscout_api.persistence.db import ClassificationRow, ImageRow, InferenceJobRow, utcnow


@dataclass(frozen=True)
class JobTicket:
    job_id: str
    mission_id: str
    hop_id: int
    image_sha256: str
    attempt: int
    requested_at: datetime
    image_path: str | None
    content_type: str
    label_hint: str | None
    confidence_hint: float | None


def enqueue(session: Session, image: ImageRow, position: tuple[int, int] | None) -> InferenceJobRow:
    now = utcnow()
    job = InferenceJobRow(
        id=f"inf_{uuid.uuid4().hex}",
        mission_id=image.mission_id,
        hop_id=image.hop_id,
        image_sha256=image.sha256,
        status="queued",
        attempts=0,
        next_attempt_at=now,
        created_at=now,
    )
    session.add(job)
    session.add(_row(job, "queued", requested_at=now))
    events.record(
        session,
        image.mission_id,
        "classification_queued",
        f"Classification queued for hop {image.hop_id}",
        hop_id=image.hop_id,
        position=position,
    )
    return job


def _row(job: InferenceJobRow, status: str, **fields) -> ClassificationRow:
    return ClassificationRow(
        mission_id=job.mission_id,
        hop_id=job.hop_id,
        request_id=job.id,
        image_sha256=job.image_sha256,
        status=status,
        **fields,
    )


def reset_running(session: Session) -> int:
    """Jobs left `running` by a crashed process go back to the queue."""
    result = session.execute(
        update(InferenceJobRow).where(InferenceJobRow.status == "running").values(status="queued")
    )
    session.commit()
    return result.rowcount or 0


def claim_due(session: Session, now: datetime, limit: int) -> list[JobTicket]:
    query = (
        select(InferenceJobRow)
        .where(InferenceJobRow.status.in_(("queued", "retrying")))
        .where(InferenceJobRow.next_attempt_at <= now)
        .order_by(InferenceJobRow.next_attempt_at, InferenceJobRow.created_at)
        .limit(limit)
    )
    tickets = []
    for job in session.scalars(query):
        job.status = "running"
        job.attempts += 1
        image = session.get(ImageRow, (job.mission_id, job.hop_id))
        tickets.append(
            JobTicket(
                job_id=job.id,
                mission_id=job.mission_id,
                hop_id=job.hop_id,
                image_sha256=job.image_sha256,
                attempt=job.attempts,
                requested_at=job.created_at,
                image_path=image.path if image else None,
                content_type=image.content_type if image else "image/png",
                label_hint=image.label_hint if image else None,
                confidence_hint=image.confidence_hint if image else None,
            )
        )
    session.commit()
    return tickets


def record_result(session: Session, ticket: JobTicket, result: ClassifyResult) -> None:
    job = session.get(InferenceJobRow, ticket.job_id)
    assert job is not None
    job.status = "succeeded" if result.status == "succeeded" else "failed"
    job.last_error = result.error
    session.add(
        _row(
            job,
            result.status,
            label=result.label,
            confidence=result.confidence,
            model_version=result.model_version,
            taxonomy_version=result.taxonomy_version,
            requested_at=ticket.requested_at,
            completed_at=result.completed_at,
            error=result.error,
            raw_response=result.raw,
        )
    )
    position = events.hop_position(session, ticket.mission_id, ticket.hop_id)
    kw = {"hop_id": ticket.hop_id, "position": position}
    hop = ticket.hop_id
    if result.status == "succeeded":
        confidence = result.confidence or 0.0
        if confidence < LOW_CONFIDENCE:
            where = events.xy(*position) if position else f"hop {hop}"
            message = f"Low confidence at {where}"
            events.record(
                session, ticket.mission_id, "classification_low_confidence", message, **kw
            )
        else:
            message = f"Hop {hop} classified as {result.label} ({confidence:.2f})"
            events.record(session, ticket.mission_id, "classification_succeeded", message, **kw)
    elif result.status == "unavailable":
        message = f"Classifier unavailable for hop {hop}: {result.error}"
        events.record(session, ticket.mission_id, "classification_failed", message, **kw)
    else:
        message = f"Classification failed for hop {hop}: {result.error}"
        events.record(session, ticket.mission_id, "classification_failed", message, **kw)
    session.commit()


def record_retryable(
    session: Session,
    ticket: JobTicket,
    error: RetryableClassifierError,
    *,
    max_attempts: int,
    retry_base_s: float,
) -> None:
    if ticket.attempt >= max_attempts:
        status = "unavailable" if error.unavailable else "failed"
        message = f"{error} after {ticket.attempt} attempts"
        record_result(session, ticket, ClassifyResult(status=status, error=message, raw=error.raw))
        return
    job = session.get(InferenceJobRow, ticket.job_id)
    assert job is not None
    delay = retry_base_s * 2 ** (ticket.attempt - 1)
    job.status = "retrying"
    job.last_error = str(error)
    job.next_attempt_at = utcnow() + timedelta(seconds=delay)
    session.add(
        _row(
            job,
            "retrying",
            requested_at=ticket.requested_at,
            error=str(error),
            raw_response=error.raw,
        )
    )
    events.record(
        session,
        ticket.mission_id,
        "classification_failed",
        f"Classification attempt {ticket.attempt} for hop {ticket.hop_id} failed ({error}), "
        "retrying",
        hop_id=ticket.hop_id,
        position=events.hop_position(session, ticket.mission_id, ticket.hop_id),
    )
    session.commit()


def classifications_for(session: Session, mission_id: str) -> list[ClassificationRow]:
    query = (
        select(ClassificationRow)
        .where(ClassificationRow.mission_id == mission_id)
        .order_by(ClassificationRow.id)
    )
    return list(session.scalars(query))
