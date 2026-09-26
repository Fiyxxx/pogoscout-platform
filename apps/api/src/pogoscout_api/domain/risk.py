"""Risk assessment: sensor readings -> per-cell risk, hazard areas and a mission summary.

Rules `risk-2`: Bayesian evidence fusion. The same rules run in the web client
(`apps/web/src/lib/risk.ts`); both are checked against `contracts/risk.v2.cases.json`.

Each cell asks two questions, each a hypothesis with a prior:
  H  a suspected explosive hazard (a metal object that matters) is in the cell    prior 2%
  A  there was recent activity at the cell                                        prior 3%

Every reading shifts the odds by its likelihood ratio P(reading | H) / P(reading | not H), counted
in decibans (dB, 10 log10 of the ratio; +10 dB multiplies the odds by 10). Evidence adds:
  posterior dB = prior dB + sum of evidence dB,   P = 1 / (1 + 10^(-dB / 10)).

Sensor models (the likelihood tables below) are assumptions standing in for a calibration of the
real detector on known targets; the dB weights are derived from them, rounded to whole decibans.
  - Metal readings, binned by signal strength, weigh for or against H.
  - The strongest reading in a cell counts in full; each further visit counts half, because
    clutter persists too, so repeat readings of one object are correlated, not independent.
  - A VOC detection at or beside the cell supports H (disturbance often leaves a vapour cue).
  - Two or more other metal detections within two cells support H (hazards cluster).
  - VOC readings weigh for or against A the same way.
Absence of VOC is treated as uninformative: most hazards leave no vapour cue.

The posterior maps to likelihood on the Army risk matrix (ATP 5-19): 80%+ A Frequent,
50%+ B Likely, 25%+ C Occasional, 15%+ D Seldom, else E Unlikely. Severity: H is I Catastrophic,
A is III Moderate. The matrix then gives Extremely high, High, Medium or Low.

Cells with metal of at least 0.30 are rated for H; otherwise cells with VOC of at least 0.30 are
rated for A. A cell with no valid metal reading is `not assessed`: unknown is never shown as safe.
A hazard cell with P of 15% or more (Seldom or likelier, so High or above) is a suspected
explosive hazard; below that it is a metal anomaly to re-survey. Hazard areas join cells at
Medium or above with P of 15% or more, up to two cells apart.

Evidence is integer decibans and probabilities integer hundredths, so the two implementations
agree exactly. Sensors report signal strength, so nothing here names a mine or a person.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field, replace
from typing import Literal

RULES_VERSION = "risk-2"

Kind = Literal["explosive", "activity"]
Level = Literal["EH", "H", "M", "L"]

SIGNAL = 30  # below this a reading is background
DETECTED = 50  # a reading at or above this is a detection
SUSPECTED = 15  # P (hundredths) from which a cell is suspected (Seldom or more) and joins areas
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

# Priors, as a share of cells and in decibans: 10 log10(p / (1 - p)).
HAZARD_PRIOR = (0.02, -17)
ACTIVITY_PRIOR = (0.03, -15)

# Sensor models: (lowest signal in hundredths, P(bin | hypothesis), P(bin | not), weight in dB).
# Each probability column sums to 1; the dB column is round(10 log10(P | hyp / P | not)).
METAL_MODEL = (
    (85, 0.15, 0.0005, 25),
    (70, 0.25, 0.0015, 22),
    (50, 0.30, 0.008, 16),
    (30, 0.15, 0.04, 6),
    (0, 0.15, 0.95, -8),
)
VOC_MODEL = (
    (85, 0.15, 0.001, 22),
    (70, 0.20, 0.002, 20),
    (50, 0.25, 0.007, 16),
    (30, 0.20, 0.035, 8),
    (0, 0.20, 0.955, -7),
)
# Context evidence for H: (P | H, P | not H, weight in dB).
VOC_NEARBY = (0.20, 0.03, 8)
METAL_PATTERN = (0.40, 0.04, 10)
DB_LIMIT = 60

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
    db: int = 0  # posterior log odds, decibans
    p: int = 0  # posterior probability, hundredths
    probability: str | None = None  # likelihood grade A..E
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
    p: int
    reasons: list[str]


@dataclass(frozen=True)
class Assessment:
    summary: list[str]
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


def signed(db: int) -> str:
    return f"+{db} dB" if db > 0 else f"−{-db} dB" if db < 0 else "0 dB"


def posterior(db: int) -> int:
    """Log odds in decibans -> probability in hundredths."""
    return hundredths(1 / (1 + 10 ** (-db / 10)))


def grade(p: int) -> str:
    for threshold, letter in ((80, "A"), (50, "B"), (25, "C"), (15, "D")):
        if p >= threshold:
            return letter
    return "E"


def weight(model: tuple[tuple[int, float, float, int], ...], value: int) -> int:
    for lowest, _, _, db in model:
        if value >= lowest:
            return db
    raise ValueError(value)


def _ok(readings: Iterable[Reading]) -> list[int]:
    return [hundredths(v) for v, status in readings if status == "ok" and v is not None]


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


def _visits(values: list[int], sensor: str, model) -> tuple[int, list[str]]:
    """Evidence from every visit: the strongest reading in full, each further visit half."""
    total = 0
    lines = []
    for i, value in enumerate(sorted(values, reverse=True)):
        db = weight(model, value)
        if i == 0:
            lines.append(f"{sensor} {fmt(value)}: {signed(db)}")
        else:
            db = db // 2
            lines.append(f"{sensor} {fmt(value)} on revisit: {signed(db)}")
        total += db
    return total, lines


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

    if max(metal) >= SIGNAL:
        kind: Kind = "explosive"
        severity = "I"
        prior_share, db = HAZARD_PRIOR
        reasons = [f"Prior {round(prior_share * 100)}% of cells: {signed(db)}"]
        evidence, lines = _visits(metal, "Metal", METAL_MODEL)
        db += evidence
        reasons += lines
        near = max(voc_max.get((x + dx, y + dy), 0) for dx in (-1, 0, 1) for dy in (-1, 0, 1))
        if near >= DETECTED:
            db += VOC_NEARBY[2]
            reasons.append(f"VOC {fmt(near)} at or beside this cell: {signed(VOC_NEARBY[2])}")
        pattern = sum(
            1
            for dx in range(-2, 3)
            for dy in range(-2, 3)
            if (dx, dy) != (0, 0) and metal_max.get((x + dx, y + dy), 0) >= DETECTED
        )
        if pattern >= 2:
            db += METAL_PATTERN[2]
            reasons.append(
                f"{pattern} more metal detections within 2 cells: {signed(METAL_PATTERN[2])}"
            )
    elif voc and max(voc) >= SIGNAL:
        kind = "activity"
        severity = "III"
        prior_share, db = ACTIVITY_PRIOR
        reasons = [f"Prior {round(prior_share * 100)}% of cells: {signed(db)}", "No metal signal"]
        evidence, lines = _visits(voc, "VOC", VOC_MODEL)
        db += evidence
        reasons[1:1] = lines
    else:
        return CellRisk(x, y, assessed=True)

    db = max(-DB_LIMIT, min(DB_LIMIT, db))
    p = posterior(db)
    letter = grade(p)
    level = MATRIX[severity][PROBABILITY.index(letter)]
    if kind == "explosive":
        label = "Suspected explosive hazard" if p >= SUSPECTED else "Metal anomaly"
    else:
        label = "Recent activity cue"
    return CellRisk(x, y, True, kind, db, p, letter, severity, level, label, reasons)


SEVERE_ACTION = (
    "Mark the area and bypass where possible. If passage is needed, use a cleared lane or "
    "request EOD."
)
ACTIONS = {
    ("explosive", True): SEVERE_ACTION,
    ("explosive", False): "Re-survey with the Route clearance loadout before use.",
    ("activity", False): "Approach with caution and observe. A cue, not a detection.",
}


def _areas(risks: list[CellRisk]) -> list[Area]:
    members = {(r.x, r.y): r for r in risks if r.level in AREA_LEVELS and r.p >= SUSPECTED}
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
        peak = max(group, key=lambda r: (RANK[r.level], r.p, -r.y, -r.x))  # type: ignore[index]
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
                p=peak.p,
                reasons=reasons,
            )
        )
    areas.sort(key=lambda a: (-RANK[a.level], -a.p, a.peak[1], a.peak[0]))
    return [replace(a, id=f"A{i}") for i, a in enumerate(areas, start=1)]


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
        reasons.append(_plural(loose, "metal anomaly", "metal anomalies") + " to re-survey")
    if missing:
        reasons.append(f"{missing_pct}% of surveyed cells not assessed")
    if not reasons:
        reasons.append("No indications in surveyed cells")
    return Assessment(reasons, surveyed, assessed, matrix, risks, areas)


def to_json(assessment: Assessment) -> dict:
    """Wire form shared with the web client and the contract test cases."""
    return {
        "rules_version": RULES_VERSION,
        "summary": assessment.summary,
        "coverage": {"surveyed": assessment.surveyed, "assessed": assessment.assessed},
        "matrix": assessment.matrix,
        "cells": [
            {
                "x": r.x,
                "y": r.y,
                "assessed": r.assessed,
                "kind": r.kind,
                "db": r.db,
                "p": r.p,
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
                "p": a.p,
                "reasons": a.reasons,
            }
            for a in assessment.areas
        ],
    }


def heat_weight(cell: dict) -> float:
    """Theatre heat weight for a wire cell: P for hazards, half P for activity, -1 unassessed."""
    if not cell["assessed"]:
        return -1
    return cell["p"] / 100 if cell["kind"] == "explosive" else cell["p"] / 200
