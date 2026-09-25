# PogoScout Platform

Offline-first operator dashboard for PogoScout, a hopping reconnaissance scout. It maps one observation per logical hop onto a layered square grid: nominal path, metal-anomaly and VOC-cue readings, screenshot evidence, and material classifications from a separate ML service.

It covers the platform only. Hardware, sensor drivers and model training are out of scope, and the material model lives in `pogoscout-material-model`. See [docs/HANDOFF.md](docs/HANDOFF.md) for product scope and semantics, and [docs/ROADMAP.md](docs/ROADMAP.md) for the build plan.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 19, TypeScript, Vite, TanStack Query, SVG grid, React Three Fiber (lazy, 2.5D) |
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

# terminal 3: replay a fixture through the public API, then pick "demo-clean" in the UI
cd apps/api && uv run pogoscout-dev load clean_baseline_v1 --mission-id demo-clean
```

## Mock data

Fixtures live in `fixtures/<scenario>/` (`scenario.json`, `expected_projection.json`, `images/`) and are generated deterministically from a seed:

```bash
cd apps/api
uv run pogoscout-dev fixtures        # regenerate all fixtures
uv run pogoscout-dev contracts       # export contracts/hop.v1.schema.json + taxonomy
```

Fixtures are only ever ingested through the public API. `tests/test_fixtures.py` replays each one and compares the result with `expected_projection.json`.

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
