"""Contract cases for the risk rules, exported to `contracts/risk.v2.cases.json`.

Each case is a small grid of per-visit readings plus the assessment the rules must return. The API
and the web client both check every case, so the two implementations cannot drift apart.
Regenerate with `uv run pogoscout-dev contracts` after a deliberate rules change.
"""

from pogoscout_api.domain import risk

OK = "ok"
BG = (0.08, OK)  # clean background


def _cell(x: int, y: int, metal=(BG,), voc=(BG,)) -> dict:
    return {"x": x, "y": y, "metal": [list(r) for r in metal], "voc": [list(r) for r in voc]}


def _field(w: int, h: int, **special: dict) -> list[dict]:
    """A w by h grid of clean cells, with `special` cells keyed "x,y" replacing them."""
    out = []
    for y in range(h):
        for x in range(w):
            out.append(special.get(f"{x},{y}", _cell(x, y)))
    return out


def _cases() -> list[tuple[str, str, list[dict]]]:
    return [
        ("clean", "Clean background everywhere: go.", _field(3, 3)),
        (
            "strong_isolated_metal",
            "One strong metal reading: a suspected explosive hazard, extremely high.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.91, OK),))}),
        ),
        (
            "moderate_metal",
            "Metal at detection strength with nothing else: high, still no-go.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.56, OK),))}),
        ),
        (
            "weak_clutter",
            "A faint metal reading: a weak reading to re-survey, never a hazard area.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.38, OK),))}),
        ),
        (
            "weak_metal_seen_twice",
            "Faint metal on both visits: the revisit counts half, so it stays an anomaly.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.41, OK), (0.44, OK)))}),
        ),
        (
            "confirmed_on_revisit",
            "A detection read again on the second visit adds half its evidence again.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.66, OK), (0.71, OK)))}),
        ),
        (
            "not_repeated",
            "Metal on one visit and background on the next: the revisit weighs against.",
            _field(3, 3, **{"1,1": _cell(1, 1, metal=((0.66, OK), (0.05, OK)))}),
        ),
        (
            "metal_beside_voc",
            "Weak metal beside a VOC detection is corroborated into a hazard.",
            _field(
                3,
                3,
                **{
                    "1,1": _cell(1, 1, metal=((0.45, OK),)),
                    "2,1": _cell(2, 1, voc=((0.62, OK),)),
                },
            ),
        ),
        (
            "voc_only",
            "VOC without metal: a recent activity cue, moderate severity.",
            _field(3, 3, **{"0,0": _cell(0, 0, voc=((0.93, OK),))}),
        ),
        (
            "pattern",
            "Evenly spaced detections: the middle one gains the pattern evidence.",
            _field(
                5,
                1,
                **{
                    "0,0": _cell(0, 0, metal=((0.58, OK),)),
                    "2,0": _cell(2, 0, metal=((0.6, OK),)),
                    "4,0": _cell(4, 0, metal=((0.57, OK),)),
                },
            ),
        ),
        (
            "two_areas",
            "Detections far apart form separate areas, ordered by level then score.",
            _field(
                7,
                1,
                **{
                    "0,0": _cell(0, 0, metal=((0.62, OK),)),
                    "6,0": _cell(6, 0, metal=((0.95, OK),)),
                },
            ),
        ),
        (
            "not_assessed",
            "Cells without a valid metal reading are not assessed, never safe.",
            _field(
                2,
                2,
                **{
                    "0,0": _cell(0, 0, metal=((None, "error"),)),
                    "1,0": _cell(1, 0, metal=((None, "missing"),)),
                },
            ),
        ),
        (
            "rounding",
            "Values with more than two decimals round half up to hundredths.",
            _field(1, 1, **{"0,0": _cell(0, 0, metal=((0.745, OK),))}),
        ),
    ]


def _readings(cells: list[dict]) -> list[risk.CellReadings]:
    return [
        risk.CellReadings(
            c["x"], c["y"], [tuple(r) for r in c["metal"]], [tuple(r) for r in c["voc"]]
        )
        for c in cells
    ]


def build() -> dict:
    return {
        "rules_version": risk.RULES_VERSION,
        # Decibans -> probability in hundredths, over the whole clamped range: the client must
        # convert every value identically.
        "posterior": {
            str(db): risk.posterior(db) for db in range(-risk.DB_LIMIT, risk.DB_LIMIT + 1)
        },
        "cases": [
            {
                "name": name,
                "description": description,
                "cells": cells,
                "expected": risk.to_json(risk.assess(_readings(cells))),
            }
            for name, description, cells in _cases()
        ],
    }
