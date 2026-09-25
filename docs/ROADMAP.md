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

## Milestones

- [x] **M0 Scaffold**: repo, Vite + FastAPI skeletons, health endpoint, tests green.
- [ ] **M1 Core ingest → map** (A, B, C, G, H-basic): mission CRUD, hop PUT, projection, `/cells`, SVG grid with path and metal/VOC states.
- [ ] **M2 Replay & live** (E, F-clean): fixture loader, step replay, WebSocket invalidation, reconnect.
- [ ] **M3 Evidence & classifier** (D, I): image upload, outbox worker, mock classifier, inspector with screenshot + classification states.
- [ ] **M4 Full dashboard** (H, I, E, F): all layers + legends, timeline, timed/fault replay, remaining fixtures, export.
- [ ] **M5 2.5D & polish** (J, K, L): 2.5D view, empty/error states, accessibility, Playwright, runbook.
- [ ] **M6 Real ML integration**: `HttpClassifierClient` against the teammate's service, contract tests.

## Open decisions

1. 2.5D headline metric (default: uncertainty, with visit count selectable).
2. Material taxonomy: confirm the 7 labels with the ML teammate.
3. Screenshot workflow in mock mode (default: fixture-attached and manual upload).
4. Map bounds (default: unbounded grid, auto-fit).
5. Visual direction (default: dark operational field UI).
