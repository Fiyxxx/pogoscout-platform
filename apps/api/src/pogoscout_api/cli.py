"""Developer CLI: `uv run pogoscout-dev {fixtures,contracts,load}`."""

import argparse
import json
from pathlib import Path

import httpx

from pogoscout_api.config import settings
from pogoscout_api.domain.hops import HopPayload
from pogoscout_api.domain.materials import MATERIAL_LABELS, TAXONOMY_VERSION
from pogoscout_api.replay.generate import BUILDERS
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
            client.put(
                f"/missions/{mission['id']}/hops/{event.hop_id}",
                json=event.payload.model_dump(mode="json"),
            ).raise_for_status()
    print(f"loaded {len(hops)} hops into mission {mission['id']}")


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
    args = parser.parse_args()

    if args.command == "fixtures":
        generate_fixtures(args.names)
    elif args.command == "contracts":
        export_contracts()
    else:
        load_fixture(args.name, args.api, args.mission_id)
