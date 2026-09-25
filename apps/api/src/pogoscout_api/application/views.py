"""Read models: the cell projection and mission summaries assembled from append-only records."""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.api.schemas import (
    Bounds,
    Cell,
    CellsResponse,
    Classification,
    ImageRecord,
    MissionStats,
    MissionSummary,
    Observation,
    PathPoint,
    Point,
)
from pogoscout_api.application.inference import classifications_for
from pogoscout_api.application.missions import get_mission
from pogoscout_api.domain.hops import HopPayload
from pogoscout_api.domain.projection import Projection, project
from pogoscout_api.domain.quality import (
    NO_CLASSIFICATION,
    ClassificationFact,
    VisitFact,
    cell_flags,
    cell_material,
    cell_quality,
    latest_succeeded_label,
)
from pogoscout_api.persistence.db import (
    ClassificationRow,
    HopRejectionRow,
    HopRow,
    ImageRow,
    MissionRow,
)


@dataclass
class MissionData:
    mission: MissionRow
    hops: list[HopRow]
    projection: Projection
    images: dict[int, ImageRow]
    classifications: dict[int, list[ClassificationRow]]
    rejected_hop_ids: set[int]


def load_mission_data(session: Session, mission_id: str) -> MissionData:
    mission = get_mission(session, mission_id)
    hops = list(
        session.scalars(
            select(HopRow).where(HopRow.mission_id == mission_id).order_by(HopRow.hop_id)
        )
    )
    projection = project({h.hop_id: HopPayload.model_validate(h.payload) for h in hops})
    images = {
        i.hop_id: i
        for i in session.scalars(select(ImageRow).where(ImageRow.mission_id == mission_id))
    }
    by_hop: dict[int, list[ClassificationRow]] = {}
    for row in classifications_for(session, mission_id):
        by_hop.setdefault(row.hop_id, []).append(row)
    rejected = set(
        session.scalars(
            select(HopRejectionRow.hop_id).where(HopRejectionRow.mission_id == mission_id)
        )
    )
    return MissionData(mission, hops, projection, images, by_hop, rejected)


def image_url(mission_id: str, hop_id: int) -> str:
    return f"/api/v1/missions/{mission_id}/hops/{hop_id}/image"


def image_record(row: ImageRow) -> ImageRecord:
    return ImageRecord(
        mission_id=row.mission_id,
        hop_id=row.hop_id,
        sha256=row.sha256,
        content_type=row.content_type,
        bytes=row.bytes,
        received_at=row.received_at,
        url=image_url(row.mission_id, row.hop_id),
    )


def fact(row: ClassificationRow | None) -> ClassificationFact:
    if row is None:
        return NO_CLASSIFICATION
    return ClassificationFact(
        status=row.status,  # type: ignore[arg-type]
        label=row.label,
        confidence=row.confidence,
        model_version=row.model_version,
        taxonomy_version=row.taxonomy_version,
        requested_at=row.requested_at,
        completed_at=row.completed_at,
        error=row.error,
    )


def classification_out(value: ClassificationFact) -> Classification:
    return Classification(
        status=value.status,
        label=value.label,
        confidence=value.confidence,
        model_version=value.model_version,
        taxonomy_version=value.taxonomy_version,
        requested_at=value.requested_at,
        completed_at=value.completed_at,
        error=value.error,
    )


def latest_classification(data: MissionData, hop_id: int) -> ClassificationFact:
    rows = data.classifications.get(hop_id)
    return fact(rows[-1]) if rows else NO_CLASSIFICATION


@dataclass(frozen=True)
class CellView:
    cell: Cell
    visits: list[VisitFact]
    material: ClassificationFact


def cell_views(data: MissionData) -> list[CellView]:
    views = []
    for cell in sorted(data.projection.cells.values(), key=lambda c: (c.y, c.x)):
        visits: list[VisitFact] = []
        observations: list[Observation] = []
        for hop in cell.hops:
            sensors = hop.payload.sensors
            image = data.images.get(hop.hop_id)
            latest = latest_classification(data, hop.hop_id)
            visits.append(
                VisitFact(
                    hop_id=hop.hop_id,
                    metal_status=sensors.metal.status,
                    voc_status=sensors.voc.status,
                    has_image=image is not None,
                    classification=latest,
                    conflicting=hop.hop_id in data.rejected_hop_ids,
                )
            )
            observations.append(
                Observation(
                    hop_id=hop.hop_id,
                    observed_at=hop.payload.observed_at,
                    movement=hop.payload.movement,
                    metal=sensors.metal,
                    voc=sensors.voc,
                    image=image_record(image) if image else None,
                    classification=classification_out(latest),
                    classification_history=[
                        classification_out(fact(r))
                        for r in data.classifications.get(hop.hop_id, [])
                    ],
                )
            )
        material = cell_material(visits)
        out = Cell(
            x=cell.x,
            y=cell.y,
            visit_count=len(cell.hops),
            hop_ids=[h.hop_id for h in cell.hops],
            metal=cell.metal,
            voc=cell.voc,
            material=classification_out(material),
            quality=cell_quality(visits, material),
            flags=cell_flags(cell.metal, cell.voc, visits, material),
            observations=observations,
        )
        views.append(CellView(out, visits, material))
    return views


def build_cells(data: MissionData, views: list[CellView] | None = None) -> CellsResponse:
    projection = data.projection
    views = cell_views(data) if views is None else views
    xs = [0, *(h.x for h in projection.placed)]
    ys = [0, *(h.y for h in projection.placed)]
    cx, cy = projection.current
    return CellsResponse(
        mission_id=data.mission.id,
        origin=Point(x=0, y=0),
        current=Point(x=cx, y=cy),
        path=[PathPoint(hop_id=h.hop_id, x=h.x, y=h.y) for h in projection.placed],
        pending_hop_ids=projection.pending_hop_ids,
        bounds=Bounds(min_x=min(xs), max_x=max(xs), min_y=min(ys), max_y=max(ys)),
        cells=[v.cell for v in views],
    )


def _observed_at(hop: HopRow) -> datetime:
    return HopPayload.model_validate(hop.payload).observed_at


def build_summary(data: MissionData, views: list[CellView] | None = None) -> MissionSummary:
    views = cell_views(data) if views is None else views
    mission = data.mission
    hop_one = next((h for h in data.hops if h.hop_id == 1), None)
    placed = data.projection.placed
    materials: dict[str, int] = {}
    for view in views:
        label = latest_succeeded_label(view.visits)
        if label is not None:
            materials[label] = materials.get(label, 0) + 1
    stats = MissionStats(
        hops=len(data.hops),
        cells=len(views),
        metal=sum(v.cell.metal == "detected" for v in views),
        voc=sum(v.cell.voc == "detected" for v in views),
        flags=sum(bool(v.cell.flags) for v in views),
        materials=dict(sorted(materials.items())),
    )
    return MissionSummary(
        id=mission.id,
        name=mission.name,
        source=mission.source,  # type: ignore[arg-type]
        status=mission.status,  # type: ignore[arg-type]
        status_note=mission.status_note,
        created_at=mission.created_at,
        started_at=_observed_at(hop_one) if hop_one else None,
        last_hop_at=placed[-1].payload.observed_at if placed else None,
        scenario_id=mission.scenario_id,
        geo=mission.geo,
        stats=stats,
    )


def mission_summary(session: Session, mission_id: str) -> MissionSummary:
    """Cached fast path (see `readmodel`); `build_summary` remains the reference for exports."""
    from pogoscout_api.application import readmodel  # readmodel imports this module's peers

    return readmodel.summary(session, mission_id)


def mission_cells(session: Session, mission_id: str) -> CellsResponse:
    """Reference Pydantic build of the cells document (exports and equivalence tests)."""
    return build_cells(load_mission_data(session, mission_id))
