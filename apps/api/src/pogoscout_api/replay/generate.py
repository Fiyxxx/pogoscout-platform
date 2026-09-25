"""Deterministic fixture generator. Same seed -> byte-identical scenario.json and images."""

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


def _material_for(x: int, y: int) -> str:
    """Clean baseline terrain: soil with a leaf-litter strip and a concrete patch."""
    if y >= 5:
        return "concrete"
    if x == 1:
        return "leaf_litter"
    return "soil"


def build_clean_baseline(out_dir: Path, seed: int = 42) -> None:
    scenario_id = "clean_baseline_v1"
    rng = random.Random(seed)
    commands = list("FFFFF" + "R" + "BBBBB" + "R" + "FFFFF" + "R" + "BBBB")
    metal_hits = set(rng.sample(range(1, len(commands) + 1), 2))
    voc_hits = set(rng.sample(range(1, len(commands) + 1), 1))

    events: list[HopEvent | ImageEvent] = []
    path: list[dict] = []
    cells: dict[tuple[int, int], dict] = {}
    x = y = 0
    seq = 0
    for hop_id, command in enumerate(commands, start=1):
        dx, dy = MOVEMENT_VECTORS[command]
        x, y = x + dx, y + dy
        at_ms = (hop_id - 1) * HOP_INTERVAL_MS
        metal = 1 if hop_id in metal_hits else 0
        voc = 1 if hop_id in voc_hits else 0
        payload = {
            "schema_version": "1.0",
            "observed_at": (BASE_TIME + timedelta(milliseconds=at_ms))
            .isoformat()
            .replace("+00:00", "Z"),
            "producer_id": "mock-generator",
            "source": "mock",
            "movement": {"command": command, "dx": dx, "dy": dy},
            "sensors": {
                "metal": {"value": metal, "status": "ok"},
                "voc": {"value": voc, "status": "ok"},
            },
        }
        seq += 1
        events.append(HopEvent(seq=seq, at_ms=at_ms, hop_id=hop_id, payload=payload))

        label = _material_for(x, y)
        image_file = f"images/hop_{hop_id:03d}.png"
        render_mock_image(out_dir / image_file, scenario_id, hop_id, label, seed)
        seq += 1
        events.append(
            ImageEvent(
                seq=seq,
                at_ms=at_ms + IMAGE_DELAY_MS,
                hop_id=hop_id,
                file=image_file,
                mock_label=label,
                mock_confidence=round(0.78 + rng.random() * 0.2, 2),
            )
        )

        path.append({"hop_id": hop_id, "x": x, "y": y})
        cell = cells.setdefault((x, y), {"x": x, "y": y, "hop_ids": [], "metal": [], "voc": []})
        cell["hop_ids"].append(hop_id)
        cell["metal"].append(metal)
        cell["voc"].append(voc)

    scenario = Scenario(
        scenario_id=scenario_id,
        description="Serpentine sweep with normal readings, two metal anomalies, one VOC cue, "
        "and on-time mock screenshots.",
        seed=seed,
        mission=ScenarioMission(name="Clean baseline", source="mock"),
        events=events,
    )
    expected = {
        "scenario_id": scenario_id,
        "current": {"x": x, "y": y},
        "path": path,
        "pending_hop_ids": [],
        "cells": [
            {
                "x": c["x"],
                "y": c["y"],
                "hop_ids": c["hop_ids"],
                "metal": "detected" if 1 in c["metal"] else "not_detected",
                "voc": "detected" if 1 in c["voc"] else "not_detected",
            }
            for c in sorted(cells.values(), key=lambda c: (c["y"], c["x"]))
        ],
    }
    _write_json(out_dir / "scenario.json", scenario.model_dump(mode="json"))
    _write_json(out_dir / "expected_projection.json", expected)


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


BUILDERS = {"clean_baseline_v1": build_clean_baseline}
