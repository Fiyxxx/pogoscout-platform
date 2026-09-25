from pogoscout_api.domain.quality import (
    NO_CLASSIFICATION,
    ClassificationFact,
    VisitFact,
    cell_flags,
    cell_material,
    cell_quality,
    latest_succeeded_label,
)

OK = ClassificationFact(status="succeeded", label="soil", confidence=0.9)
LOW = ClassificationFact(status="succeeded", label="mud", confidence=0.62)
QUEUED = ClassificationFact(status="queued")
FAILED = ClassificationFact(status="failed", error="x")


def visit(hop_id=1, cls=OK, image=True, metal="ok", voc="ok", conflicting=False) -> VisitFact:
    return VisitFact(hop_id, metal, voc, image, cls if image else NO_CLASSIFICATION, conflicting)


def quality(*visits: VisitFact) -> str:
    return cell_quality(list(visits), cell_material(list(visits)))


def test_material_is_latest_visit_with_image() -> None:
    visits = [visit(1, OK), visit(5, LOW), visit(9, image=False)]
    assert cell_material(visits) == LOW
    assert cell_material([visit(2, image=False)]) == NO_CLASSIFICATION
    assert latest_succeeded_label([visit(1, OK), visit(4, QUEUED)]) == "soil"


def test_quality_priority() -> None:
    assert quality(visit(cls=FAILED, conflicting=True)) == "conflicting"
    assert quality(visit(cls=FAILED, voc="missing")) == "failed"
    assert quality(visit(cls=ClassificationFact(status="unavailable"))) == "failed"
    assert quality(visit(cls=QUEUED, metal="missing")) == "missing"
    assert quality(visit(image=False)) == "missing"
    assert quality(visit(cls=QUEUED)) == "pending"
    assert quality(visit(cls=ClassificationFact(status="retrying"))) == "pending"
    assert quality(visit(cls=LOW)) == "low_confidence"
    assert quality(visit(cls=OK, metal="error")) == "complete"
    boundary = ClassificationFact(status="succeeded", label="soil", confidence=0.80)
    assert quality(visit(cls=boundary)) == "complete"


def test_flags_are_ordered_and_combined() -> None:
    visits = [visit(1, LOW, conflicting=True), visit(2, image=False)]
    material = cell_material(visits)
    assert cell_flags("detected", "detected", visits, material) == [
        "metal",
        "voc",
        "low_confidence",
        "missing",
        "conflicting",
    ]
    visits = [visit(1, LOW)]
    flags = cell_flags("detected", "not_detected", visits, cell_material(visits))
    assert flags == ["metal", "low_confidence"]
    assert cell_flags("not_detected", "sensor_error", [visit(cls=QUEUED)], QUEUED) == ["pending"]
    assert cell_flags("missing", "missing", [visit(cls=FAILED)], FAILED) == ["failed"]
