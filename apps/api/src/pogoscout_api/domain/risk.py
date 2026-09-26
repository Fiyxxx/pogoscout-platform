"""Risk assessment: sensor readings -> per-cell risk, hazard areas and a mission verdict.

Rules `risk-1`. Deterministic and readable, so an operator can always see why a cell is rated.
The same rules run in the web client (`apps/web/src/lib/risk.ts`); both are checked against
`contracts/risk.v1.cases.json`.

Risk follows the Army risk matrix (ATP 5-19): probability (A Frequent .. E Unlikely) against
severity (I Catastrophic .. IV Negligible) gives Extremely high, High, Medium or Low.

Probability comes from an evidence score in hundredths (0..100):
  metal signal strength (the strongest valid reading in the cell), then
  +10 when a detection (50+) is confirmed on every visit, -10 when some visits read nothing,
  +10 when VOC at detection strength reads at or beside the cell,
  +10 when two or more other metal detections lie within two cells (a pattern).
Only detection-strength readings corroborate: faint clutter seen twice is still faint clutter.
A cell with VOC but no metal is scored on its VOC signal as a recent activity cue.
Score to probability: 90+ A, 75+ B, 60+ C, 50+ D, below 50 E. Weak readings are mostly harmless
clutter, so they stay Unlikely: a metal anomaly to re-survey, never a hazard area on its own.

Hazard areas group cells at Medium or above whose score reaches detection strength (50), with
cells up to two apart joined into one area.

Severity: metal is a suspected explosive hazard (I, Catastrophic); VOC alone is a recent activity
cue (III, Moderate). Sensors report signal strength, not what the object is, so nothing here
names a mine or a person.

A cell with no valid metal reading is `not assessed`: unknown is never shown as safe.
All arithmetic is on integer hundredths so Python and TypeScript agree exactly.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Literal

RULES_VERSION = "risk-1"

Kind = Literal["explosive", "activity"]
Level = Literal["EH", "H", "M", "L"]
Verdict = Literal["go", "caution", "no_go"]

SIGNAL = 30  # below this a reading is background
DETECTED = 50  # a cell reads `detected` at or above this
PROBABILITY = ("A", "B", "C", "D", "E")  # Frequent, Likely, Occasional, Seldom, Unlikely
SEVERITY = ("I", "II", "III", "IV")  # Catastrophic, Critical, Moderate, Negligible
MATRIX: dict[str, tuple[Level, ...]] = {
    "I": ("EH", "EH", "H", "H", "M"),
    "II": ("EH", "H", "H", "M", "L"),
    "III": ("H", "M", "M", "L", "L"),
    "IV": ("M", "L", "L", "L", "L"),
}
RANK: dict[Level, int] = {"EH": 4, "H": 3, "M": 2, "L": 1}
AREA_LEVELS: tuple[Level, ...] = ("EH", "H", "M")

Reading = tuple[float | None, str]  # (value, status)


@dataclass(frozen=True)
class CellReadings:
    x: int
    y: int
    metal: Sequence[Reading]  # one per visit, hop order
    voc: Sequence[Reading]


@dataclass(frozen=True)
class CellRisk:
    x: int
    y: int
    assessed: bool
    kind: Kind | None = None
    score: int = 0
    probability: str | None = None
    severity: str | None = None
    level: Level | None = None
    label: str | None = None
    reasons: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class Area:
    id: str
    kind: Kind
    level: Level
    label: str
    action: str
    cells: list[tuple[int, int]]
    centroid: tuple[float, float]
    peak: tuple[int, int]
    score: int
    reasons: list[str]


@dataclass(frozen=True)
class Assessment:
    verdict: Verdict
    verdict_reasons: list[str]
    surveyed: int
    assessed: int
    matrix: dict[str, list[int]]
    cells: list[CellRisk]
    areas: list[Area]


def hundredths(value: float) -> int:
    """0..1 -> 0..100, half away from zero, identical in Python and JavaScript."""
    return int((value * 100 + 0.5) // 1)


def fmt(h: int) -> str:
    return f"{h // 100}.{h % 100:02d}"


def _ok(readings: Iterable[Reading]) -> list[int]:
    return [hundredths(v) for v, status in readings if status == "ok" and v is not None]


def probability(score: int) -> str:
    for threshold, grade in ((90, "A"), (75, "B"), (60, "C"), (50, "D")):
        if score >= threshold:
            return grade
    return "E"


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _repeat(values: list[int], sensor: str) -> tuple[int, str | None]:
    """Score change and reason from repeat visits."""
    n = len(values)
    if n < 2:
        return 0, None
    hits = sum(v >= SIGNAL for v in values)
    if hits < n:
        return -10, f"{sensor} on {hits} of {n} visits"
    if min(values) >= DETECTED:
        return 10, f"{sensor} confirmed on all {n} visits"
    return 0, f"{sensor} on all {n} visits"


def assess_cell(
    cell: CellReadings, metal_max: dict[tuple[int, int], int], voc_max: dict[tuple[int, int], int]
) -> CellRisk:
    metal = _ok(cell.metal)
    voc = _ok(cell.voc)
    x, y = cell.x, cell.y
    if not metal:
        failed = any(status == "error" for _, status in cell.metal)
        why = "Metal sensor error" if failed else "No metal reading"
        return CellRisk(x, y, assessed=False, reasons=[why])

    m = max(metal)
    v = max(voc, default=0)
    reasons: list[str] = []
    if m >= SIGNAL:
        kind: Kind = "explosive"
        severity = "I"
        score = m
        reasons.append(f"Metal signal {fmt(m)}")
        change, why = _repeat(metal, "Metal")
        score += change
        if why:
            reasons.append(why)
        near = max(
            (voc_max.get((x + dx, y + dy), 0) for dx in (-1, 0, 1) for dy in (-1, 0, 1)),
            default=0,
        )
        if near >= DETECTED:
            score += 10
            reasons.append(f"VOC {fmt(near)} at or beside this cell")
        pattern = sum(
            1
            for dx in range(-2, 3)
            for dy in range(-2, 3)
            if (dx, dy) != (0, 0) and metal_max.get((x + dx, y + dy), 0) >= DETECTED
        )
        if pattern >= 2:
            score += 10
            reasons.append(f"{pattern} more metal hits within 2 cells")
    elif v >= SIGNAL:
        kind = "activity"
        severity = "III"
        score = v
        reasons.append(f"VOC signal {fmt(v)}")
        change, why = _repeat(voc, "VOC")
        score += change
        if why:
            reasons.append(why)
        reasons.append("No metal signal")
    else:
        return CellRisk(x, y, assessed=True, score=max(m, v))

    score = max(0, min(100, score))
    grade = probability(score)
    level = MATRIX[severity][PROBABILITY.index(grade)]
    if kind == "explosive":
        label = "Suspected explosive hazard" if score >= DETECTED else "Metal anomaly"
    else:
        label = "Recent activity cue"
    return CellRisk(x, y, True, kind, score, grade, severity, level, label, reasons)


ACTIONS = {
    ("explosive", True): "Do not enter. Mark and bypass, and request EOD clearance.",
    ("explosive", False): "Re-survey with the Route clearance loadout before use.",
    ("activity", False): "Approach with caution and observe. A cue, not a detection.",
}


def _areas(risks: list[CellRisk]) -> list[Area]:
    members = {(r.x, r.y): r for r in risks if r.level in AREA_LEVELS and r.score >= DETECTED}
    seen: set[tuple[int, int]] = set()
    groups: list[list[CellRisk]] = []
    for start in sorted(members, key=lambda p: (p[1], p[0])):
        if start in seen:
            continue
        seen.add(start)
        queue, group = [start], []
        while queue:
            x, y = queue.pop()
            group.append(members[(x, y)])
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    nxt = (x + dx, y + dy)
                    if nxt in members and nxt not in seen:
                        seen.add(nxt)
                        queue.append(nxt)
        groups.append(sorted(group, key=lambda r: (r.y, r.x)))

    areas: list[Area] = []
    for group in groups:
        kind: Kind = "explosive" if any(r.kind == "explosive" for r in group) else "activity"
        peak = max(group, key=lambda r: (RANK[r.level], r.score, -r.y, -r.x))  # type: ignore[index]
        level = peak.level
        assert level is not None
        severe = kind == "explosive" and level in ("EH", "H")
        n = len(group)
        cx = sum(r.x for r in group) * 100 // n
        cy = sum(r.y for r in group) * 100 // n
        reasons = list(peak.reasons)
        if n > 1:
            reasons.append(_plural(n, "cell", "cells") + " in this area")
        areas.append(
            Area(
                id="",
                kind=kind,
                level=level,
                label="Suspected explosive hazard" if kind == "explosive" else "Recent activity",
                action=ACTIONS[(kind, severe)],
                cells=[(r.x, r.y) for r in group],
                centroid=(cx / 100, cy / 100),
                peak=(peak.x, peak.y),
                score=peak.score,
                reasons=reasons,
            )
        )
    areas.sort(key=lambda a: (-RANK[a.level], -a.score, a.peak[1], a.peak[0]))
    return [
        Area(
            f"A{i}",
            a.kind,
            a.level,
            a.label,
            a.action,
            a.cells,
            a.centroid,
            a.peak,
            a.score,
            a.reasons,
        )
        for i, a in enumerate(areas, start=1)
    ]


def assess(cells: Iterable[CellReadings]) -> Assessment:
    cells = list(cells)
    metal_max = {(c.x, c.y): max(_ok(c.metal), default=0) for c in cells}
    voc_max = {(c.x, c.y): max(_ok(c.voc), default=0) for c in cells}
    risks = [assess_cell(c, metal_max, voc_max) for c in sorted(cells, key=lambda c: (c.y, c.x))]
    areas = _areas(risks)

    matrix = {s: [0] * len(PROBABILITY) for s in SEVERITY}
    for r in risks:
        if r.kind is not None:
            matrix[r.severity][PROBABILITY.index(r.probability)] += 1  # type: ignore[index,arg-type]

    surveyed = len(risks)
    assessed = sum(r.assessed for r in risks)
    severe = sum(a.kind == "explosive" and a.level in ("EH", "H") for a in areas)
    anomalies = sum(a.kind == "explosive" and a.level == "M" for a in areas)
    activity = sum(a.kind == "activity" for a in areas)
    in_areas = {c for a in areas for c in a.cells}
    loose = sum(r.kind == "explosive" and (r.x, r.y) not in in_areas for r in risks)
    missing = surveyed - assessed
    missing_pct = (missing * 100 + surveyed // 2) // surveyed if surveyed else 0

    reasons: list[str] = []
    if severe:
        reasons.append(_plural(severe, "suspected explosive hazard", "suspected explosive hazards"))
    if anomalies:
        reasons.append(
            _plural(anomalies, "metal anomaly area", "metal anomaly areas") + " to re-survey"
        )
    if activity:
        reasons.append(_plural(activity, "recent activity area", "recent activity areas"))
    if loose:
        reasons.append(
            _plural(loose, "weak metal reading", "weak metal readings") + " to re-survey"
        )
    if missing:
        reasons.append(f"{missing_pct}% of surveyed cells not assessed")
    if severe:
        verdict: Verdict = "no_go"
    elif anomalies or activity or loose or missing_pct >= 5:
        verdict = "caution"
    else:
        verdict = "go"
    if not reasons:
        reasons.append("No indications in surveyed cells")
    return Assessment(verdict, reasons, surveyed, assessed, matrix, risks, areas)


def to_json(assessment: Assessment) -> dict:
    """Wire form shared with the web client and the contract test cases."""
    return {
        "rules_version": RULES_VERSION,
        "verdict": assessment.verdict,
        "verdict_reasons": assessment.verdict_reasons,
        "coverage": {"surveyed": assessment.surveyed, "assessed": assessment.assessed},
        "matrix": assessment.matrix,
        "cells": [
            {
                "x": r.x,
                "y": r.y,
                "assessed": r.assessed,
                "kind": r.kind,
                "score": r.score,
                "probability": r.probability,
                "severity": r.severity,
                "level": r.level,
                "label": r.label,
                "reasons": r.reasons,
            }
            for r in assessment.cells
            if r.kind is not None or not r.assessed
        ],
        "areas": [
            {
                "id": a.id,
                "kind": a.kind,
                "level": a.level,
                "label": a.label,
                "action": a.action,
                "cells": [list(c) for c in a.cells],
                "centroid": list(a.centroid),
                "peak": list(a.peak),
                "score": a.score,
                "reasons": a.reasons,
            }
            for a in assessment.areas
        ],
    }
