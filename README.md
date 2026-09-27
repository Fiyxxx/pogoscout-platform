# PogoScout Platform

Offline-first operator dashboard for PogoScout, a hopping reconnaissance scout. It maps one observation per logical hop onto a layered square grid: nominal path, graded metal and VOC readings, screenshot evidence, and material classifications from a separate ML service. On top of that it runs a Bayesian risk assessment that turns the readings into hazard areas with their evidence.

It has four views:

- **Theatre**: a 3D terrain map of Singapore with every GPS-anchored mission, risk, metal and VOC heat maps, and hazard hotspots with a hover preview and a detail card.
- **Missions**: the mission list with previews.
- **Mission**: the 3D mission map with layers (combined, risk, material, captures, metal, VOC, data quality), the risk matrix and hazard areas, a cell and area inspector, playback and exports.
- **3D**: a presentation model of the scout with its airframe and swappable sensor payload.

It covers the platform only. Hardware, sensor drivers and model training are out of scope, and the material model lives in `pogoscout-material-model`. See [docs/HANDOFF.md](docs/HANDOFF.md) for product scope and semantics, [docs/API.md](docs/API.md) for the API contract (including the risk model), and [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, React Router, Three.js (mission map, 3D model), MapLibre GL (theatre), local fonts |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, SQLite |
| Evidence | Filesystem images + SHA-256 metadata in SQLite |
| Live | WebSocket invalidations + REST snapshots |
| ML | Classifier adapter: `mock` / `http` / `disabled` |
| Risk | Bayesian evidence fusion (rules `risk-2`), in the API and, for playback, in the web client |
| Map tiles | Imagery, labels and terrain proxied and cached on disk by the API |
| Tests | pytest, Vitest + Testing Library, Playwright (later) |

## Run

```bash
# terminal 1
cd apps/api && uv sync && uv run pogoscout-api      # http://localhost:8000/docs

# terminal 2
cd apps/web && npm install && npm run dev           # http://localhost:5173

# terminal 3: seed the demo missions (Sector 7 Sweep live, Central Catchment Patrol,
# Canal Corridor Survey, Drainage Culvert, Park Connector Sweep). Idempotent; resumes live
# play after an API restart.
cd apps/api && uv run pogoscout-dev seed

# optional: pre-fetch theatre map tiles into data/tiles so the map works offline
cd apps/api && uv run pogoscout-dev tiles

# start over: stop the API, delete the dev DB + images, restart the API, seed again
cd apps/api && uv run pogoscout-dev reset --yes
```

The live demo mission replays at real speed and eventually finishes its scenario; reset and seed again to bring it back to live.

## Mock data

Fixtures live in `fixtures/<scenario>/` (`scenario.json`, `expected_projection.json`, `images/`) and are generated deterministically from a seed:

```bash
cd apps/api
uv run pogoscout-dev fixtures        # regenerate all fixtures
uv run pogoscout-dev contracts       # export contracts/hop.v2.schema.json, the taxonomy and
                                     # contracts/risk.v2.cases.json
```

Sensor readings follow hop schema 2.0: signal strength from 0 to 1 against the calibrated background (not a probability). Fixtures emit background noise, occasional low-level clutter and detection-strength hits.

Small fixtures: `clean_baseline_v1`, `park_connector_v1`, `failures_v1`. Large fixtures do not commit screenshots: their image events carry `"generate": true` and the replay runner renders the stamped synthetic image in memory, deterministically per scenario and hop. Their `expected_projection.json` is a summary (cell count, position, material and flag counts, anomaly cells).

| Large fixture | Area | Hops |
|---|---|---|
| `district_sweep_v1` | 48 x 40 district | about 2000 |
| `canal_corridor_v1` | 8 x 150 canal corridor, weak metal at culvert outlets | about 1200 |
| `jungle_patrol_v1` | 44 x 32 jungle, three metal clusters | about 1430 |

Fixtures are only ever ingested through the public API. `tests/test_fixtures.py` replays each small one and compares the result with `expected_projection.json`; `tests/test_large_fixtures.py` checks the large ones on a prefix, and in full with `uv run pytest --run-slow`.

## Live ground demo

A sandbox with real ground-classification data from [pogodrone_ground_classification](https://github.com/minweed/pogodrone_ground_classification), which classifies the Pi Camera stream with CLIP. The drone doesn't hop yet, so the platform plays it: every 2 s it moves one cell on a lawnmower path, fetches the ground service's latest confident label and the crop behind it, and records both as that hop. Each run is a session you create on the **Live demo** tab, and the tab shows the selected one as it happens: the current crop and label, a map of the materials seen so far, and the last 10 hops.

```bash
# terminal 1: the ground service, on the same laptop (it listens on 127.0.0.1:8765)
cd ../pogodrone_ground_classification && ./run_pi.sh

# terminal 2: the platform
cd apps/api && uv run pogoscout-api
```

Open http://localhost:5173/demo, click **New session** and move the camera over two or three surfaces. Nothing polls the ground service until a session exists. Each session is a new mission with its own clock, and several can run at once; **Stop session** ends one and marks its mission complete, **Rename** changes its name, and **Delete** removes it with everything it recorded, after asking. What to expect:

- Only the ground data is real. There is no VOC or metal sensor, so both are recorded as missing and there is no risk assessment. Demo missions also appear in the Missions list, where every cell's quality is `missing`.
- Positions come from the demo's path, not from where the camera is.
- Sessions outlive a platform restart in the list, but stop polling: they show as *Not polling* until you stop them. Create a new session to carry on.
- A reading the ground service hasn't replaced since the last hop is marked stale. If the service is down or has no confident label yet, the hop still arrives, as `unavailable`, and readings resume once it's back.
- The ground service adds `wood` to the 10 platform labels. Only the demo page names it; elsewhere a wood cell shows as unknown ground.
- Until the ground service's confidence is calibrated (`calibrate_confidence.py` there), most readings score below 0.80 and show as low confidence.

Settings are in `.env.example` (`POGOSCOUT_GROUND_*`). The endpoints are in [docs/API.md](docs/API.md#live-ground-demo), and the plan in [docs/GROUND_CLASSIFICATION_PLAN.md](docs/GROUND_CLASSIFICATION_PLAN.md).

## Test

```bash
cd apps/api && uv run pytest && uv run ruff check .
cd apps/web && npm test -- --run && npm run build
```

Both suites run the shared risk cases in `contracts/risk.v2.cases.json`, so the API and the web client cannot disagree on a rating.

## Layout

```text
apps/api/src/pogoscout_api/
  api/          HTTP + WebSocket routes (missions, hops, images, cells, risk, world, replay,
                export, tiles)
  domain/       hop, cell, sensor, classification, geo and risk rules (pure)
  application/  ingestion, projection, read model, inference-job services
  persistence/  SQLAlchemy models and repositories
  evidence/     image store (filesystem + hash)
  adapters/classifier/  mock / http / disabled clients
  replay/       fixture generation, demo sites and playback engine
  live/         WebSocket connection hub
  export/       report and archive exports
  tiles/        map tile cache and pre-fetch
apps/web/src/
  api/          typed client and live WebSocket
  pages/        Theatre, Missions, Mission, Cell evidence, 3D
  features/     dashboard (layer rail, risk panel, inspector, timeline), map (3D mission map),
                world (theatre map), missions, model (3D scout)
  lib/          cells, playback history, risk rules, geo, formatting
contracts/      published schemas and test cases shared with other repos
fixtures/       deterministic mock scenarios
data/           local SQLite DB, images and tile cache (gitignored)
```
