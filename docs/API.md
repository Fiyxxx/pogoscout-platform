# PogoScout Platform API v1

Base path `/api/v1`. JSON unless noted. Times are ISO 8601 UTC (`2026-09-25T08:00:12Z`). This file is the contract between `apps/api` and `apps/web`.

## Conventions

- Hop identity is `mission_id + hop_id`. Nothing joins on timestamps.
- Stored hops, images, classifications and events are append-only.
- Errors: FastAPI default `{"detail": "..."}` with 404 (unknown), 409 (conflict), 422 (validation).
- Every mutation publishes a WebSocket notification (see Live). REST is the source of truth.

## Missions

### `POST /missions`
Body `{"name": str, "source": "mock"|"manual"|"hardware" = "mock", "mission_id"?: str, "geo"?: GeoAnchor}` → 201 `MissionSummary`.

```jsonc
// GeoAnchor: GPS fix of cell (0, 0). +y points along heading_deg (clockwise from true north),
// +x is 90 degrees clockwise from it. One cell is 1 m x 1 m on the ground for every mission:
// cell_m is optional on input, always 1.0 in responses, and any other value is rejected (422).
{ "lat": 1.3571, "lon": 103.7362, "heading_deg": 20.0, "cell_m": 1.0 }
```

### `GET /missions` → `MissionSummary[]` (newest first)
### `GET /missions/{mission_id}` → `MissionSummary`
### `PATCH /missions/{mission_id}`
Body `{"status": "live"|"complete"|"aborted", "status_note"?: str}` → `MissionSummary`.

```jsonc
// MissionSummary
{
  "id": "PS-0925-01",
  "name": "Grid Sweep 01",
  "source": "mock",
  "status": "live",              // live | complete | aborted. New missions start live.
  "status_note": null,           // e.g. "Link lost after hop 9"
  "created_at": "...",
  "started_at": "...",           // observed_at of hop 1, null if none
  "last_hop_at": "...",          // observed_at of the highest projected hop, null if none
  "scenario_id": "clean_baseline_v1", // null unless created by replay
  "geo": GeoAnchor | null,       // null when the scout has no GPS fix
  "stats": {
    "hops": 22,                  // stored hops (projected + pending)
    "cells": 22,                 // distinct projected cells
    "metal": 2,                  // cells whose metal state is detected
    "voc": 1,                    // cells whose voc state is detected
    "flags": 5,                  // cells with any flag (see Cell.flags)
    "materials": {"soil": 11, "concrete": 4}  // latest succeeded label per cell, counts
  }
}
```

## Hops

### `PUT /missions/{mission_id}/hops/{hop_id}`
Body `HopPayload` (see `contracts/hop.v2.schema.json`). 201 created, 200 identical duplicate, 409 same identity different content.

Sensor values (`schema_version` "2.0") are **signal strength from 0 to 1** against the calibrated
background: 0 is a clean negative, 1 the strongest signal. They are not probabilities. A missing or
failed reading is `value: null` with status `missing` or `error`. Schema "1.0" producers send 0 or 1,
which are valid 2.0 values. A cell's `metal`/`voc` state is `detected` when any valid reading is 0.50
or above, `not_detected` when there are valid readings below that.

### `GET /missions/{mission_id}/hops` → `HopRecord[]` ordered by hop_id
```jsonc
{ "mission_id": "...", "hop_id": 4, "payload": HopPayload, "content_hash": "...", "received_at": "..." }
```

## Images (screenshots)

### `PUT /missions/{mission_id}/hops/{hop_id}/image`
`multipart/form-data`: `file` (image/png or image/jpeg, max 10 MB), optional `label_hint`, `confidence_hint` (dev/mock only; used by the mock classifier, stored, never shown as evidence).
- The hop does not need to exist yet (screenshots may arrive before telemetry). Mission must exist.
- 201 stored and an inference job queued; 200 identical bytes (same SHA-256) already stored; 409 different bytes for the same hop.
- Response `ImageRecord`:
```jsonc
{ "mission_id": "...", "hop_id": 4, "sha256": "...", "content_type": "image/png", "bytes": 7240, "received_at": "...", "url": "/api/v1/missions/PS-0925-01/hops/4/image" }
```

### `GET /missions/{mission_id}/hops/{hop_id}/image` → the image bytes (correct content type), 404 if none.

## Cells (the projection)

### `GET /missions/{mission_id}/cells` → `CellsResponse`
```jsonc
{
  "mission_id": "...",
  "origin": {"x": 0, "y": 0},
  "current": {"x": 3, "y": 1},
  "path": [{"hop_id": 1, "x": 0, "y": 1}],
  "pending_hop_ids": [],
  "bounds": {"min_x": 0, "max_x": 3, "min_y": 0, "max_y": 5},
  "cells": [Cell]
}
// Cell
{
  "x": 3, "y": 2,
  "visit_count": 1,
  "hop_ids": [21],
  "metal": "detected",           // detected | not_detected | sensor_error | missing
  "voc": "not_detected",
  "material": Classification,    // latest classification of the latest visit that has an image, or {"status": "none"}
  "quality": "complete",         // complete | pending | low_confidence | missing | failed | conflicting
  "flags": ["metal"],            // subset of: metal, voc, low_confidence, pending, failed, missing, conflicting
  "observations": [Observation]  // one per visit, hop order
}
// Observation
{
  "hop_id": 21, "observed_at": "...",
  "movement": {"command": "B", "dx": 0, "dy": -1},
  "metal": {"value": 0.82, "status": "ok"}, "voc": {"value": 0.07, "status": "ok"},
  "image": ImageRecord | null,
  "classification": Classification,       // latest for this hop
  "classification_history": [Classification]  // all results for this hop, oldest first
}
// Classification
{
  "status": "none" | "queued" | "retrying" | "succeeded" | "failed" | "unavailable",
  "label": "soil" | null, "confidence": 0.86 | null,
  "model_version": "material-model 0.3.0" | null, "taxonomy_version": "pogo-materials-v2" | null,
  "requested_at": "..." | null, "completed_at": "..." | null, "error": null | "..."
}
```
Quality rules (first match wins): `conflicting` if a conflicting duplicate was rejected for any hop in the cell; `failed` if latest classification failed/unavailable; `missing` if any visit has metal or voc status `missing` or no image; `pending` if classification queued/retrying; `low_confidence` if latest confidence < 0.80; else `complete`.

## Risk assessment

### `GET /missions/{mission_id}/risk` → `RiskAssessment`
Rules `risk-2`: Bayesian evidence fusion (`apps/api/src/pogoscout_api/domain/risk.py`, ported line
for line to `apps/web/src/lib/risk.ts`; both run `contracts/risk.v2.cases.json`, which also pins the
deciban to probability table). Deterministic and explainable: every rating carries its evidence.

- **Hypotheses** per cell, each with a prior: H, a suspected explosive hazard (2% of cells,
  −17 dB); A, recent activity (3%, −15 dB).
- **Evidence** in decibans, dB = 10 log10 of the likelihood ratio P(reading | H) / P(reading | not H);
  +10 dB multiplies the odds by 10. Posterior dB = prior + evidence, P = 1 / (1 + 10^(−dB/10)).
- **Sensor models** (assumed until the detector is calibrated on known targets):

  | Metal signal | P given H | P given not H | Weight |
  |---|---|---|---|
  | 0.85+ | 0.15 | 0.0005 | +25 dB |
  | 0.70 to 0.84 | 0.25 | 0.0015 | +22 dB |
  | 0.50 to 0.69 | 0.30 | 0.008 | +16 dB |
  | 0.30 to 0.49 | 0.15 | 0.04 | +6 dB |
  | below 0.30 | 0.15 | 0.95 | −8 dB |

  VOC for A: 0.85+ +22, 0.70+ +20, 0.50+ +16, 0.30+ +8, below −7 dB. Context for H: a VOC
  detection at or beside the cell +8 dB (P 0.20 vs 0.03); two or more other metal detections within
  two cells +10 dB (0.40 vs 0.04). Absence of VOC is uninformative.
- **Revisits**: the strongest reading counts in full, each further visit half (repeat readings of
  one object, hazard or clutter, are correlated, not independent).
- **Likelihood grade** from P: 80%+ A Frequent, 50%+ B Likely, 25%+ C Occasional, 15%+ D Seldom,
  else E Unlikely. **Severity**: H is I Catastrophic, A is III Moderate. **Level** from the Army
  risk matrix (ATP 5-19): EH, H, M, L.
- A hazard cell with P 15%+ (High or above) is a **suspected explosive hazard**; below that a
  **metal anomaly** to re-survey. **Not assessed**: no valid metal reading; never shown as safe.
- **Hazard areas** join cells at M or above with P 15%+, up to two cells apart.
- **Summary**: counts of suspected explosive hazards, metal anomaly areas, recent activity areas,
  metal anomalies to re-survey and the share of cells not assessed. There is deliberately no go or
  no-go verdict: operators may still need to enter an area, so the platform informs the decision
  and leaves it to them.

```jsonc
{
  "rules_version": "risk-2",
  "summary": ["7 suspected explosive hazards", "16 metal anomalies to re-survey"],
  "coverage": {"surveyed": 1404, "assessed": 1385},
  "matrix": {"I": [13, 7, 7, 0, 19], "II": [0, 0, 0, 0, 0], "III": [2, 1, 5, 3, 15], "IV": [0, 0, 0, 0, 0]},
  "cells": [  // only cells with an indication or not assessed
    {"x": 10, "y": 6, "assessed": true, "kind": "explosive", "db": 18, "p": 98, "probability": "A",
     "severity": "I", "level": "EH", "label": "Suspected explosive hazard",
     "reasons": ["Prior 2% of cells: −17 dB", "Metal 0.90: +25 dB",
                 "6 more metal detections within 2 cells: +10 dB"]}
  ],
  "areas": [
    {"id": "A1", "kind": "explosive", "level": "EH", "label": "Suspected explosive hazard",
     "action": "Mark the area and bypass where possible. If passage is needed, use a cleared lane or request EOD.",
     "cells": [[10, 6], [11, 6]], "centroid": [10.44, 6.55], "peak": [10, 6], "p": 98,
     "reasons": ["Prior 2% of cells: −17 dB", "Metal 0.90: +25 dB",
                 "6 more metal detections within 2 cells: +10 dB", "9 cells in this area"]}
  ]
}
```

## Events

### `GET /missions/{mission_id}/events?limit=200` → `Event[]` newest first
```jsonc
{ "id": 57, "at": "...", "kind": "metal_detected", "level": "alert", "hop_id": 21, "x": 3, "y": 2, "message": "Metal anomaly at (3, 2)" }
```
Kinds: `hop_accepted` (info), `hop_duplicate` (debug), `hop_conflict` (warning), `hop_pending` (warning, out of order), `image_stored` (debug), `classification_queued` (debug), `classification_succeeded` (info), `classification_low_confidence` (warning), `classification_failed` (warning), `metal_detected` (alert), `voc_detected` (alert), `sensor_error` (warning), `mission_status` (info).
`at` is the hop's `observed_at` for hop-derived events, server time otherwise. Messages use no em-dashes.

## Replay (deterministic fixtures)

### `GET /scenarios` → `[{"scenario_id": "clean_baseline_v1", "description": "...", "hops": 22, "events": 44}]`
### `POST /replays`
Body `{"scenario_id": str, "mission_id"?: str, "name"?: str}` → 201 `MissionSummary` (status live, source mock, scenario linked). No events applied yet.
### `GET /missions/{mission_id}/replay` → `ReplayState`
### `POST /missions/{mission_id}/replay/step` → `ReplayState` (applies the next scenario event)
### `POST /missions/{mission_id}/replay/advance` body `{"events": int}` → `ReplayState`
Applies up to `events` (1 to 100000) of the next scenario events immediately, in order, through the same services as `step` (used for seeding). Stops at the end of the scenario; reaching the end completes a live mission.
### `POST /missions/{mission_id}/replay/play` body `{"speed": 1|2|4|8}` → `ReplayState`
### `POST /missions/{mission_id}/replay/pause` → `ReplayState`
```jsonc
// ReplayState
{ "scenario_id": "...", "cursor": 10, "total": 44, "playing": false, "speed": 1, "finished": false }
```
Replay applies events through the same application services as the HTTP endpoints (never direct table writes). Timed play respects scenario `at_ms` deltas divided by speed. When the last event is applied the mission becomes `complete`.

## Export

- `GET /missions/{mission_id}/export/archive.json` full mission (summary, hops, images metadata, classifications, events)
- `GET /missions/{mission_id}/export/hops.csv`
- `GET /missions/{mission_id}/export/cells.csv`
- `GET /missions/{mission_id}/report` printable HTML mission report (flags, model versions, time range); the browser prints it to PDF.

## Live

### `WS /missions/{mission_id}/live`
Server sends JSON `{"type": "changed", "mission_id": "...", "topics": ["hops","cells","events","mission","replay"], "hop_id": 21 | null, "hop_ids": [19, 20, 21]}`. Clients refetch the matching queries. Server sends `{"type": "ping"}` every 15 s.

Notifications are coalesced per mission: at most one `changed` message per ~250 ms. The first change after a quiet period is sent immediately; later changes in the window are merged into one message whose `topics` is the union, `hop_ids` lists every changed hop (sorted, may be empty) and `hop_id` is the most recent of them (null if none).

## Theatre

### `GET /world`
Every mission with a GPS anchor, newest first, for the theatre map. Missions without `geo` are omitted.
```jsonc
{ "missions": [ {
  "mission": MissionSummary,
  "geo": GeoAnchor,
  "current": {"x": 3, "y": 1} | null,
  "cells": [[3, 2, "soil", 0.82, 0.07, 0.76]],
  // [x, y, succeeded material label or null, strongest metal 0..1, strongest voc 0..1,
  //  risk heat: P(hazard), half P for an activity cue, 0 no indication, -1 not assessed]
  "risk": {"summary": [...], "areas": [RiskArea without cells, plus "size"]}
} ] }
```
`POST /replays` accepts an optional `geo`; without it the scenario's simulated start fix is used (`replay/sites.py`).

## Health

### `GET /health` → `{"status": "ok", "classifier": "mock"|"http"|"disabled", "classifier_status": "ok"|"degraded"|"offline", "model_version": "material-model 0.3.0" | null}`
