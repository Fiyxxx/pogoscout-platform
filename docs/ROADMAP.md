# PogoScout Platform Roadmap

The building blocks, in dependency order. Each milestone ends with a demoable slice and passing tests.

## Building blocks

| # | Block | Owns |
|---|---|---|
| A | **Contracts & domain** | Hop payload schema, sensor value/status semantics, movement convention, material taxonomy, ML classify contract. Pure types + rules, no I/O. |
| B | **Backend core** | Missions, idempotent hop ingestion (`mission_id + hop_id`), conflict detection, SQLite persistence, append-only records. |
| C | **Projection engine** | Hops → nominal coordinates → cells. Out-of-order/pending handling, revisits, per-cell derived layer states (material, metal, VOC, data quality). Backend is authoritative. |
| D | **Evidence & inference pipeline** | Screenshot upload + filesystem store + SHA-256, persisted inference-job outbox, background worker, classifier adapters (mock/http/disabled), append-only classification results, retries. |
| E | **Live & replay** | WebSocket hub (invalidate → REST refetch), replay engine (manual, step, timed, fault-injection), fixture loader that goes through the public ingestion path. |
| F | **Mock data** | Deterministic fixtures (`clean_baseline`, `anomaly_clusters`, `wet_obstruction`, `failures`), synthetic images stamped `SYNTHETIC MOCK EVIDENCE`, expected projections for tests. |
| G | **Frontend shell** | App layout, mission picker/creation, connection state, mock-source banner, TanStack Query data layer, WS reconnect. |
| H | **2D map + layers** | SVG grid, auto-fit, path + current position, five layers (combined, material, metal, activity cue, data quality), legends, keyboard selection. |
| I | **Inspector & timeline** | Cell visit history, screenshot, sensor facts, classification history/confidence/model version, raw JSON; event timeline + replay controls. |
| J | **2.5D view** | Lazy-loaded R3F extrusion of the same cell projection by an analytical metric, always labelled "not physical elevation". |
| K | **Export & ops** | JSON/CSV export, run scripts, demo runbook, optional Docker Compose. |
| L | **Quality** | pytest (domain, API, projection, pipeline), Vitest/RTL (components), fixture golden tests, Playwright E2E demo path. |

## Checklist

### M0 Scaffold
- [x] Repo, private GitHub remote, README, `.env.example`, `.gitignore`
- [x] FastAPI skeleton (uv, ruff, pytest) + `/api/v1/health`
- [x] Vite/React/TS skeleton (TanStack Query, Vitest) + dashboard layout shell

### M1 Core ingest → map
- [x] Contracts: hop schema, sensor `{value, status}`, movement `F/B/L/R` + `dx/dy`, taxonomy JSON
- [x] Domain: validation rules (0 vs null vs error), one-Manhattan-step rule
- [x] Persistence: `missions`, `hops` tables (append-only, canonical-content hash)
- [x] `POST/GET /missions`, `PUT/GET /missions/{id}/hops/{hop_id}` with idempotent duplicate + 409 conflict
- [x] Projection: coordinates from hop chain, pending on gaps, revisits keep all observations
- [x] `GET /missions/{id}/cells` with per-cell metal/VOC/visit state
- [x] Fixture generator script (seeded) + `clean_baseline_v1` (scenario, images, expected projection)
- [x] Fixture loader posts through the public API; golden test vs `expected_projection.json`
- [x] Frontend: mission picker/create, SVG grid (auto-fit), path, current position, metal/VOC badges, click-to-select cell
- [x] Tests: domain, API, projection, grid component

### M2 Replay & live
- [ ] Replay engine: load scenario, cursor, `step` / `reset`
- [ ] WebSocket hub: per-mission `changed` events; frontend invalidates queries
- [ ] Reconnect with backoff + refetch; connection indicator in top bar
- [ ] Mock-source banner when mission source is `mock`
- [ ] Tests: replay determinism, WS notify

### M3 Evidence & classifier
- [ ] `POST /missions/{id}/hops/{hop_id}/image`: store file, SHA-256, idempotent/conflict
- [ ] `inference_jobs` outbox table + background worker with retries/backoff
- [ ] Classifier protocol + Mock / Http / Disabled adapters (config-selected)
- [ ] Append-only `classifications` table; response validation (ids, hash, label, confidence, taxonomy)
- [ ] Classification states: none, pending, retrying, succeeded, failed, unavailable
- [ ] Inspector: visit list, screenshot, sensor facts, classification history, raw JSON
- [ ] Tests: missing/delayed/duplicate/conflicting image, ML failure + retry

### M4 Full dashboard
- [ ] Layer selector: combined, material, metal, activity cue, data quality + legends
- [ ] Data-quality derivation (complete/pending/low-confidence/missing/failed/conflicting)
- [ ] Event timeline (hops, images, results, warnings)
- [ ] Timed playback, pause, speed, fault-injection profiles
- [ ] Fixtures: `anomaly_clusters_v1`, `wet_obstruction_v1`, `failures_v1`
- [ ] Export: mission JSON + cells/hops CSV
- [ ] Manual hop entry form

### M5 2.5D & polish
- [ ] Lazy-loaded R3F view from `/cells`; metric selector (uncertainty, visit count)
- [ ] "Analytical metric, not physical elevation" label always visible
- [ ] Empty/loading/error states, keyboard navigation, colour-blind-safe palette
- [ ] Playwright E2E: create mission → replay → inspect cell → export
- [ ] One-command start script + demo runbook (+ optional Docker Compose)

### M6 Real ML integration
- [ ] Publish `contracts/ml-classify.v1.openapi.yaml`, agree with ML teammate
- [ ] `HttpClassifierClient` + contract tests against example responses
- [ ] End-to-end run against the teammate's service

## Open decisions

1. 2.5D headline metric (default: uncertainty, with visit count selectable).
2. Material taxonomy: confirm the 7 labels with the ML teammate.
3. Screenshot workflow in mock mode (default: fixture-attached and manual upload).
4. Map bounds (default: unbounded grid, auto-fit).
5. Visual direction (default: dark operational field UI).
