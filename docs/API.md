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
// +x is 90 degrees clockwise from it, and one cell is cell_m metres on the ground.
{ "lat": 1.3571, "lon": 103.7362, "heading_deg": 20.0, "cell_m": 2.0 }
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
Body `HopPayload` (see `contracts/hop.v1.schema.json`). 201 created, 200 identical duplicate, 409 same identity different content.

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
  "metal": {"value": 1, "status": "ok"}, "voc": {"value": 0, "status": "ok"},
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
  "cells": [[3, 2, "soil", 1, 0]]   // [x, y, succeeded material label or null, metal detected 0|1, voc detected 0|1]
} ] }
```
`POST /replays` accepts an optional `geo`; without it the scenario's simulated start fix is used (`replay/sites.py`).

## Health

### `GET /health` → `{"status": "ok", "classifier": "mock"|"http"|"disabled", "classifier_status": "ok"|"degraded"|"offline", "model_version": "material-model 0.3.0" | null}`
