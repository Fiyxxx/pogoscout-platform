"""Developer CLI: `uv run pogoscout-dev {fixtures,contracts,load,seed,reset}`."""

import argparse
import json
import shutil
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
from sqlalchemy.engine import make_url

from pogoscout_api.config import settings
from pogoscout_api.domain.hops import HopPayload
from pogoscout_api.domain.materials import MATERIAL_LABELS, TAXONOMY_VERSION
from pogoscout_api.replay.builders import BUILDERS
from pogoscout_api.replay.scenario import HopEvent, load_scenario

CONTRACTS_DIR = Path(__file__).resolve().parents[4] / "contracts"


def generate_fixtures(names: list[str]) -> None:
    for name in names or list(BUILDERS):
        BUILDERS[name](settings.fixture_dir / name)
        print(f"generated {settings.fixture_dir / name}")


def export_contracts() -> None:
    CONTRACTS_DIR.mkdir(exist_ok=True)
    schema = HopPayload.model_json_schema()
    (CONTRACTS_DIR / "hop.v1.schema.json").write_text(json.dumps(schema, indent=2) + "\n")
    taxonomy = {"taxonomy_version": TAXONOMY_VERSION, "labels": list(MATERIAL_LABELS)}
    (CONTRACTS_DIR / f"taxonomy.{TAXONOMY_VERSION}.json").write_text(
        json.dumps(taxonomy, indent=2) + "\n"
    )
    print(f"wrote contracts to {CONTRACTS_DIR}")


def load_fixture(name: str, api: str, mission_id: str | None) -> None:
    """Replay every hop of a scenario through the public HTTP API, in order."""
    scenario = load_scenario(settings.fixture_dir / name)
    with httpx.Client(base_url=api, timeout=10) as client:
        body = {"name": scenario.mission.name, "source": scenario.mission.source}
        if mission_id:
            body["mission_id"] = mission_id
        mission = client.post("/missions", json=body).raise_for_status().json()
        hops = [e for e in scenario.events if isinstance(e, HopEvent)]
        for event in hops:
            response = client.put(
                f"/missions/{mission['id']}/hops/{event.hop_id}",
                json=event.payload.model_dump(mode="json"),
            )
            if response.status_code != 409:  # conflicting resends are expected in fault fixtures
                response.raise_for_status()
    print(f"loaded {len(hops)} hops into mission {mission['id']}")


@dataclass(frozen=True)
class DemoMission:
    scenario_id: str
    mission_id: str
    name: str
    status: str | None = None  # patched after the replay is fully applied
    note: str | None = None
    live_fraction: float | None = None  # apply this share of events, then keep playing live


# Created oldest first so the mission list (newest first) reads top down in the UI.
DEMO_SET: list[DemoMission] = [
    DemoMission("park_connector_v1", "PS-0923-01", "Park Connector Sweep"),
    DemoMission(
        "failures_v1", "PS-0924-02", "Drainage Culvert", "aborted", "Link lost after hop 9"
    ),
    DemoMission("canal_corridor_v1", "PS-0924-04", "Canal Corridor Survey"),
    DemoMission("jungle_patrol_v1", "PS-0924-05", "Central Catchment Patrol"),
    DemoMission("district_sweep_v1", "PS-0925-01", "Sector 7 Sweep", live_fraction=0.85),
]
ADVANCE_CHUNK = 500


def _advance(client: httpx.Client, mission_id: str, target: int) -> dict:
    """Apply events up to `target` in chunks (each chunk is one request)."""
    state = client.get(f"/missions/{mission_id}/replay").raise_for_status().json()
    while state["cursor"] < target:
        count = min(ADVANCE_CHUNK, target - state["cursor"])
        response = client.post(f"/missions/{mission_id}/replay/advance", json={"events": count})
        state = response.raise_for_status().json()
    return state


def seed_demo(api: str) -> None:
    """Create the demo mission set against a running API. Skips missions that already exist."""
    started = time.perf_counter()
    with httpx.Client(base_url=api, timeout=300) as client:
        for demo in DEMO_SET:
            mission_id = demo.mission_id
            if client.get(f"/missions/{mission_id}").status_code == 200:
                _resume_live(client, demo)
                continue
            t0 = time.perf_counter()
            body = {"scenario_id": demo.scenario_id, "mission_id": mission_id, "name": demo.name}
            client.post("/replays", json=body).raise_for_status()
            total = client.get(f"/missions/{mission_id}/replay").raise_for_status().json()["total"]
            fraction = demo.live_fraction or 1.0
            state = _advance(client, mission_id, round(total * fraction))
            if demo.live_fraction is not None:
                client.post(f"/missions/{mission_id}/replay/play", json={"speed": 1})
            elif demo.status is not None:
                patch = {"status": demo.status, "status_note": demo.note}
                client.patch(f"/missions/{mission_id}", json=patch).raise_for_status()
            summary = client.get(f"/missions/{mission_id}").raise_for_status().json()
            print(
                f"seeded {mission_id} ({demo.name}) from {demo.scenario_id}: "
                f"{state['cursor']}/{total} events, {summary['stats']['hops']} hops, "
                f"status {summary['status']}"
                + (", playing at speed 1" if demo.live_fraction is not None else "")
                + f" [{time.perf_counter() - t0:.1f}s]"
            )
    print(
        f"seed done in {time.perf_counter() - started:.1f}s (classifications continue in the API)"
    )


def _resume_live(client: httpx.Client, demo: DemoMission) -> None:
    """An existing live demo mission whose play stopped (e.g. API restart) is resumed."""
    mission_id = demo.mission_id
    if demo.live_fraction is None:
        print(f"skip {mission_id}: already exists")
        return
    summary = client.get(f"/missions/{mission_id}").raise_for_status().json()
    state = client.get(f"/missions/{mission_id}/replay").raise_for_status().json()
    if summary["status"] == "live" and not state["finished"] and not state["playing"]:
        client.post(f"/missions/{mission_id}/replay/play", json={"speed": 1}).raise_for_status()
        print(f"skip {mission_id}: already exists, resumed live play at {state['cursor']}")
    else:
        print(f"skip {mission_id}: already exists")


def reset_dev_data(confirmed: bool) -> int:
    """Delete the SQLite database (with WAL/SHM files) and the image directory from settings."""
    url = make_url(settings.database_url)
    db_path = Path(url.database) if url.database and url.get_backend_name() == "sqlite" else None
    targets = [
        *(Path(f"{db_path}{suffix}") for suffix in ("", "-wal", "-shm") if db_path),
        settings.image_dir,
    ]
    if not confirmed:
        print("refusing to reset without --yes. This would delete:")
        for target in targets:
            print(f"  {target.resolve()}")
        return 2
    if db_path is None:
        print(f"not a SQLite file database: {settings.database_url}")
        return 2
    for target in targets:
        if target.is_dir():
            shutil.rmtree(target)
            print(f"deleted {target.resolve()}/")
        elif target.exists():
            target.unlink()
            print(f"deleted {target.resolve()}")
    # Keep the tracked placeholder so the directory stays in the repository.
    settings.image_dir.mkdir(parents=True, exist_ok=True)
    (settings.image_dir / ".gitkeep").touch()
    print("reset done. Restart the API before seeding (it keeps the old database open).")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="pogoscout-dev")
    sub = parser.add_subparsers(dest="command", required=True)
    fixtures = sub.add_parser("fixtures", help="regenerate deterministic fixtures")
    fixtures.add_argument("names", nargs="*")
    sub.add_parser("contracts", help="export JSON contracts")
    load = sub.add_parser("load", help="replay a fixture into a running API")
    load.add_argument("name")
    load.add_argument("--api", default="http://127.0.0.1:8000/api/v1")
    load.add_argument("--mission-id")
    seed = sub.add_parser("seed", help="create the demo mission set in a running API")
    seed.add_argument("--api", default="http://127.0.0.1:8000/api/v1")
    tiles = sub.add_parser("tiles", help="pre-fetch theatre map tiles through a running API")
    tiles.add_argument("--api", default="http://127.0.0.1:8000/api/v1")
    reset = sub.add_parser("reset", help="delete the dev database and image directory")
    reset.add_argument("--yes", action="store_true", help="confirm deletion")
    args = parser.parse_args()

    if args.command == "fixtures":
        generate_fixtures(args.names)
    elif args.command == "contracts":
        export_contracts()
    elif args.command == "seed":
        seed_demo(args.api)
    elif args.command == "tiles":
        from pogoscout_api.tiles.warm import warm_tiles

        warm_tiles(args.api)
    elif args.command == "reset":
        sys.exit(reset_dev_data(args.yes))
    else:
        load_fixture(args.name, args.api, args.mission_id)
