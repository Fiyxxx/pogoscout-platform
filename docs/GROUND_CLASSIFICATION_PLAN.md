# Plan: link the platform to the ground-classification service

Status: proposed. Branch: `feat/link-cv-service`.

## Goal

A live demo sandbox that uses real ground-classification data. While the
platform runs, it acts as the drone: every 2 s it moves one cell, fetches the
ground-classification service's latest confident label and the image behind
it, and records both as that hop. A new demo page shows the run as it happens:
the current crop and label, and a map of the materials seen so far.

The design is deliberately simple: one fetch per hop on a fixed 2 s clock, and
no retries. A stale reading is better than none, as long as it is marked as
stale.

## Scope: additive only

This work adds a demo; it doesn't change any current feature. Everything new
lives in new files, and existing files only gain the wiring needed to reach
them.

- **New files:** the ground adapter, the demo runner, the demo routes, the demo
  page and its helpers, the contract and tests.
- **Wiring only in existing files:** new settings in `config.py` (off by
  default), building the runner in `context.py`, starting and stopping it in
  `main.py`'s lifespan, including the new router, a `/demo` route in
  `main.tsx`, and a "Live demo" link in `NavTabs.tsx`.
- **Unchanged:** the hop, image and classification endpoints; `store_image`
  and the inference worker; the HTTP and mock classifiers; the
  `pogo-materials-v2` taxonomy; quality, flag and risk rules; `/health`;
  replays; exports; and the existing pages and components.
- With `ground_enabled` false (the default), the platform behaves exactly as it
  does today.
- The existing test suite must pass without edits.

## How the two services work today

| | pogoscout-platform | ground_classification |
|---|---|---|
| Input | Hop telemetry via `PUT /missions/{id}/hops/{hop_id}`, then a screenshot via `PUT .../image` | Pi Camera stream, classified by CLIP about twice a second |
| Classification | The screenshot queues a job, and a worker sends the image to `POST {ML_SERVICE_URL}/api/v1/classify` | Runs on its own feed and averages embeddings over a 2.5 s window |
| Output | Classification rows per hop, which are never edited, only added to | `GET 127.0.0.1:8765/latest` returns `{label, age_s}`, or 503 before the first confident label |
| Labels | `pogo-materials-v2`: 10 labels | The same 10 plus `wood` |

## Decisions

- **The platform makes the hops.** There is no drone link and no hop bridge.
  The demo drone doesn't hop, so we assume it starts hopping the moment the
  platform starts, one hop every 2 s. The platform's demo runner produces those
  hops itself.
- **No delay between touchdown and the hop.** The hop and the fetch happen at
  the same tick, so there is no fetch delay to tune.
- **Poll every 2 s.** Each tick fetches `/latest` once and turns the reading
  into one hop.
- **Only ground data is real.** We have no VOC or metal sensor. Demo hops
  report both sensors as `{"value": null, "status": "missing"}` rather than a
  fake 0.0, so the platform never claims a cell is clear of metal or VOC.
- **The platform taxonomy stays at `pogo-materials-v2`.** Demo readings are
  stored with the ground service's own label, including `wood`, and their own
  taxonomy version (2.1). Only the demo page knows about `wood`.

## Assumptions

- Both services always run on the same laptop and share a clock. The ground
  service keeps listening on `127.0.0.1` only, with no authentication.
- Someone moves the camera over different surfaces while the demo runs.
- Nothing uploads screenshots to demo missions. The ground service provides
  the images.
- The platform stores the landing-area crop, not the full frame, since the
  crop is what gets classified.

---

## Part 1: ground_classification

These changes are also additive. `/latest` keeps its existing `label` and
`age_s` fields and its 503 before the first confident label, and the temporal
average is unchanged.

### 1.1 Store the reading as one snapshot

`api.py` → `LatestConfident`:

- Store `(label, confidence, captured_ts, jpeg)` together under the lock, so
  the label and image always come from the same moment. No frame buffer is
  needed.

`app.py`, where it calls `latest_confident.set(...)`:

- Encode the landing-area crop:
  `cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 85])[1].tobytes()`.
  It is about 435×432 px and roughly 30–60 KB, encoded at most twice a second.
- Pass the confidence (see 1.2) and the JPEG along with the label.

### 1.2 Confidence

Compute a softmax over the averaged label scores and report the top label's
probability. Log it in the CSV as a new last column, so existing columns keep
their positions.

Calibrate the softmax temperature against the hand-labelled crops already used
to tune the prompts. Choose it so that the reported probability matches how
often the label is right. Don't tune it just to get past the platform's 0.80
threshold. With CLIP's default scale (×100), confusable pairs such as mud and
sand score only about 0.4–0.6, so nearly every cell would show as
`low_confidence`.

### 1.3 Model version

Set `model_version` to the model plus a short hash of the prompt set, for
example `clip-vit-b32+prompts-3f9a2c1d`. Changing the prompts changes results
as much as changing the model, so each stored reading needs to record which
prompts produced it.

### 1.4 Endpoints

`GET /latest` returns 200 with the existing fields plus new ones:

```json
{
  "label": "gravel",
  "confidence": 0.91,
  "captured_at": 1790000000.123,
  "age_s": 0.4,
  "model_version": "clip-vit-b32+prompts-3f9a2c1d",
  "image_jpeg_b64": "/9j/4AAQSkZJRg..."
}
```

It returns 503 `{"error": "no confident classification yet"}` until the first
confident label, as it does now. The image adds about 80 KB, which is fine over
localhost.

Add `GET /health`, which returns `{"status": "ok", "model_version": "..."}`.

### 1.5 Docs

Update the README's `/latest` example and the `config.py` comment block.

---

## Part 2: pogoscout-platform

### 2.1 Contracts and labels

- Add `contracts/ground-latest.v1.openapi.yaml`, which describes 1.4.
- Add `domain/ground_labels.py` with `GROUND_TAXONOMY_VERSION = "ground-v1"`
  and `GROUND_LABELS`: the `pogo-materials-v2` labels plus `wood`. Demo
  classification rows record `taxonomy_version: "ground-v1"`.
- Don't touch `domain/materials.py`, `apps/web/src/lib/materials.ts`,
  `config.taxonomy_version` or the classifier adapters. The existing pages
  already fall back to a neutral colour for a label they don't know
  (`isMaterial`), so a `wood` cell shows up there as unknown ground without any
  change.

### 2.2 Config (`config.py`, `.env.example`)

New settings only, with ground mode off by default:

```python
ground_enabled: bool = False
ground_service_url: str = "http://127.0.0.1:8765"
ground_hop_interval_s: float = 2.0   # one hop and one /latest fetch per tick
ground_timeout_s: float = 0.5
```

### 2.3 Adapter: `adapters/ground/`

`GroundClient`, built on httpx:

- `latest() -> GroundReading | None` returns `None` on a 503. It raises
  `GroundUnavailable` if the service can't be reached or times out.
- `health()` caches for 10 s, like `HttpClassifierClient`.
- It checks each response: the label is in `GROUND_LABELS`, the confidence is
  between 0 and 1, `captured_at` is a number, and the image decodes as a JPEG.
  Any check that fails raises `GroundInvalid`. It keeps the raw response (minus
  the image bytes) for `raw_response`.

### 2.4 Storing the demo image

The runner stores its own image and doesn't call `store_image`, which always
queues an inference job. `store_image` and the upload route stay as they are.

In `application/ground.py`, `_save_image(...)` reuses the existing pieces:
`validate_image`, `sha256_hex`, `ImageStore.relative_path` and `write`,
`ImageRow`, and `events.record(..., "image_stored", ...)`. It doesn't queue a
job, commit or notify. The hop was created in the same tick, so there's no
existing image to conflict with.

### 2.5 The demo runner (`application/ground.py`)

`GroundDemo`, built in `context.py` and started and stopped from `main.py`'s
lifespan, next to `InferenceWorker` and `ReplayManager`.

1. **Start.** When `ground_enabled` is true, the runner starts with the
   platform. It creates a mission through the existing
   `missions.create_mission` with `source: "hardware"`, id
   `GD-<YYYYMMDD-HHMMSS>` and name "Ground demo <time>", sets it `live`, and
   starts ticking. It can also be stopped and restarted from the demo page
   (2.6). Each start makes a new mission, and a stop sets the mission
   `completed`.
2. **Tick.** Every `ground_hop_interval_s`, scheduled against a fixed start
   time so a slow tick doesn't push the rest back:
   1. Call `latest()` **once**.
   2. Ingest hop `n` through the existing `missions.ingest_hop`, which commits
      it. Payload: `schema_version: "2.0"`, `observed_at` set to the tick time,
      `producer_id: "ground-demo"`, `source: "hardware"`, the next
      `MovementCommand` on a lawnmower path (8 cells across, then a step), and
      both sensors `{"value": null, "status": "missing"}`.
   3. Attach the reading to hop `n` (step 3 or 4), commit, then notify the UI
      about `["cells", "events", "mission"]`.
3. **On a reading:**
   - Stale is `captured_at` earlier than the previous tick, meaning the ground
     service has produced no new confident reading since the last hop, so this
     hop repeats the previous cell's reading.
   - In one transaction, it calls `_save_image` with the decoded JPEG and
     writes a `succeeded` classification row with the label, confidence, model
     version, `taxonomy_version: "ground-v1"`, `requested_at` set to the tick
     time, `completed_at` and `raw_response` (including `captured_at`, `age_s`
     and `stale`). `request_id` is `gnd_<uuid>`, and `image_sha256` is the
     image's SHA-256.
   - It records `classification_succeeded` or `classification_low_confidence`
     using the existing event kinds. A stale reading adds " (stale reading,
     2.4 s old)" to the message.
4. **On a 503, a timeout, a connection error or an invalid response,** the hop
   is still ingested. The runner writes an `unavailable` row (or `failed` for
   an invalid response) with the reason and `image_sha256="none"`, and records
   `classification_failed`. It never retries: a later fetch would describe
   different ground. The runner keeps ticking, so the demo resumes by itself
   once the ground service is back.
5. **Shutdown.** On platform shutdown the runner cancels its task and leaves
   the mission `live`, like a replay. The next start makes a new mission.

No `queued` row is written. The hop is committed a moment before its reading,
so for that moment the cell shows `missing`. Nothing needs recovering after a
restart.

### 2.6 API (`api/ground_routes.py`)

New routes only:

- `GET /api/v1/ground-demo` returns
  `{"running": bool, "mission_id": str | null, "hops": int, "interval_s": 2.0, "ground": "off" | "ok" | "offline", "ground_model_version": str | null}`.
  When `ground_enabled` is false, `running` is false and `ground` is `off`.
  The ground service's status is reported here, not in `/health`.
- `POST /api/v1/ground-demo/start` starts a new run and returns the same body.
  It returns 409 if a run is already going, and 409 if `ground_enabled` is
  false.
- `POST /api/v1/ground-demo/stop` stops the current run and returns the same
  body.
- `GET /api/v1/ground-demo/{mission_id}/hops?limit=10` returns the newest hops
  first, one entry per hop:
  `{hop_id, x, y, observed_at, status, label, confidence, model_version, captured_at, age_s, stale, error, image_url}`.
  `captured_at`, `age_s` and `stale` come from the classification row's
  `raw_response`. The existing cells and hops endpoints don't return
  `raw_response`, and they stay as they are, so this route is how the page
  gets them. `image_url` is the existing
  `/missions/{id}/hops/{hop_id}/image`, or null when the fetch failed.

Everything else is read through the existing endpoints, unchanged:
`GET /missions/{id}/cells` gives each cell's position, material label and its
hops' image URLs, and `GET /missions/{id}/hops/{hop_id}/image` serves the
stored crop.

### 2.7 Web: the demo page

All new files, under `pages/DemoPage.tsx` and `features/demo/`. Reach it at
`/demo`, from a "Live demo" link added to `NavTabs.tsx` next to the 3D tab.

Data sources:

| Part of the page | Source | Refresh |
|---|---|---|
| Header | `GET /ground-demo` | polled every 2 s, so it also sees the ground service go offline and a stop |
| Current reading, recent hops | `GET /ground-demo/{id}/hops` | query key `['mission', id, 'ground-hops']` |
| Map | existing `GET /missions/{id}/cells` | existing `keys.cells(id)` |
| Crops | existing `GET /missions/{id}/hops/{hop_id}/image` | fetched once per hop, since images never change |

The page calls the existing `useMissionLive(id)`. The runner notifies
`["cells", "events", "mission"]` after each hop. `cells` refreshes the map, and
`mission` refreshes the recent-hops query too, because TanStack Query
invalidates by key prefix and that query's key starts with `keys.mission(id)`.
`live.ts` doesn't need changing. New API calls go in `features/demo/api.ts`
rather than in `api/client.ts`.

- **Header:** the run's state (running, stopped, ground service offline,
  waiting for the first confident label), the hop count, and Start / Stop
  buttons.
- **Current reading:** the newest hop's crop at its full square size, with the
  label, confidence, the age of the reading, and a "stale" note when `stale`
  is true. If that hop's fetch failed, it shows the reason in place of the
  crop.
- **Map:** a simple 2D grid in `features/demo/`, drawn from the cells
  response and coloured by each cell's material label, with the newest cell
  highlighted. Clicking a cell shows its crop and label. It uses its own
  colour table, `features/demo/labels.ts`, which reuses `MATERIAL_COLORS` and
  `MATERIAL_NAMES` and adds `wood`. `MissionMap` isn't used, because it
  expects a risk assessment and doesn't know `wood`.
- **Recent hops:** a strip of the last 10 hops: crop thumbnail, label,
  confidence and stale mark, newest first.
- **Sensors note:** a fixed line saying VOC and metal sensors aren't fitted in
  this demo, so there is no risk assessment. The page shows no risk layer,
  risk panel or quality badges.

The demo page shows its own images, so `Capture.tsx` and the inspector aren't
changed.

### 2.8 Tests (`apps/api/tests/test_ground.py`)

New test file only. Use `httpx.MockTransport` in place of the ground service,
and drive the runner one tick at a time rather than waiting on the clock:

- A tick ingests one hop and fetches once. The image is stored, `has_image` is
  true, no inference job is queued, and the classification is `succeeded` with
  the reading's label, confidence and `taxonomy_version: "ground-v1"`.
  Confidence below 0.80 records `classification_low_confidence`.
- A `wood` reading is stored as `wood`.
- Hops are numbered in order, every movement command is valid, and the path
  stays on the lawnmower pattern.
- Demo hops carry `source: "hardware"`, `producer_id: "ground-demo"`, and both
  sensors `missing` with value null.
- A reading captured before the previous tick is stored with `stale: true`
  and the event says so.
- A timeout, a connection refused, or a 503 still ingests the hop and gives
  `unavailable`, with no retry. The next tick fetches again as normal.
- A label outside `GROUND_LABELS`, a confidence outside 0–1, or an image that
  doesn't decode gives `failed`, with no image stored.
- Start creates a new `live` mission. Start while running returns 409. Stop
  sets the mission `completed`.
- With `ground_enabled` false, no runner starts, `GET /ground-demo` reports
  `off`, and start returns 409.
- Through the existing endpoints after a few ticks: `GET /missions/{id}/cells`
  gives each cell the reading's label (including `wood`) at the right x, y,
  and each hop's image URL. `GET .../hops/{hop_id}/image` returns the exact
  JPEG bytes the ground service sent.
- `GET /ground-demo/{id}/hops` returns the newest hops first, with `stale`,
  `age_s` and `captured_at` from `raw_response`, and a null `image_url` for a
  failed fetch.

The existing test suite runs unchanged and must still pass.

### 2.9 Docs

Add the ground-demo endpoints to `docs/API.md`, the new settings to
`.env.example`, the new contract to `contracts/README.md`, and a "Live ground
demo" section to the README on how to run it. Don't rewrite existing sections.

---

## Order of work

1. Ground service: snapshot, confidence, model version, the new `/latest`
   fields and `/health` (1.1–1.4).
2. Platform: contract, ground labels, config and adapter (2.1–2.3).
3. Platform: demo runner and API, with their tests (2.4–2.6, 2.8). Run the full
   existing suite as well.
4. Web: demo page (2.7), then docs (2.9, 1.5).
5. Run the demo end to end (below).

## Running the demo

Run the ground service on the Pi Camera, start the platform with
`POGOSCOUT_GROUND_ENABLED=true`, open `/demo`, and move the camera over two or
three surfaces. A new hop should appear every 2 s with its crop and label.

## Checks

- **Nothing else changed.** With `ground_enabled` false, the existing pages,
  replays and the existing test suite behave as before.
- **Image matches label.** Move the camera over two or three clearly different
  surfaces, holding each for a few hops. Check each hop's crop against its
  label, and how many hops it takes for the label to follow a change of
  surface. That shows the lag from the temporal average.
- **Stale rate.** With the camera held steady on a surface, almost no readings
  should be stale. Stale readings here point to a slow inference rate or
  dropped frames from the stream.
- **Missed fetches.** Every hop should get a classification row. Count any
  `unavailable` rows and check their reasons.
- **Service restarts.** Stop the ground service mid-run and start it again.
  The page should show it offline, hops should keep coming with `unavailable`
  rows, and readings should resume by themselves.

## Known limitations

- **No VOC or metal data.** Demo missions have no risk assessment. They also
  appear in the Missions list, and there, on the normal mission page, every
  cell's quality is `missing` and risk is "not assessed". That's accurate, and
  it keeps the existing pages unchanged.
- **`wood` is only named on the demo page.** Elsewhere a `wood` cell shows as
  unknown ground, in the neutral colour.
- **Hops are simulated.** The position comes from the runner's lawnmower path,
  not from where the camera is. The cell grid shows when readings were taken,
  not where.
- **The label is averaged, the image is one frame.** The label comes from up
  to 2.5 s of embeddings, so right after the camera moves to a new surface, a
  correct image can carry a label blended with, or taken from, the previous
  surface. If that is a problem, label each sharp frame on its own: drop the
  average and keep multi-view and tile agreement. The label then matches its
  image exactly.
- **Frame timestamps are arrival times.** `captured_at` is when the laptop
  received the frame. On the Pi/RTSP path, a TCP stall can deliver buffered
  frames late, stamped with the later arrival time.

## Later, once the drone hops

The drone link replaces the runner's clock: each hop comes from the drone as
it lands, and the platform fetches `/latest` for it. Then the timing matters
again. The fetch has to fall after this landing's first sharp frame and before
the next landing's, and any delay between touchdown and the platform receiving
the hop shifts it. Adding `wood` to the platform taxonomy and real sensor
readings would bring demo data into the main views. None of this is in scope
now.
