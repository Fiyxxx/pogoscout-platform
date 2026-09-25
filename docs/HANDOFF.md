# PogoScout Platform - Agent Handoff

Last updated: 25 September 2026  
Workspace: `/Users/hans/Documents/ChatGPT/hackathon`  
Audience: the next software agent working with the user

## Read this first

The user is building PogoScout for the Singapore Defence Tech Hackathon. This handoff is about the **software platform only**.

The user is **not asking this repository to implement hardware, sensor drivers, flight control, hopping mechanics, analogue-video electronics, or ML model training**. Hardware data is not available yet. The platform must therefore be designed and developed using deterministic mock data until the real producer contracts are ready.

The material-classification ML model belongs in a **separate repository**. The platform repository must not import or embed the model code. Later, when a screenshot is attached to a hop, the platform should call a versioned ML-service interface and attach the returned classification to that same hop. This integration boundary matters, but finishing the platform experience with a mock classifier is the immediate priority.

Before making a consequential product or architecture assumption, ask the user focused clarifying questions. Do not ask questions already answered in this handoff or the repository documents. If the user asks you to continue building, inspect the existing code and preserve all current work; the worktree contains uncommitted files.

## User's current intent

The user wants to hand this project to another agent and continue the conversation there. The next agent should understand:

- What the project is trying to demonstrate.
- What software is in and out of scope.
- What data the platform consumes.
- How mock data should work before hardware integration.
- How the frontend, backend, database, map, replay, and 2.5D view fit together.
- How the platform repository remains separate from the ML repository.
- What has already been implemented.
- Which decisions still need user confirmation.

The likely next goal is to continue building the complete platform, but the next agent should follow the user's new instruction rather than assuming a specific implementation step.

## Project concept

PogoScout is a hopping reconnaissance concept. For the software proof of concept, every completed hop represents movement by exactly one logical square-grid cell. One observation is associated with each hop.

Current logical inputs per hop are:

```text
movement: F | B | L | R
metal: 0 | 1
VOC/smell anomaly: 0 | 1
screenshot: one image associated with the hop
material classification: label/confidence returned by a separate ML service
```

Safe semantics:

| Input | Platform meaning | Do not claim |
|---|---|---|
| `metal = 1` | Metal anomaly detected | Mine detected |
| `metal = 0` | No metal anomaly reported | Proven absence of metal |
| `voc = 1` | VOC anomaly/activity cue detected | Human or enemy detected |
| `voc = 0` | No VOC anomaly reported | Proven absence of people |
| Material label | Model classification with confidence and version | Ground truth |
| Grid coordinate | Nominal software position | Measured absolute position |
| 2.5D height | Analytical metric | Physical terrain elevation |

The platform should expose provenance, missing data, confidence, and failure states rather than implying certainty.

## Scope

### In scope for the platform repository

- A polished operator-facing web application.
- A backend API with typed validation.
- Mission creation and persistence.
- Mock-hop creation and deterministic replay.
- Nominal square-grid coordinate projection.
- Layered 2D map.
- Secondary 2.5D analytical view.
- Metal-anomaly, VOC/activity-cue, material, and data-quality layers.
- Screenshot evidence storage and inspection.
- Mock material-classifier adapter.
- Later HTTP integration with the separate ML repository.
- Late, missing, duplicated, conflicting, or out-of-order data handling.
- WebSocket-driven live updates with REST snapshots as the source of truth.
- Mission history, cell visit history, JSON/CSV export, and demo fixtures.
- Offline-first local operation.
- Automated backend and frontend tests.

### Explicitly out of scope

- Hardware implementation.
- Raspberry Pi sensor drivers.
- LDC1612 or VOC thresholding logic.
- Flight control, balance, hopping, motor control, or landing detection.
- 5.8 GHz receiver/capture electronics.
- Training or implementing the material ML model in this repository.
- True physical 3D terrain.
- SLAM, GNSS, measured global position, or autonomous navigation.
- Mine identification or human identification.
- Cloud infrastructure, distributed queues, Kubernetes, or multi-tenancy.
- MQTT or serial integration until a real producer contract requires it.

## Product outcome

The main product is a layered mission dashboard that answers:

1. Where has the scout nominally moved on the logical grid?
2. What evidence belongs to every hop and cell?
3. Which cells contain metal anomalies or VOC/activity cues?
4. What material label did the separate model return, with what confidence and model version?
5. Which evidence is missing, failed, pending, stale, low-confidence, or contradictory?
6. Can the exact mission be replayed deterministically for development and judging?

Primary product principle:

```text
Raw hop facts, image evidence, and classification results remain separate.
Map cells are explainable projections of those records.
```

## Platform layout

The expected desktop experience is approximately:

```text
+--------------------------------------------------------------------------------+
| PogoScout | mission | LIVE/REPLAY | connection | hop count | export           |
+------------------+-------------------------------------------+-----------------+
| Layer controls   |                                           | Cell inspector  |
|                  |             2D / 2.5D grid                 |                 |
| Combined         |                                           | Visit history   |
| Material         |      path, cell colours, anomaly badges   | Screenshot      |
| Metal anomaly    |                                           | Metal/VOC facts |
| Activity cue     |                                           | Classification  |
| Data quality     |                                           | Confidence      |
|                  |                                           | Raw JSON/status |
+------------------+-------------------------------------------+-----------------+
| Event timeline | step | play/pause | speed | fault injection | latest warning  |
+--------------------------------------------------------------------------------+
```

### Required 2D layers

1. **Combined:** material fill, anomaly badges, path, and current location.
2. **Material:** controlled material colours plus `unknown` and `pending`.
3. **Metal anomaly:** detected, not detected, missing, and sensor error.
4. **Activity cue:** detected, not detected, missing, and sensor error.
5. **Data quality:** complete, pending, low-confidence, missing, failed, and conflicting.

Useful later layers:

- Visit density.
- Explainable attention/uncertainty.
- Route cost only after the meaning and weights are agreed with the user.

Do not collapse everything into an unexplained red `danger` score. Each visual indicator should have a clear meaning, and the inspector should show the evidence behind it.

## 2D versus 2.5D

The primary view is 2D. Current inputs contain no physical elevation, depth, surface geometry, or point cloud.

The 2.5D view is an alternate rendering of the same cell projection. A cell column may be extruded by:

- Data uncertainty.
- Visit count.
- Configured material traversal cost.
- A disclosed attention score.

It must always show wording like:

```text
Column height: analytical <selected metric> - not physical elevation
```

The 2.5D renderer should not own data or coordinate logic. The backend's cell projection remains authoritative. The 2.5D component should be lazy-loaded and removable without affecting the core product.

## Mock-data strategy

The project currently has no real hardware feed. Treat this as a first-class mock/replay platform, not as a temporary collection of hard-coded values.

Each synthetic hop should be valid through the same public application/API path that future hardware will use. Do not write fixtures directly into database tables.

Recommended fixture structure:

```text
fixtures/
  clean_baseline_v1/
    scenario.json
    expected_projection.json
    images/
  anomaly_clusters_v1/
  wet_obstruction_v1/
  failures_v1/
```

Required scenarios:

1. `clean_baseline_v1`: normal readings and normal mock-classification timing.
2. `anomaly_clusters_v1`: neighbouring metal/activity cues and a revisited cell.
3. `wet_obstruction_v1`: mud, standing water, and at least one `unknown` material result.
4. `failures_v1`: duplicate hop, conflicting duplicate, missing screenshot, delayed screenshot, delayed classification, ML failure, sensor error, out-of-order hop, and reconnect behaviour.

Required replay modes:

- Manual input.
- Step one event at a time.
- Timed playback.
- Fault-injection playback.

Mock images must visibly say `SYNTHETIC MOCK EVIDENCE`, include the hop identity, and show their intended mock class. The UI should also show a mock-source banner so synthetic evidence cannot be mistaken for a real capture.

## Canonical hop semantics

The stable identity is:

```text
mission_id + hop_id
```

This identity joins telemetry, image evidence, model requests, and model results. Do not join records using timestamps alone.

Current mock coordinate convention:

```text
start: (0, 0)
north: +y
east: +x
F: ( 0, +1)
B: ( 0, -1)
L: (-1,  0)
R: (+1,  0)
```

This currently treats `F/B/L/R` as fixed-north translations, not turns. The payload also carries explicit `dx/dy`. This is a mock-mode decision and must be revisited when real movement semantics exist.

Canonical example:

```json
{
  "schema_version": "1.0",
  "observed_at": "2026-09-25T08:14:32.381Z",
  "producer_id": "mock-generator",
  "source": "mock",
  "movement": {
    "command": "F",
    "dx": 0,
    "dy": 1
  },
  "sensors": {
    "metal": {"value": 1, "status": "ok"},
    "voc": {"value": 0, "status": "ok"}
  }
}
```

Important rules:

- `0` is a valid negative value.
- Missing or failed data is `value: null` plus an explicit status.
- One hop moves exactly one Manhattan cell in the current convention.
- A duplicate with identical canonical content is idempotent.
- The same hop identity with different content is a conflict.
- Revisiting a coordinate creates another observation; it does not overwrite evidence.
- Out-of-order hops may be stored as projection-pending until the missing predecessor arrives.

## Repository separation and ML-service boundary

There are two distinct repositories:

```text
pogoscout-platform/       # this repository
pogoscout-material-model/ # teammate/other repository
```

They must not:

- Import each other's source code.
- Share a database.
- Require the same Python environment.
- Read private directories from the other repository.
- Assume both processes start or deploy together.

They may share:

- A published HTTP/OpenAPI contract.
- A controlled material taxonomy and taxonomy version.
- Example requests/responses.
- Contract tests.
- Semantic version expectations.

### Desired eventual interaction

The user's intent is that when a hop produces or receives a screenshot, the platform should "ping" the model repository/service. The clean implementation is:

```text
hop accepted -> map telemetry immediately
screenshot stored -> create inference job
background worker -> POST image to ML service
result received -> attach classification to the same hop
UI updates -> material/evidence layers refresh
```

Do **not** block hop ingestion or map rendering while waiting for the ML service. If the model is unavailable, the hop still appears, and the classification state becomes `retrying`, `unavailable`, or `failed`.

The screenshot, rather than telemetry alone, should trigger the model call. If the user later wants every hop to trigger capture automatically, that capture event can still produce the image that queues inference.

### Recommended ML HTTP contract

```text
POST {ML_SERVICE_URL}/api/v1/classify
Content-Type: multipart/form-data
```

Request fields:

```text
image
request_id
mission_id
hop_id
image_sha256
taxonomy_version
```

Example response:

```json
{
  "schema_version": "1.0",
  "request_id": "inf_01...",
  "mission_id": "demo-001",
  "hop_id": 17,
  "image_sha256": "...",
  "status": "succeeded",
  "label": "mud",
  "confidence": 0.83,
  "model_version": "material-model-0.3.0",
  "taxonomy_version": "pogo-materials-v1",
  "classified_at": "2026-09-25T08:14:33.000Z"
}
```

Suggested initial taxonomy:

```text
firm_soil
leaf_litter
mud
standing_water
root_or_wood
manmade_surface
unknown
```

The platform must verify correlation fields, image hash, confidence range, taxonomy version, and label. Store model version and raw response. A later reclassification should append a new result rather than overwrite prior evidence.

For now, the platform should support adapters behind one interface:

```text
MockClassifierClient
HttpClassifierClient
DisabledClassifierClient
```

The mock implementation is sufficient for immediate development. Real HTTP integration is not the current blocker.

## Agreed platform architecture

| Area | Current decision |
|---|---|
| Frontend | React, TypeScript, Vite |
| Server state | TanStack Query |
| Primary map | SVG grid |
| 2.5D | React Three Fiber/Three.js, lazy-loaded |
| Backend | FastAPI and Pydantic v2 |
| Persistence | SQLite through SQLAlchemy 2 |
| Images | Filesystem plus database metadata and SHA-256 |
| Live updates | WebSocket invalidations plus REST refetch |
| ML integration | Versioned adapter: mock, HTTP, or disabled |
| Deployment | Local/offline; native scripts first, Docker Compose optional |
| Tests | Pytest, Vitest, React Testing Library; Playwright later |

Avoid unnecessary infrastructure. SQLite can hold a small persisted inference-job outbox. Kafka, Redis, Celery, and Kubernetes are not justified for the current scale.

## Current repository state

This is not an empty repository. A Phase 1 vertical slice already exists.

Important files:

- `README.md` - current run/test instructions and implemented feature summary.
- `PLATFORM_ARCHITECTURE_DECISION.md` - detailed product and architecture baseline.
- `POGOSCOUT_SOFTWARE_PLAN.md` - earlier research and broad implementation plan.
- `HOPPING_FLIGHT_CONTROL_RESEARCH.md` - background research; flight control is outside the current software scope.
- `apps/api/` - FastAPI application and backend tests.
- `apps/web/` - React application and frontend tests.
- `fixtures/clean_baseline_v1/scenario.json` - current deterministic fixture.
- `data/pogoscout.sqlite3` - current local development database.

The worktree contains uncommitted files and directories. Treat them as existing user work. Do not reset, delete, overwrite, or re-scaffold the repository.

### Already implemented

- Mission creation and retrieval.
- Immutable, idempotent hop ingestion using `mission_id + hop_id`.
- Validation that distinguishes negative, missing, sensor-error, and invalid readings.
- SQLite persistence.
- Backend-owned nominal coordinate projection.
- Pending projection for out-of-order hops, resolved when gaps arrive.
- Multiple observations on revisited cells.
- Deterministic step replay from `clean_baseline_v1`.
- WebSocket mission-change notifications.
- React application with mission creation.
- Functional SVG grid and nominal path rendering.
- Metal/activity state rendering.
- Basic per-cell evidence inspector.
- Deterministic mock-classifier adapter boundary.
- Backend and frontend unit tests.

Current public API highlights:

```text
POST /api/v1/missions
GET  /api/v1/missions/{mission_id}
GET  /api/v1/missions/{mission_id}/hops
GET  /api/v1/missions/{mission_id}/cells
PUT  /api/v1/missions/{mission_id}/hops/{hop_id}
POST /api/v1/missions/{mission_id}/replay/step
WS   /api/v1/missions/{mission_id}/live
```

### Verified test status on 25 September 2026

Backend:

```text
7 passed
```

Frontend:

```text
2 test files passed
2 tests passed
```

There is one non-blocking Starlette/httpx deprecation warning in the backend test environment.

### Not yet implemented or not complete

- Screenshot upload and filesystem evidence storage.
- Persisted inference-job/outbox worker.
- Real HTTP classifier adapter.
- Classification result history and retries.
- Full material taxonomy integration.
- Full layer selector and legends.
- Rich cell visit/evidence UI.
- Timed replay, pause, speed, and fault injection.
- Additional anomaly/wet/failure fixtures.
- JSON/CSV mission export.
- Event timeline and detailed connection health.
- 2.5D analytical renderer.
- Playwright end-to-end tests.
- Docker Compose/demo runbook, if still desired.

## Suggested implementation sequence

If the user asks the next agent to continue building, preserve the existing Phase 1 slice and work in this order:

### Phase 2 - image evidence and model boundary

1. Add an image metadata model and configured filesystem store.
2. Implement idempotent screenshot upload by hop.
3. Add a persisted inference-job table/outbox.
4. Connect the existing deterministic mock classifier through the job flow.
5. Add the HTTP and disabled classifier adapters behind the same protocol.
6. Store append-only classification results.
7. Show screenshot, status, label, confidence, model version, and raw facts in the inspector.
8. Test missing, delayed, duplicate, conflicting, and failed cases.

### Phase 3 - complete dashboard behaviour

1. Add the required layer controls and persistent legends.
2. Improve multi-visit selection/history.
3. Add WebSocket reconnect/refetch handling.
4. Add event timeline and connection state.
5. Add timed replay, pause, speed, and fault profiles.
6. Add JSON/CSV export.
7. Create the remaining deterministic fixtures.

### Phase 4 - 2.5D and polish

1. Add a lazy-loaded 2.5D analytical renderer using the existing cell API.
2. Start with uncertainty and visit-count height metrics.
3. Add polished empty/loading/error states and accessible colour/keyboard behaviour.
4. Add Playwright end-to-end acceptance and a demo runbook.

Do not start with 2.5D if evidence upload, classifier states, layers, and replay are still incomplete. The 2D flow is the operational source of truth.

## High-impact clarifying questions

Ask only the questions that affect the next requested piece of work. The most important unresolved choices are:

1. **2.5D headline metric:** Should initial column height represent uncertainty, visit count, or a user-defined attention score? Recommended first implementation: uncertainty, with visit count selectable.
2. **Material taxonomy:** Has the ML teammate agreed to the proposed seven labels, or will they provide a different controlled list?
3. **Screenshot workflow:** For mock mode, should the operator upload an image manually, should a fixture attach one automatically, or should both be supported? Recommended: both.
4. **Demo bounds:** Should the map auto-fit an unbounded integer grid or show a fixed physical test grid? Recommended: unbounded storage with auto-fit and optional visible bounds.
5. **Platform visual direction:** Does the user have a desired aesthetic/reference, or should the agent propose one based on an operational dark field interface?
6. **Immediate priority:** Does the user want the next agent to finish the product architecture/UI design first, or continue implementing Phase 2 immediately?

Questions that do not currently block mock-platform work:

- Real Raspberry Pi message transport.
- Actual sensor sampling or thresholds.
- Exact hardware hop-completion signal.
- Real video receiver or capture device.

Those should wait until hardware data and producers exist.

## Instructions to the receiving agent

1. Read this file completely.
2. Read `README.md` and `PLATFORM_ARCHITECTURE_DECISION.md` before changing code.
3. Inspect `git status` and preserve all existing/uncommitted work.
4. Run existing tests before and after material changes.
5. Keep the platform and ML repositories independent.
6. Use deterministic mock data as the current source of truth.
7. Keep terminology and claims cautious and evidence-based.
8. Ask focused clarifying questions when an answer would materially change the platform; otherwise use the recommended defaults documented here.
9. Do not implement hardware code or model training unless the user explicitly changes scope.
10. Do not treat 2.5D analytical height as terrain elevation.

## Concise receiving-agent summary

PogoScout Platform is an offline-first React/FastAPI/SQLite application that maps one mock observation per logical hop onto a layered square grid. The current repo already implements Phase 1: missions, validated/idempotent hop ingestion, coordinate projection, persistence, step replay, WebSocket invalidation, an SVG grid, and basic evidence inspection. Real hardware does not exist for this work yet, so development must use deterministic fixtures and explicit synthetic evidence. The material model belongs in a separate repo and will later be called asynchronously over HTTP after a screenshot is stored; for now, a mock classifier should drive the full platform workflow. The major remaining work is screenshot/evidence storage, persisted inference jobs, classifier result handling, complete layers and replay, exports, and the secondary 2.5D analytical renderer. Ask the user focused clarifying questions when required, especially about the 2.5D metric, material taxonomy, screenshot workflow, visual direction, and next implementation priority.

