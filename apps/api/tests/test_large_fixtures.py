"""Large fixtures (generated screenshots): prefix goldens by default, full goldens with --run-slow.

Every check replays through the public API (`POST /replays` + `/replay/advance`), then drains
the inference worker and reads `/cells` and the mission summary.
"""

import hashlib

import pytest
from conftest import FIXTURE_DIR, drain

from pogoscout_api.replay.generate import expected_after, summarize
from pogoscout_api.replay.large import LARGE_BUILDERS, walk
from pogoscout_api.replay.scenario import ImageEvent, load_expected, load_scenario

CELL_KEYS = ("x", "y", "hop_ids", "metal", "voc", "quality", "flags")


def replay(client, scenario_id: str, mission_id: str, events: int) -> dict:
    body = {"scenario_id": scenario_id, "mission_id": mission_id}
    assert client.post("/api/v1/replays", json=body).status_code == 201
    state = client.post(
        f"/api/v1/missions/{mission_id}/replay/advance", json={"events": events}
    ).json()
    assert state["cursor"] == min(events, state["total"])
    drain(client)
    return client.get(f"/api/v1/missions/{mission_id}/cells").json()


def comparable(cells: list[dict]) -> list[dict]:
    return [
        {
            **{k: c[k] for k in CELL_KEYS},
            "material": {k: c["material"][k] for k in ("status", "label", "confidence")},
        }
        for c in cells
    ]


def summary_of(cells: dict) -> dict:
    """The API's /cells document reduced to the committed golden summary shape."""
    as_expected = {
        "scenario_id": None,
        "path": cells["path"],
        "current": cells["current"],
        "pending_hop_ids": cells["pending_hop_ids"],
        "cells": comparable(cells["cells"]),
    }
    return summarize(as_expected)


@pytest.mark.parametrize(
    ("name", "events"), [("district_sweep_v1", 900), ("canal_corridor_v1", 400)]
)
def test_large_fixture_prefix_golden(client, name, events) -> None:
    scenario = load_scenario(FIXTURE_DIR / name)
    expected = expected_after(scenario, events)
    cells = replay(client, name, "prefix", events)
    assert cells["current"] == expected["current"]
    assert cells["path"] == expected["path"]
    assert cells["pending_hop_ids"] == expected["pending_hop_ids"]
    want = [{k: c[k] for k in (*CELL_KEYS, "material")} for c in expected["cells"]]
    assert comparable(cells["cells"]) == want
    summary = client.get("/api/v1/missions/prefix").json()
    assert summary["stats"]["cells"] == len(want) and summary["status"] == "live"


@pytest.mark.parametrize("name", list(LARGE_BUILDERS))
def test_committed_summary_matches_scenario(name) -> None:
    """The golden summary is the builder's intent applied to every event of the scenario."""
    scenario = load_scenario(FIXTURE_DIR / name)
    golden = load_expected(FIXTURE_DIR / name)
    derived = summarize(expected_after(scenario))
    assert derived == golden
    assert golden["format"] == "summary"


def test_district_layout() -> None:
    scenario = load_scenario(FIXTURE_DIR / "district_sweep_v1")
    golden = load_expected(FIXTURE_DIR / "district_sweep_v1")
    hops = {e.hop_id: e for e in scenario.events if e.type == "hop"}
    assert 1900 <= len(hops) <= 2100
    duration_h = max(e.at_ms for e in scenario.events) / 3_600_000
    assert 2.0 <= duration_h <= 2.4
    commands = "".join(hops[h].payload.movement.command for h in sorted(hops))
    positions = walk(commands)
    xs, ys = {x for x, _ in positions}, {y for _, y in positions}
    assert (min(xs), max(xs), min(ys), max(ys)) == (0, 47, 0, 39)
    assert positions[:3] == [(1, 0), (2, 0), (3, 0)]  # rows along x from the origin
    assert golden["revisited_cells"] >= 20
    assert 22 <= len(golden["metal_cells"]) <= 28 and 10 <= len(golden["voc_cells"]) <= 14
    materials = golden["materials"]
    for label in ("asphalt", "tiles_pavers", "concrete", "gravel", "grass_vegetation", "water"):
        assert materials[label] > 20
    assert materials["sand"] > 0 and materials["leaf_litter"] > 0 and materials["mud"] > 0
    images = [e for e in scenario.events if isinstance(e, ImageEvent)]
    assert all(e.generate and e.file is None for e in images)
    assert len(images) < len(hops)  # a few hops never get a screenshot
    confidences = [e.mock_confidence for e in images]
    assert min(confidences) >= 0.58 and max(confidences) <= 0.97
    kinds = [e.type for e in scenario.events]
    assert len(kinds) - len(images) == len(hops) + 1  # exactly one duplicate resend
    order = [e.hop_id for e in scenario.events if e.type == "hop"]
    pairs = list(zip(order, order[1:], strict=False))
    assert sum(b < a for a, b in pairs) == 1  # one out-of-order pair
    assert sum(b == a for a, b in pairs) == 1  # one identical resend


def test_canal_layout() -> None:
    golden = load_expected(FIXTURE_DIR / "canal_corridor_v1")
    assert 1150 <= golden["path_length"] <= 1250
    assert golden["current"] == {"x": 0, "y": 149}
    assert len(golden["metal_cells"]) == 10 and len(golden["voc_cells"]) == 6
    for label in ("water", "concrete", "tiles_pavers", "grass_vegetation", "leaf_litter"):
        assert golden["materials"][label] > 50
    assert golden["materials"]["mud"] > 0 and golden["materials"]["gravel"] > 0


def test_generated_screenshots_are_deterministic(client) -> None:
    for mission_id in ("g1", "g2"):
        body = {"scenario_id": "canal_corridor_v1", "mission_id": mission_id}
        client.post("/api/v1/replays", json=body)
        client.post(f"/api/v1/missions/{mission_id}/replay/advance", json={"events": 4})
    first = client.get("/api/v1/missions/g1/hops/2/image")
    second = client.get("/api/v1/missions/g2/hops/2/image")
    assert first.status_code == 200 and first.headers["content-type"] == "image/png"
    assert first.content.startswith(b"\x89PNG")
    assert hashlib.sha256(first.content).digest() == hashlib.sha256(second.content).digest()
    other_hop = client.get("/api/v1/missions/g1/hops/1/image").content
    assert other_hop != first.content


@pytest.mark.slow
@pytest.mark.parametrize("name", list(LARGE_BUILDERS))
def test_large_fixture_full_golden(client, name) -> None:
    cells = replay(client, name, "full", 100_000)
    golden = load_expected(FIXTURE_DIR / name)
    got = summary_of(cells)
    got["scenario_id"] = name
    assert got == golden
    summary = client.get("/api/v1/missions/full").json()
    assert summary["status"] == "complete"
    assert summary["stats"]["materials"] == golden["materials"]
    assert summary["stats"]["metal"] == len(golden["metal_cells"])
