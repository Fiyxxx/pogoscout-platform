"""Fast read model for the hot endpoints: `GET /cells` and mission summaries.

Loads a mission in four bulk column queries (no ORM objects, no raw classifier responses),
applies the same domain rules as `views` (projection, sensor aggregation, quality, flags) and
builds plain dicts serialised once with `json.dumps`. The output is identical to the Pydantic
`CellsResponse` (tests compare the two).

Results are cached per mission under a write fingerprint: (stored hops, stored images, highest
classification id, rejected resends). Every write that can change a cell or a stat changes one of
these append-only counters, so a stale entry is never served. The fingerprint is read before the
data, so cached data is always at least as new as its fingerprint.
"""

import json
import threading
import weakref
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from pogoscout_api.api.schemas import MissionStats, MissionSummary
from pogoscout_api.application.missions import get_mission
from pogoscout_api.domain import risk as risk_rules
from pogoscout_api.domain.projection import aggregate_sensor_values, place
from pogoscout_api.domain.quality import (
    NO_CLASSIFICATION,
    ClassificationFact,
    VisitFact,
    cell_flags,
    cell_quality,
    latest_succeeded_label,
    material_visit,
)
from pogoscout_api.persistence.db import (
    ClassificationRow,
    HopRejectionRow,
    HopRow,
    ImageRow,
    MissionRow,
)

Fingerprint = tuple[int, int, int, int]
JSONDict = dict[str, Any]

NONE_CLASSIFICATION: JSONDict = {
    "status": "none",
    "label": None,
    "confidence": None,
    "model_version": None,
    "taxonomy_version": None,
    "requested_at": None,
    "completed_at": None,
    "error": None,
}


# Fingerprints and cache -----------------------------------------------------------------------


def fingerprints(session: Session, mission_ids: list[str]) -> dict[str, Fingerprint]:
    """Write fingerprints for many missions in four grouped, index-only queries."""
    if not mission_ids:
        return {}

    def grouped(column, aggregate) -> dict[str, int]:
        table = column.class_
        query = (
            select(table.mission_id, aggregate)
            .where(table.mission_id.in_(mission_ids))
            .group_by(table.mission_id)
        )
        return {mission_id: int(value or 0) for mission_id, value in session.execute(query)}

    hops = grouped(HopRow.hop_id, func.count())
    images = grouped(ImageRow.hop_id, func.count())
    classifications = grouped(ClassificationRow.id, func.max(ClassificationRow.id))
    rejections = grouped(HopRejectionRow.id, func.count())
    return {
        m: (hops.get(m, 0), images.get(m, 0), classifications.get(m, 0), rejections.get(m, 0))
        for m in mission_ids
    }


@dataclass(frozen=True)
class StatsView:
    stats: MissionStats
    started_at: str | None
    last_hop_at: str | None


@dataclass
class _Entry:
    fingerprint: Fingerprint
    stats: StatsView
    cells: bytes | None = None
    risk: JSONDict | None = None


class ReadCache:
    """Per-database LRU of computed read models. Thread-safe (routes run in a threadpool)."""

    def __init__(self, capacity: int = 16) -> None:
        self._entries: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = threading.Lock()
        self.capacity = capacity

    def get(self, mission_id: str, fingerprint: Fingerprint) -> _Entry | None:
        with self._lock:
            entry = self._entries.get(mission_id)
            if entry is None or entry.fingerprint != fingerprint:
                return None
            self._entries.move_to_end(mission_id)
            return entry

    def put(self, mission_id: str, entry: _Entry) -> None:
        with self._lock:
            self._entries[mission_id] = entry
            self._entries.move_to_end(mission_id)
            while len(self._entries) > self.capacity:
                self._entries.popitem(last=False)


_CACHES: "weakref.WeakKeyDictionary[Engine, ReadCache]" = weakref.WeakKeyDictionary()
_CACHES_LOCK = threading.Lock()


def cache_for(session: Session) -> ReadCache:
    engine = session.get_bind()
    assert isinstance(engine, Engine)
    with _CACHES_LOCK:
        cache = _CACHES.get(engine)
        if cache is None:
            cache = _CACHES[engine] = ReadCache()
        return cache


# Snapshot -------------------------------------------------------------------------------------


def _iso(value: datetime | None) -> str | None:
    """Same text Pydantic emits for an aware UTC datetime."""
    return None if value is None else value.isoformat().replace("+00:00", "Z")


@dataclass
class Snapshot:
    mission_id: str
    hops: dict[int, JSONDict]  # hop_id -> stored payload
    images: dict[int, tuple]  # hop_id -> (sha256, content_type, bytes, received_at)
    classifications: dict[int, list[tuple]]  # hop_id -> rows oldest first
    rejected: set[int]


def load_snapshot(session: Session, mission_id: str) -> Snapshot:
    hops = {
        hop_id: payload
        for hop_id, payload in session.execute(
            select(HopRow.hop_id, HopRow.payload).where(HopRow.mission_id == mission_id)
        )
    }
    images = {
        row[0]: row[1:]
        for row in session.execute(
            select(
                ImageRow.hop_id,
                ImageRow.sha256,
                ImageRow.content_type,
                ImageRow.bytes,
                ImageRow.received_at,
            ).where(ImageRow.mission_id == mission_id)
        )
    }
    classifications: dict[int, list[tuple]] = {}
    for row in session.execute(
        select(
            ClassificationRow.hop_id,
            ClassificationRow.status,
            ClassificationRow.label,
            ClassificationRow.confidence,
            ClassificationRow.model_version,
            ClassificationRow.taxonomy_version,
            ClassificationRow.requested_at,
            ClassificationRow.completed_at,
            ClassificationRow.error,
        )
        .where(ClassificationRow.mission_id == mission_id)
        .order_by(ClassificationRow.id)
    ):
        classifications.setdefault(row[0], []).append(row)
    rejected = set(
        session.scalars(
            select(HopRejectionRow.hop_id).where(HopRejectionRow.mission_id == mission_id)
        )
    )
    return Snapshot(mission_id, hops, images, classifications, rejected)


def _classification(row: tuple) -> JSONDict:
    _, status, label, confidence, model, taxonomy, requested, completed, error = row
    return {
        "status": status,
        "label": label,
        "confidence": confidence,
        "model_version": model,
        "taxonomy_version": taxonomy,
        "requested_at": _iso(requested),
        "completed_at": _iso(completed),
        "error": error,
    }


def _fact(row: tuple) -> ClassificationFact:
    _, status, label, confidence, *_ = row
    return ClassificationFact(status=status, label=label, confidence=confidence)


# Build ----------------------------------------------------------------------------------------


def build(snapshot: Snapshot, *, with_cells: bool) -> tuple[StatsView, JSONDict | None]:
    """Stats always; the full CellsResponse document only when `with_cells`."""
    hops = snapshot.hops
    mission_id = snapshot.mission_id
    placed, pending = place(
        {h: (p["movement"]["dx"], p["movement"]["dy"]) for h, p in hops.items()}
    )
    by_cell: dict[tuple[int, int], list[int]] = {}
    for hop_id, x, y in placed:
        by_cell.setdefault((x, y), []).append(hop_id)

    image_urls = f"/api/v1/missions/{mission_id}/hops/"
    metal_cells = voc_cells = flagged = 0
    materials: dict[str, int] = {}
    cells: list[JSONDict] = []
    for (x, y), hop_ids in sorted(by_cell.items(), key=lambda item: (item[0][1], item[0][0])):
        visits: list[VisitFact] = []
        observations: list[JSONDict] = []
        latest: dict[int, JSONDict] = {}
        metal_readings: list[tuple[float | None, str]] = []
        voc_readings: list[tuple[float | None, str]] = []
        for hop_id in hop_ids:
            payload = hops[hop_id]
            metal = payload["sensors"]["metal"]
            voc = payload["sensors"]["voc"]
            metal_readings.append((metal["value"], metal["status"]))
            voc_readings.append((voc["value"], voc["status"]))
            history = snapshot.classifications.get(hop_id, ())
            image = snapshot.images.get(hop_id)
            visits.append(
                VisitFact(
                    hop_id=hop_id,
                    metal_status=metal["status"],
                    voc_status=voc["status"],
                    has_image=image is not None,
                    classification=_fact(history[-1]) if history else NO_CLASSIFICATION,
                    conflicting=hop_id in snapshot.rejected,
                )
            )
            if not with_cells:
                continue
            history_out = [_classification(row) for row in history]
            latest[hop_id] = history_out[-1] if history_out else NONE_CLASSIFICATION
            observations.append(
                {
                    "hop_id": hop_id,
                    "observed_at": payload["observed_at"],
                    "movement": payload["movement"],
                    "metal": metal,
                    "voc": voc,
                    "image": None
                    if image is None
                    else {
                        "mission_id": mission_id,
                        "hop_id": hop_id,
                        "sha256": image[0],
                        "content_type": image[1],
                        "bytes": image[2],
                        "received_at": _iso(image[3]),
                        "url": f"{image_urls}{hop_id}/image",
                    },
                    "classification": latest[hop_id],
                    "classification_history": history_out,
                }
            )

        metal_state = aggregate_sensor_values(metal_readings)
        voc_state = aggregate_sensor_values(voc_readings)
        visit = material_visit(visits)
        material = visit.classification if visit is not None else NO_CLASSIFICATION
        flags = cell_flags(metal_state, voc_state, visits, material)
        metal_cells += metal_state == "detected"
        voc_cells += voc_state == "detected"
        flagged += bool(flags)
        label = latest_succeeded_label(visits)
        if label is not None:
            materials[label] = materials.get(label, 0) + 1
        if with_cells:
            cells.append(
                {
                    "x": x,
                    "y": y,
                    "visit_count": len(hop_ids),
                    "hop_ids": hop_ids,
                    "metal": metal_state,
                    "voc": voc_state,
                    "material": NONE_CLASSIFICATION if visit is None else latest[visit.hop_id],
                    "quality": cell_quality(visits, material),
                    "flags": flags,
                    "observations": observations,
                }
            )

    stats = StatsView(
        stats=MissionStats(
            hops=len(hops),
            cells=len(by_cell),
            metal=metal_cells,
            voc=voc_cells,
            flags=flagged,
            materials=dict(sorted(materials.items())),
        ),
        started_at=hops[1]["observed_at"] if 1 in hops else None,
        last_hop_at=hops[placed[-1][0]]["observed_at"] if placed else None,
    )
    if not with_cells:
        return stats, None
    xs = [0, *(x for _, x, _ in placed)]
    ys = [0, *(y for _, _, y in placed)]
    _, cx, cy = placed[-1] if placed else (0, 0, 0)
    document = {
        "mission_id": mission_id,
        "origin": {"x": 0, "y": 0},
        "current": {"x": cx, "y": cy},
        "path": [{"x": x, "y": y, "hop_id": hop_id} for hop_id, x, y in placed],
        "pending_hop_ids": pending,
        "bounds": {"min_x": min(xs), "max_x": max(xs), "min_y": min(ys), "max_y": max(ys)},
        "cells": cells,
    }
    return stats, document


def _dumps(document: JSONDict) -> bytes:
    # Same settings as FastAPI's JSONResponse.
    return json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


# Public API -----------------------------------------------------------------------------------


def cells_json(session: Session, mission_id: str) -> bytes:
    """Serialised CellsResponse for a mission, from cache when nothing has been written."""
    get_mission(session, mission_id)
    cache = cache_for(session)
    fingerprint = fingerprints(session, [mission_id])[mission_id]
    entry = cache.get(mission_id, fingerprint)
    if entry is not None and entry.cells is not None:
        return entry.cells
    stats, document = build(load_snapshot(session, mission_id), with_cells=True)
    assert document is not None
    body = _dumps(document)
    cache.put(mission_id, _Entry(fingerprint, stats, body))
    return body


def _readings(document: JSONDict) -> list[risk_rules.CellReadings]:
    return [
        risk_rules.CellReadings(
            x=c["x"],
            y=c["y"],
            metal=[(o["metal"]["value"], o["metal"]["status"]) for o in c["observations"]],
            voc=[(o["voc"]["value"], o["voc"]["status"]) for o in c["observations"]],
        )
        for c in document["cells"]
    ]


def risk_json(session: Session, mission_id: str) -> JSONDict:
    """Risk assessment for a mission (rules in `domain.risk`), cached with the cells document."""
    body = cells_json(session, mission_id)
    cache = cache_for(session)
    fingerprint = fingerprints(session, [mission_id])[mission_id]
    entry = cache.get(mission_id, fingerprint)
    if entry is not None and entry.risk is not None:
        return entry.risk
    document = risk_rules.to_json(risk_rules.assess(_readings(json.loads(body))))
    if entry is not None and entry.cells is body:
        entry.risk = document
    return document


def _summary(mission: MissionRow, view: StatsView) -> MissionSummary:
    return MissionSummary(
        id=mission.id,
        name=mission.name,
        source=mission.source,  # type: ignore[arg-type]
        status=mission.status,  # type: ignore[arg-type]
        status_note=mission.status_note,
        created_at=mission.created_at,
        started_at=view.started_at,  # type: ignore[arg-type]
        last_hop_at=view.last_hop_at,  # type: ignore[arg-type]
        scenario_id=mission.scenario_id,
        geo=mission.geo,
        stats=view.stats,
    )


def summaries(session: Session, missions: list[MissionRow]) -> list[MissionSummary]:
    """Mission summaries; stats come from the cache unless the mission changed."""
    cache = cache_for(session)
    prints = fingerprints(session, [m.id for m in missions])
    out = []
    for mission in missions:
        entry = cache.get(mission.id, prints[mission.id])
        if entry is None:
            view, _ = build(load_snapshot(session, mission.id), with_cells=False)
            entry = _Entry(prints[mission.id], view)
            cache.put(mission.id, entry)
        out.append(_summary(mission, entry.stats))
    return out


def summary(session: Session, mission_id: str) -> MissionSummary:
    return summaries(session, [get_mission(session, mission_id)])[0]


# Theatre view ---------------------------------------------------------------------------------

_world_cache: dict[str, tuple[Fingerprint, JSONDict]] = {}


def world(session: Session) -> JSONDict:
    """Every GPS-anchored mission with its compact cells, for the theatre map.

    A cell is `[x, y, material label or null, metal signal 0..1, voc signal 0..1, risk heat]`,
    where signals are the strongest valid reading and risk heat is the posterior probability of a
    hazard (half the probability for an activity cue), 0 with no indication, -1 not assessed.
    Each mission also carries its risk summary and areas.
    """
    all_missions = session.scalars(select(MissionRow).order_by(MissionRow.created_at.desc()))
    rows = [m for m in all_missions if m.geo]
    prints = fingerprints(session, [m.id for m in rows])
    items = []
    for mission, summary_ in zip(rows, summaries(session, rows), strict=True):
        cached = _world_cache.get(mission.id)
        if cached is None or cached[0] != prints[mission.id]:
            document = json.loads(cells_json(session, mission.id))
            assessment = risk_json(session, mission.id)
            heat = {(r["x"], r["y"]): risk_rules.heat_weight(r) for r in assessment["cells"]}
            compact = {
                "current": document["current"] if document["path"] else None,
                "cells": [
                    [
                        c["x"],
                        c["y"],
                        c["material"]["label"] if c["material"]["status"] == "succeeded" else None,
                        _strongest(c, "metal"),
                        _strongest(c, "voc"),
                        heat.get((c["x"], c["y"]), 0),
                    ]
                    for c in document["cells"]
                ],
                "risk": {
                    "summary": assessment["summary"],
                    "areas": [
                        {k: a[k] for k in a if k != "cells"} | {"size": len(a["cells"])}
                        for a in assessment["areas"]
                    ],
                },
            }
            cached = (prints[mission.id], compact)
            _world_cache[mission.id] = cached
        items.append(
            {
                "mission": summary_.model_dump(mode="json"),
                "geo": mission.geo.model_dump(),  # type: ignore[union-attr]
                **cached[1],
            }
        )
    return {"missions": items}


def _strongest(cell: JSONDict, sensor: str) -> float:
    values = [
        o[sensor]["value"]
        for o in cell["observations"]
        if o[sensor]["status"] == "ok" and o[sensor]["value"] is not None
    ]
    return risk_rules.hundredths(max(values)) / 100 if values else 0
