# PogoScout Platform

Offline-first operator dashboard for PogoScout, a hopping reconnaissance scout. It maps one observation per logical hop onto a layered square grid: nominal path, metal-anomaly and VOC-cue readings, screenshot evidence, and material classifications from a separate ML service.

It covers the platform only. Hardware, sensor drivers and model training are out of scope, and the material model lives in `pogoscout-material-model`. See [docs/HANDOFF.md](docs/HANDOFF.md) for product scope and semantics, [docs/API.md](docs/API.md) for the API contract, and [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, React Router, Three.js map (lazy-loaded), local fonts |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, SQLite |
| Evidence | Filesystem images + SHA-256 metadata in SQLite |
| Live | WebSocket invalidations + REST snapshots |
| ML | Classifier adapter: `mock` / `http` / `disabled` |
| Tests | pytest, Vitest + Testing Library, Playwright (later) |

## Run

```bash
# terminal 1
cd apps/api && uv sync && uv run pogoscout-api      # http://localhost:8000/docs

# terminal 2
cd apps/web && npm install && npm run dev           # http://localhost:5173

# terminal 3: seed the demo missions (Sector 7 Sweep live, Canal Corridor Survey,
# Drainage Culvert, Park Connector Sweep). Idempotent; resumes live play after an API restart.
cd apps/api && uv run pogoscout-dev seed

# start over: stop the API, delete the dev DB + images, restart the API, seed again
cd apps/api && uv run pogoscout-dev reset --yes
```

## Mock data

Fixtures live in `fixtures/<scenario>/` (`scenario.json`, `expected_projection.json`, `images/`) and are generated deterministically from a seed:

```bash
cd apps/api
uv run pogoscout-dev fixtures        # regenerate all fixtures
uv run pogoscout-dev contracts       # export contracts/hop.v1.schema.json + taxonomy
```

Large fixtures (`district_sweep_v1`, about 2000 hops over a 48 x 40 district; `canal_corridor_v1`, about 1200 hops along an 8 x 150 canal corridor) do not commit screenshots: their image events carry `"generate": true` and the replay runner renders the stamped synthetic image in memory, deterministically per scenario and hop. Their `expected_projection.json` is a summary (cell count, position, material and flag counts, anomaly cells).

Fixtures are only ever ingested through the public API. `tests/test_fixtures.py` replays each small one and compares the result with `expected_projection.json`; `tests/test_large_fixtures.py` checks the large ones on a prefix, and in full with `uv run pytest --run-slow` (about 30 s).

## Test

```bash
cd apps/api && uv run pytest && uv run ruff check .
cd apps/web && npm test -- --run && npm run build
```

## Layout

```text
apps/api/src/pogoscout_api/
  api/          HTTP + WebSocket routes
  domain/       hop, cell, sensor, classification types and rules (pure)
  application/  ingestion, projection, inference-job services
  persistence/  SQLAlchemy models and repositories
  evidence/     image store (filesystem + hash)
  adapters/classifier/  mock / http / disabled clients
  replay/       fixture loading and playback engine
  live/         WebSocket connection hub
apps/web/src/
  api/ features/{mission,map2d,map25d,layers,inspector,replay,timeline} components/
contracts/      published schemas shared with other repos
fixtures/       deterministic mock scenarios
data/           local SQLite DB + images (gitignored)
```
