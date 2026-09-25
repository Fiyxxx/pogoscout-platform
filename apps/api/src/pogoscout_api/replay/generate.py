"""Deterministic fixture generator. Same seed -> byte-identical scenario.json and images.

`expected_projection.json` is derived here from the fixture's intent (not from the projection
code under test) and records the final cell state once every queued classification has run.
"""

import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from pogoscout_api.domain.hops import MOVEMENT_VECTORS
from pogoscout_api.replay.scenario import HopEvent, ImageEvent, Scenario, ScenarioMission

MOCK_IMAGE_COLOURS: dict[str, tuple[int, int, int]] = {
    "soil": (138, 74, 44),
    "mud": (74, 46, 32),
    "sand": (211, 194, 155),
    "gravel": (141, 141, 136),
    "grass_vegetation": (63, 107, 42),
    "leaf_litter": (107, 74, 38),
    "concrete": (185, 184, 178),
    "asphalt": (47, 47, 48),
    "tiles_pavers": (168, 106, 82),
    "water": (31, 52, 64),
}

BASE_TIME = datetime(2026, 9, 25, 8, 0, 0, tzinfo=UTC)
HOP_INTERVAL_MS = 4000
IMAGE_DELAY_MS = 600
LOW_CONFIDENCE = 0.80
FLAG_ORDER = ("metal", "voc", "low_confidence", "pending", "failed", "missing", "conflicting")

Reading = tuple[int | None, str]
OK0: Reading = (0, "ok")
OK1: Reading = (1, "ok")


def render_mock_image(path: Path, scenario_id: str, hop_id: int, label: str, seed: int) -> None:
    rng = random.Random(seed * 1000 + hop_id)
    base = MOCK_IMAGE_COLOURS[label]
    img = Image.new("RGB", (320, 240), base)
    draw = ImageDraw.Draw(img)
    for _ in range(40):
        x, y, r = rng.randint(0, 320), rng.randint(0, 240), rng.randint(4, 22)
        shade = tuple(max(0, min(255, c + rng.randint(-28, 28))) for c in base)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=shade)
    draw.rectangle((0, 0, 320, 64), fill=(0, 0, 0))
    font = ImageFont.load_default(size=14)
    draw.text((8, 6), "SYNTHETIC MOCK EVIDENCE", fill=(255, 196, 0), font=font)
    draw.text((8, 25), f"{scenario_id} / hop {hop_id:03d}", fill=(230, 230, 230), font=font)
    draw.text((8, 44), f"mock class: {label}", fill=(230, 230, 230), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)


def _timestamp(ms: int) -> str:
    return (BASE_TIME + timedelta(milliseconds=ms)).isoformat().replace("+00:00", "Z")


def _sensor_state(readings: list[Reading]) -> str:
    if any(r == OK1 for r in readings):
        return "detected"
    if any(r == OK0 for r in readings):
        return "not_detected"
    if any(status == "error" for _, status in readings):
        return "sensor_error"
    return "missing"


class FixtureBuilder:
    """Accumulates scenario events in arrival order and derives the expected projection."""

    def __init__(self, scenario_id: str, out_dir: Path, seed: int) -> None:
        self.scenario_id = scenario_id
        self.out_dir = out_dir
        self.seed = seed
        self.events: list[HopEvent | ImageEvent] = []
        self.hops: dict[int, dict] = {}
        self.conflicts: set[int] = set()
        self.images: dict[int, tuple[str, float]] = {}

    def payload(self, command: str, observed_ms: int, metal: Reading, voc: Reading) -> dict:
        dx, dy = MOVEMENT_VECTORS[command]
        return {
            "schema_version": "1.0",
            "observed_at": _timestamp(observed_ms),
            "producer_id": "mock-generator",
            "source": "mock",
            "movement": {"command": command, "dx": dx, "dy": dy},
            "sensors": {
                "metal": {"value": metal[0], "status": metal[1]},
                "voc": {"value": voc[0], "status": voc[1]},
            },
        }

    def send(self, hop_id: int, at_ms: int, payload: dict) -> None:
        """Append a hop event. Resending a stored identity is a duplicate or a conflict."""
        if hop_id in self.hops:
            if self.hops[hop_id] != payload:
                self.conflicts.add(hop_id)
        else:
            self.hops[hop_id] = payload
        seq = len(self.events) + 1
        self.events.append(HopEvent(seq=seq, at_ms=at_ms, hop_id=hop_id, payload=payload))

    def hop(
        self,
        hop_id: int,
        command: str,
        *,
        at_ms: int | None = None,
        metal: Reading = OK0,
        voc: Reading = OK0,
    ) -> dict:
        observed_ms = (hop_id - 1) * HOP_INTERVAL_MS
        payload = self.payload(command, observed_ms, metal, voc)
        self.send(hop_id, observed_ms if at_ms is None else at_ms, payload)
        return payload

    def image(self, hop_id: int, at_ms: int, label: str, confidence: float) -> None:
        image_file = f"images/hop_{hop_id:03d}.png"
        render_mock_image(self.out_dir / image_file, self.scenario_id, hop_id, label, self.seed)
        self.images.setdefault(hop_id, (label, confidence))
        seq = len(self.events) + 1
        self.events.append(
            ImageEvent(
                seq=seq,
                at_ms=at_ms,
                hop_id=hop_id,
                file=image_file,
                mock_label=label,
                mock_confidence=confidence,
            )
        )

    def expected(self) -> dict:
        path: list[dict] = []
        cells: dict[tuple[int, int], list[int]] = {}
        x = y = 0
        hop_id = 1
        while hop_id in self.hops:
            movement = self.hops[hop_id]["movement"]
            x, y = x + movement["dx"], y + movement["dy"]
            path.append({"hop_id": hop_id, "x": x, "y": y})
            cells.setdefault((x, y), []).append(hop_id)
            hop_id += 1
        pending = sorted(h for h in self.hops if h >= hop_id)
        return {
            "scenario_id": self.scenario_id,
            "current": {"x": x, "y": y},
            "path": path,
            "pending_hop_ids": pending,
            "cells": [
                self._expected_cell(cx, cy, hop_ids)
                for (cx, cy), hop_ids in sorted(cells.items(), key=lambda i: (i[0][1], i[0][0]))
            ],
        }

    def _expected_cell(self, x: int, y: int, hop_ids: list[int]) -> dict:
        def reading(hop: int, sensor: str) -> Reading:
            r = self.hops[hop]["sensors"][sensor]
            return r["value"], r["status"]

        metal = _sensor_state([reading(h, "metal") for h in hop_ids])
        voc = _sensor_state([reading(h, "voc") for h in hop_ids])
        imaged = [h for h in hop_ids if h in self.images]
        if imaged:
            label, confidence = self.images[imaged[-1]]
            material = {"status": "succeeded", "label": label, "confidence": confidence}
        else:
            material = {"status": "none", "label": None, "confidence": None}
        missing = any(
            reading(h, "metal")[1] == "missing"
            or reading(h, "voc")[1] == "missing"
            or h not in self.images
            for h in hop_ids
        )
        conflicting = any(h in self.conflicts for h in hop_ids)
        low = material["status"] == "succeeded" and material["confidence"] < LOW_CONFIDENCE
        if conflicting:
            quality = "conflicting"
        elif missing:
            quality = "missing"
        elif low:
            quality = "low_confidence"
        else:
            quality = "complete"
        active = {
            "metal": metal == "detected",
            "voc": voc == "detected",
            "low_confidence": low,
            "missing": missing,
            "conflicting": conflicting,
        }
        return {
            "x": x,
            "y": y,
            "hop_ids": hop_ids,
            "metal": metal,
            "voc": voc,
            "material": material,
            "quality": quality,
            "flags": [f for f in FLAG_ORDER if active.get(f)],
        }

    def write(self, description: str, mission_name: str) -> None:
        scenario = Scenario(
            scenario_id=self.scenario_id,
            description=description,
            seed=self.seed,
            mission=ScenarioMission(name=mission_name, source="mock"),
            events=self.events,
        )
        _write_json(self.out_dir / "scenario.json", scenario.model_dump(mode="json"))
        _write_json(self.out_dir / "expected_projection.json", self.expected())


def _positions(commands: str) -> list[tuple[int, int]]:
    x = y = 0
    out = []
    for command in commands:
        dx, dy = MOVEMENT_VECTORS[command]
        x, y = x + dx, y + dy
        out.append((x, y))
    return out


# clean_baseline_v1 ---------------------------------------------------------------------------


def _clean_material(x: int, y: int) -> str:
    """Clean baseline terrain: soil with a leaf-litter strip and a concrete patch."""
    if y >= 5:
        return "concrete"
    if x == 1:
        return "leaf_litter"
    return "soil"


def build_clean_baseline(out_dir: Path, seed: int = 42) -> None:
    b = FixtureBuilder("clean_baseline_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = "FFFFF" + "R" + "BBBBB" + "R" + "FFFFF" + "R" + "BBBB"
    metal_hits = set(rng.sample(range(1, len(commands) + 1), 2))
    voc_hits = set(rng.sample(range(1, len(commands) + 1), 1))
    for hop_id, (command, (x, y)) in enumerate(
        zip(commands, _positions(commands), strict=True), start=1
    ):
        at_ms = (hop_id - 1) * HOP_INTERVAL_MS
        b.hop(
            hop_id,
            command,
            metal=OK1 if hop_id in metal_hits else OK0,
            voc=OK1 if hop_id in voc_hits else OK0,
        )
        confidence = round(0.78 + rng.random() * 0.2, 2)  # render_mock_image has its own rng
        b.image(hop_id, at_ms + IMAGE_DELAY_MS, _clean_material(x, y), confidence)
    b.write(
        "Serpentine sweep with normal readings, two metal anomalies, one VOC cue, "
        "and on-time mock screenshots.",
        "Clean baseline",
    )


# park_connector_v1 ---------------------------------------------------------------------------


def park_material(x: int, y: int) -> str:
    """Six by six park connector: paved path, sand pit, a pond cell, grass and leaf litter."""
    if x == 2:
        return "tiles_pavers"
    if x == 5:
        return "water" if y == 3 else "asphalt"
    if x == 3:
        return "sand" if y <= 2 else ("gravel" if y <= 4 else "concrete")
    if x == 4:
        if y <= 2:
            return "sand"
        return "gravel" if y == 3 else ("grass_vegetation" if y == 4 else "concrete")
    if (x == 0 and y >= 5) or (x == 1 and y == 6):
        return "leaf_litter"
    if (x == 1 and y == 5) or y == 4:
        return "grass_vegetation"
    if y == 3 or (x == 0 and y == 2):
        return "soil"
    if x == 1 and y == 1:
        return "water"
    return "mud"


PARK_METAL = {(4, 3), (1, 2)}
PARK_VOC = {(0, 5)}
PARK_CONFIDENCE = {(1, 2): 0.62, (3, 4): 0.74}


def build_park_connector(out_dir: Path, seed: int = 924) -> None:
    b = FixtureBuilder("park_connector_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = "FFFFFF" + "RBBBBB" + "RFFFFF" + "RBBBBB" + "RFFFFF" + "RBBBBB"
    for hop_id, (command, (x, y)) in enumerate(
        zip(commands, _positions(commands), strict=True), start=1
    ):
        at_ms = (hop_id - 1) * HOP_INTERVAL_MS
        label = park_material(x, y)
        confidence = round(rng.uniform(0.82, 0.96), 2)
        if label == "water":
            confidence = 0.97
        confidence = PARK_CONFIDENCE.get((x, y), confidence)
        b.hop(
            hop_id,
            command,
            metal=OK1 if (x, y) in PARK_METAL else OK0,
            voc=OK1 if (x, y) in PARK_VOC else OK0,
        )
        b.image(hop_id, at_ms + IMAGE_DELAY_MS, label, confidence)
    b.write(
        "Six by six serpentine sweep of a park connector: paved path, sand pit, pond, two metal "
        "anomalies, one VOC cue and two low-confidence cells.",
        "Park connector sweep",
    )


# failures_v1 ---------------------------------------------------------------------------------


def _failure_material(x: int, y: int) -> str:
    if x == 0:
        return "soil"
    if y == 0:
        return "concrete"
    if y == 1:
        return "mud"
    return "gravel"


def build_failures(out_dir: Path, seed: int = 902) -> None:
    """Nine hops exercising every data-quality path the platform must survive.

    hop 2  resent identically (duplicate, idempotent)
    hop 3  resent with a different metal reading (conflict, rejected, cell `conflicting`)
    hop 4  never gets a screenshot (missing)
    hop 5  screenshot arrives after hop 7 (delayed)
    hop 6  metal sensor error (status error, value null)
    hop 7  VOC reading missing
    hop 9  arrives before hop 8 (out of order, pending until 8 lands)
    hop 9  confidence hint 0.55 forces a low-confidence result on a revisited cell
    """
    b = FixtureBuilder("failures_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = "FFRRBBLFL"
    positions = _positions(commands)

    def ms(hop_id: int, offset: int = 0) -> int:
        return (hop_id - 1) * HOP_INTERVAL_MS + offset

    def image(hop_id: int, at_ms: int, confidence: float | None = None) -> None:
        x, y = positions[hop_id - 1]
        conf = round(rng.uniform(0.84, 0.95), 2) if confidence is None else confidence
        b.image(hop_id, at_ms, _failure_material(x, y), conf)

    b.hop(1, "F")
    image(1, ms(1, IMAGE_DELAY_MS))
    hop2 = b.hop(2, "F")
    image(2, ms(2, IMAGE_DELAY_MS))
    b.send(2, ms(2, 1200), hop2)
    b.hop(3, "R")
    image(3, ms(3, IMAGE_DELAY_MS))
    b.send(3, ms(3, 1200), b.payload("R", ms(3), OK1, OK0))
    b.hop(4, "R")
    b.hop(5, "B", voc=OK1)
    b.hop(6, "B", metal=(None, "error"))
    image(6, ms(6, IMAGE_DELAY_MS))
    b.hop(7, "L", voc=(None, "missing"))
    image(7, ms(7, IMAGE_DELAY_MS))
    image(5, ms(7, 1200))
    b.hop(9, "L", at_ms=ms(9))
    image(9, ms(9, IMAGE_DELAY_MS), confidence=0.55)
    b.hop(8, "F", at_ms=ms(9, 1000), metal=OK1)
    image(8, ms(9, 1600))
    b.write(
        "Failure modes: duplicate and conflicting resends, a missing and a delayed screenshot, "
        "a sensor error, a missing reading, an out-of-order hop and a low-confidence result.",
        "Failure modes",
    )


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


BUILDERS = {
    "clean_baseline_v1": build_clean_baseline,
    "park_connector_v1": build_park_connector,
    "failures_v1": build_failures,
}
