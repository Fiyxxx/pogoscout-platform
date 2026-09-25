"""Full mission archive and CSV exports, built from the same read models as the API."""

import csv
import io
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.api.schemas import EventOut, HopOut
from pogoscout_api.application.views import (
    MissionData,
    build_cells,
    build_summary,
    cell_views,
    image_record,
    latest_classification,
    load_mission_data,
)
from pogoscout_api.domain.hops import HopPayload
from pogoscout_api.persistence.db import EventRow, HopRejectionRow, utcnow


def _iso(value: datetime | None) -> str:
    return value.isoformat().replace("+00:00", "Z") if value else ""


def build_archive(session: Session, mission_id: str) -> dict:
    data = load_mission_data(session, mission_id)
    views = cell_views(data)
    rejections = session.scalars(
        select(HopRejectionRow)
        .where(HopRejectionRow.mission_id == mission_id)
        .order_by(HopRejectionRow.id)
    )
    events = session.scalars(
        select(EventRow).where(EventRow.mission_id == mission_id).order_by(EventRow.id)
    )
    classifications = [row for rows in data.classifications.values() for row in rows]
    classifications.sort(key=lambda r: r.id)
    return {
        "format": "pogoscout-mission-archive",
        "format_version": "1",
        "exported_at": _iso(utcnow()),
        "mission": build_summary(data, views).model_dump(mode="json"),
        "hops": [
            HopOut.model_validate(h, from_attributes=True).model_dump(mode="json")
            for h in data.hops
        ],
        "rejected_hops": [
            {
                "hop_id": r.hop_id,
                "payload": r.payload,
                "content_hash": r.content_hash,
                "received_at": _iso(r.received_at),
            }
            for r in rejections
        ],
        "images": [image_record(i).model_dump(mode="json") for i in data.images.values()],
        "classifications": [
            {
                "id": r.id,
                "hop_id": r.hop_id,
                "request_id": r.request_id,
                "image_sha256": r.image_sha256,
                "status": r.status,
                "label": r.label,
                "confidence": r.confidence,
                "model_version": r.model_version,
                "taxonomy_version": r.taxonomy_version,
                "requested_at": _iso(r.requested_at) or None,
                "completed_at": _iso(r.completed_at) or None,
                "error": r.error,
                "raw_response": r.raw_response,
            }
            for r in classifications
        ],
        "events": [
            EventOut.model_validate(e, from_attributes=True).model_dump(mode="json") for e in events
        ],
        "cells": build_cells(data, views).model_dump(mode="json"),
    }


def _csv(header: list[str], rows: list[list]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def _value(value: int | None) -> str:
    return "" if value is None else str(value)


def hops_csv(data: MissionData) -> str:
    positions = {h.hop_id: (h.x, h.y) for h in data.projection.placed}
    rows = []
    for hop in data.hops:
        payload = HopPayload.model_validate(hop.payload)
        x, y = positions.get(hop.hop_id, (None, None))
        image = data.images.get(hop.hop_id)
        cls = latest_classification(data, hop.hop_id)
        sensors = payload.sensors
        rows.append(
            [
                hop.hop_id,
                _iso(payload.observed_at),
                payload.movement.command,
                payload.movement.dx,
                payload.movement.dy,
                _value(x),
                _value(y),
                "pending" if hop.hop_id in data.projection.pending_hop_ids else "placed",
                _value(sensors.metal.value),
                sensors.metal.status,
                _value(sensors.voc.value),
                sensors.voc.status,
                image.sha256 if image else "",
                cls.status,
                cls.label or "",
                "" if cls.confidence is None else f"{cls.confidence:.2f}",
                cls.model_version or "",
                "yes" if hop.hop_id in data.rejected_hop_ids else "no",
                hop.content_hash,
                _iso(hop.received_at),
            ]
        )
    header = [
        "hop_id",
        "observed_at",
        "command",
        "dx",
        "dy",
        "x",
        "y",
        "projection",
        "metal_value",
        "metal_status",
        "voc_value",
        "voc_status",
        "image_sha256",
        "classification_status",
        "material",
        "confidence",
        "model_version",
        "conflicting_resend",
        "content_hash",
        "received_at",
    ]
    return _csv(header, rows)


def cells_csv(data: MissionData) -> str:
    rows = []
    for view in cell_views(data):
        cell = view.cell
        rows.append(
            [
                cell.x,
                cell.y,
                cell.visit_count,
                ";".join(map(str, cell.hop_ids)),
                cell.metal,
                cell.voc,
                cell.material.status,
                cell.material.label or "",
                "" if cell.material.confidence is None else f"{cell.material.confidence:.2f}",
                cell.material.model_version or "",
                cell.quality,
                ";".join(cell.flags),
            ]
        )
    header = [
        "x",
        "y",
        "visit_count",
        "hop_ids",
        "metal",
        "voc",
        "material_status",
        "material",
        "confidence",
        "model_version",
        "quality",
        "flags",
    ]
    return _csv(header, rows)
