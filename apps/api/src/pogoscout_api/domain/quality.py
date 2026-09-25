"""Cell material, data-quality and flag rules. Pure functions over per-visit facts.

Quality (first match wins):
  conflicting   a conflicting resend was rejected for any hop in the cell
  failed        the cell's material classification failed or the classifier was unavailable
  missing       any visit has a `missing` metal/voc reading or no screenshot
  pending       the cell's material classification is queued or retrying
  low_confidence  the cell's material confidence is below LOW_CONFIDENCE
  complete      otherwise
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pogoscout_api.domain.hops import SensorStatus
from pogoscout_api.domain.projection import SensorCellState

ClassificationStatus = Literal["none", "queued", "retrying", "succeeded", "failed", "unavailable"]
Quality = Literal["complete", "pending", "low_confidence", "missing", "failed", "conflicting"]
Flag = Literal["metal", "voc", "low_confidence", "pending", "failed", "missing", "conflicting"]

LOW_CONFIDENCE = 0.80
FLAG_ORDER: tuple[Flag, ...] = (
    "metal",
    "voc",
    "low_confidence",
    "pending",
    "failed",
    "missing",
    "conflicting",
)


@dataclass(frozen=True)
class ClassificationFact:
    status: ClassificationStatus
    label: str | None = None
    confidence: float | None = None
    model_version: str | None = None
    taxonomy_version: str | None = None
    requested_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None

    @property
    def is_pending(self) -> bool:
        return self.status in ("queued", "retrying")

    @property
    def is_failed(self) -> bool:
        return self.status in ("failed", "unavailable")

    @property
    def is_low_confidence(self) -> bool:
        return (
            self.status == "succeeded"
            and self.confidence is not None
            and self.confidence < LOW_CONFIDENCE
        )


NO_CLASSIFICATION = ClassificationFact(status="none")


@dataclass(frozen=True)
class VisitFact:
    hop_id: int
    metal_status: SensorStatus
    voc_status: SensorStatus
    has_image: bool
    classification: ClassificationFact
    conflicting: bool = False


def cell_material(visits: list[VisitFact]) -> ClassificationFact:
    """Latest classification of the latest visit (hop order) that has a screenshot."""
    for visit in sorted(visits, key=lambda v: v.hop_id, reverse=True):
        if visit.has_image:
            return visit.classification
    return NO_CLASSIFICATION


def latest_succeeded_label(visits: list[VisitFact]) -> str | None:
    for visit in sorted(visits, key=lambda v: v.hop_id, reverse=True):
        if visit.classification.status == "succeeded":
            return visit.classification.label
    return None


def _has_missing(visits: list[VisitFact]) -> bool:
    return any(
        v.metal_status == "missing" or v.voc_status == "missing" or not v.has_image for v in visits
    )


def cell_quality(visits: list[VisitFact], material: ClassificationFact) -> Quality:
    if any(v.conflicting for v in visits):
        return "conflicting"
    if material.is_failed:
        return "failed"
    if _has_missing(visits):
        return "missing"
    if material.is_pending:
        return "pending"
    if material.is_low_confidence:
        return "low_confidence"
    return "complete"


def cell_flags(
    metal: SensorCellState,
    voc: SensorCellState,
    visits: list[VisitFact],
    material: ClassificationFact,
) -> list[Flag]:
    active: set[Flag] = set()
    if metal == "detected":
        active.add("metal")
    if voc == "detected":
        active.add("voc")
    if material.is_low_confidence:
        active.add("low_confidence")
    if material.is_pending:
        active.add("pending")
    if material.is_failed:
        active.add("failed")
    if _has_missing(visits):
        active.add("missing")
    if any(v.conflicting for v in visits):
        active.add("conflicting")
    return [f for f in FLAG_ORDER if f in active]
