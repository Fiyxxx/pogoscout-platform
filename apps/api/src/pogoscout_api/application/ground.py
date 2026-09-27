"""Live ground demo: the platform plays the drone, using the ground-classification service.

Each tick fetches the service's latest reading once, makes one hop on a lawnmower path through
the same service as the HTTP endpoint, and records the reading as that hop's image and
classification. There are no retries: a later fetch would describe different ground. A reading
the service has not replaced since the previous tick is stored as stale rather than dropped.

The demo has no VOC or metal sensor, so both are recorded as missing, never as a clean 0.
"""

import asyncio
import contextlib
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from pogoscout_api.adapters.ground import (
    GroundClient,
    GroundInvalid,
    GroundReading,
    GroundUnavailable,
)
from pogoscout_api.application import events, missions, positions
from pogoscout_api.application.notify import Notifier
from pogoscout_api.config import Settings
from pogoscout_api.domain.ground_labels import GROUND_TAXONOMY_VERSION
from pogoscout_api.domain.hops import (
    MOVEMENT_VECTORS,
    HopPayload,
    Movement,
    MovementCommand,
    SensorReading,
    Sensors,
)
from pogoscout_api.domain.quality import LOW_CONFIDENCE
from pogoscout_api.evidence.store import ImageStore, InvalidImage, sha256_hex, validate_image
from pogoscout_api.persistence.db import (
    ClassificationRow,
    Database,
    HopRow,
    ImageRow,
    MissionRow,
    utcnow,
)

log = logging.getLogger(__name__)

PRODUCER_ID = "ground-demo"
LANE_CELLS = 8
MISSING = SensorReading(value=None, status="missing")

GroundStatus = Literal["off", "ok", "offline"]


class GroundDemoState(BaseModel):
    running: bool
    mission_id: str | None
    hops: int
    interval_s: float
    ground: GroundStatus
    ground_model_version: str | None


class GroundHop(BaseModel):
    hop_id: int
    x: int | None
    y: int | None
    observed_at: datetime
    status: str  # the classification status, or "none" before the reading is attached
    label: str | None
    confidence: float | None
    model_version: str | None
    captured_at: float | None
    age_s: float | None
    stale: bool | None
    error: str | None
    image_url: str | None


def lawnmower_command(hop_id: int) -> MovementCommand:
    """Hops 1 to 8 cross the first lane east, then each lane is one step north and 7 hops back."""
    if hop_id <= LANE_CELLS:
        return "R"
    lane, step = divmod(hop_id - LANE_CELLS - 1, LANE_CELLS)
    if step == 0:
        return "F"
    return "L" if lane % 2 == 0 else "R"


def demo_payload(hop_id: int, at: float) -> HopPayload:
    command = lawnmower_command(hop_id)
    dx, dy = MOVEMENT_VECTORS[command]
    return HopPayload(
        schema_version="2.0",
        observed_at=datetime.fromtimestamp(at, UTC),
        producer_id=PRODUCER_ID,
        source="hardware",
        movement=Movement(command=command, dx=dx, dy=dy),
        sensors=Sensors(metal=MISSING, voc=MISSING),
    )


def _save_image(
    session: Session,
    store: ImageStore,
    mission_id: str,
    hop_id: int,
    data: bytes,
    *,
    max_bytes: int,
    position: tuple[int, int] | None,
) -> ImageRow:
    """Store the ground crop for a hop made in this same tick. Unlike `images.store_image`, it
    queues no inference job: the reading already carries its label. The caller commits."""
    content_type = validate_image(data, "image/jpeg", max_bytes)
    relative = store.relative_path(mission_id, hop_id, content_type)
    store.write(relative, data)
    row = ImageRow(
        mission_id=mission_id,
        hop_id=hop_id,
        sha256=sha256_hex(data),
        content_type=content_type,
        bytes=len(data),
        path=relative,
    )
    session.add(row)
    events.record(
        session,
        mission_id,
        "image_stored",
        f"Ground crop stored for hop {hop_id}",
        hop_id=hop_id,
        position=position,
    )
    return row


@dataclass(frozen=True)
class _Failure:
    status: Literal["unavailable", "failed"]
    error: str
    raw: dict | None = None


@dataclass
class _Run:
    mission_id: str
    started_at: float  # Unix seconds
    last_tick_at: float  # Unix seconds of the previous tick; the start, before hop 1
    hops: int = 0
    running: bool = True
    task: asyncio.Task | None = None


class GroundDemo:
    def __init__(
        self,
        db: Database,
        store: ImageStore,
        config: Settings,
        notifier: Notifier,
        client: GroundClient,
    ) -> None:
        self.db = db
        self.store = store
        self.config = config
        self.notifier = notifier
        self.client = client
        self._run: _Run | None = None  # the current run, or the last one once stopped
        self._lock = threading.Lock()  # one tick records at a time

    # State ---------------------------------------------------------------------------------

    @property
    def running(self) -> bool:
        return self._run is not None and self._run.running

    async def state(self) -> GroundDemoState:
        if self.config.ground_enabled:
            ground, model_version = await self.client.health()
        else:
            ground, model_version = "off", None
        run = self._run
        return GroundDemoState(
            running=self.running,
            mission_id=run.mission_id if run else None,
            hops=run.hops if run else 0,
            interval_s=self.config.ground_hop_interval_s,
            ground=ground,
            ground_model_version=model_version,
        )

    # Start and stop ------------------------------------------------------------------------

    def _create_mission(self, now: float) -> str:
        local = datetime.fromtimestamp(now)
        base = f"GD-{local:%Y%m%d-%H%M%S}"
        with self.db.session_scope() as session:
            for suffix in ("", *(f"-{n}" for n in range(2, 100))):
                mission_id = base + suffix
                if session.get(MissionRow, mission_id) is None:
                    break
            missions.create_mission(
                session,
                f"Ground demo {local:%H:%M:%S}",
                "hardware",
                mission_id,
                notifier=self.notifier,
            )
        return mission_id

    def begin(self, now: float | None = None) -> str:
        """Create a new live mission and make it the current run, without the clock. Tests call
        this and then `tick` directly; `start` also runs the clock."""
        if not self.config.ground_enabled:
            raise missions.Conflict("the ground demo is off (set POGOSCOUT_GROUND_ENABLED=true)")
        if self.running:
            raise missions.Conflict(f"ground demo {self._run.mission_id} is already running")
        now = time.time() if now is None else now
        mission_id = self._create_mission(now)
        self._run = _Run(mission_id=mission_id, started_at=now, last_tick_at=now)
        return mission_id

    async def start(self) -> GroundDemoState:
        """Start a new run. Must be called from the event loop."""
        self.begin()
        run = self._run
        assert run is not None
        run.task = asyncio.create_task(self._loop(run), name=f"ground-demo-{run.mission_id}")
        return await self.state()

    async def stop(self) -> GroundDemoState:
        """Stop the current run and mark its mission complete. A no-op when nothing runs."""
        run = self._run
        if run is not None and run.running:
            await self._cancel(run)
            with self.db.session_scope() as session:
                if missions.get_mission(session, run.mission_id).status == "live":
                    missions.set_status(session, run.mission_id, "complete", notifier=self.notifier)
        return await self.state()

    async def shutdown(self) -> None:
        """Platform shutdown: stop the clock and leave the mission live, like a replay."""
        if self._run is not None:
            await self._cancel(self._run)

    async def _cancel(self, run: _Run) -> None:
        run.running = False
        task, run.task = run.task, None
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    # The clock -----------------------------------------------------------------------------

    async def _loop(self, run: _Run) -> None:
        """Tick on a fixed schedule from the start, so a slow tick doesn't push the rest back.
        Slots missed entirely (a stalled loop, a sleeping laptop) are skipped, not replayed."""
        loop = asyncio.get_running_loop()
        interval = self.config.ground_hop_interval_s
        origin = loop.time()
        slot = 0
        while run.running:
            slot = max(slot + 1, int((loop.time() - origin) // interval))
            await asyncio.sleep(max(0.0, origin + slot * interval - loop.time()))
            if not run.running:
                break
            try:
                await self.tick()
            except Exception:  # never let one bad tick end the demo
                log.exception("ground demo tick failed")

    # One tick ------------------------------------------------------------------------------

    async def tick(self, at: float | None = None) -> int:
        """Fetch once, ingest the next hop and attach the reading to it. Returns the hop id."""
        run = self._run
        if run is None or not run.running:
            raise missions.Conflict("no ground demo is running")
        at = time.time() if at is None else at
        outcome = await self._fetch()
        with self._lock, self.db.session_scope() as session:
            hop_id = run.hops + 1
            missions.ingest_hop(
                session, run.mission_id, hop_id, demo_payload(hop_id, at), notifier=self.notifier
            )
            run.hops = hop_id
            previous, run.last_tick_at = run.last_tick_at, at
            if isinstance(outcome, _Failure):
                self._record_failure(session, run.mission_id, hop_id, at, outcome)
            else:
                stale = outcome.captured_at < previous
                self._record_reading(session, run.mission_id, hop_id, at, outcome, stale)
            session.commit()
        self.notifier.publish(run.mission_id, ["cells", "events", "mission"], hop_id)
        return hop_id

    async def _fetch(self) -> GroundReading | _Failure:
        try:
            reading = await self.client.latest()
        except GroundUnavailable as exc:
            return _Failure("unavailable", str(exc), exc.raw)
        except GroundInvalid as exc:
            return _Failure("failed", str(exc), exc.raw)
        except Exception as exc:  # the hop is still made; the failure is recorded against it
            log.exception("ground client crashed")
            return _Failure("failed", f"ground client error: {exc}")
        if reading is None:
            return _Failure("unavailable", "no confident classification yet")
        return reading

    def _record_reading(
        self,
        session: Session,
        mission_id: str,
        hop_id: int,
        at: float,
        reading: GroundReading,
        stale: bool,
    ) -> None:
        position = events.hop_position(session, mission_id, hop_id)
        try:
            image = _save_image(
                session,
                self.store,
                mission_id,
                hop_id,
                reading.image,
                max_bytes=self.config.max_image_bytes,
                position=position,
            )
        except InvalidImage as exc:
            failure = _Failure("failed", f"invalid response: {exc}", reading.raw)
            self._record_failure(session, mission_id, hop_id, at, failure)
            return
        session.add(
            ClassificationRow(
                mission_id=mission_id,
                hop_id=hop_id,
                request_id=f"gnd_{uuid.uuid4().hex}",
                image_sha256=image.sha256,
                status="succeeded",
                label=reading.label,
                confidence=reading.confidence,
                model_version=reading.model_version,
                taxonomy_version=GROUND_TAXONOMY_VERSION,
                requested_at=datetime.fromtimestamp(at, UTC),
                completed_at=utcnow(),
                raw_response={**reading.raw, "stale": stale},
            )
        )
        note = f" (stale reading, {reading.age_s:.1f} s old)" if stale else ""
        result = f"{reading.label} ({reading.confidence:.2f})"
        if reading.confidence < LOW_CONFIDENCE:
            where = events.xy(*position) if position else f"hop {hop_id}"
            kind, message = "classification_low_confidence", f"Low confidence at {where}: {result}"
        else:
            kind, message = "classification_succeeded", f"Hop {hop_id} classified as {result}"
        events.record(session, mission_id, kind, message + note, hop_id=hop_id, position=position)

    def _record_failure(
        self, session: Session, mission_id: str, hop_id: int, at: float, failure: _Failure
    ) -> None:
        session.add(
            ClassificationRow(
                mission_id=mission_id,
                hop_id=hop_id,
                request_id=f"gnd_{uuid.uuid4().hex}",
                image_sha256="none",
                status=failure.status,
                taxonomy_version=GROUND_TAXONOMY_VERSION,
                requested_at=datetime.fromtimestamp(at, UTC),
                completed_at=utcnow(),
                error=failure.error,
                raw_response=failure.raw,
            )
        )
        if failure.status == "unavailable":
            message = f"Ground service unavailable for hop {hop_id}: {failure.error}"
        else:
            message = f"Ground reading failed for hop {hop_id}: {failure.error}"
        events.record(
            session,
            mission_id,
            "classification_failed",
            message,
            hop_id=hop_id,
            position=events.hop_position(session, mission_id, hop_id),
        )


# Read side ----------------------------------------------------------------------------------


def recent_hops(session: Session, mission_id: str, limit: int) -> list[GroundHop]:
    """The newest hops first, each with its latest classification and that row's raw
    response fields, which the cells and hops endpoints don't return."""
    missions.get_mission(session, mission_id)
    hops = list(
        session.scalars(
            select(HopRow)
            .where(HopRow.mission_id == mission_id)
            .order_by(HopRow.hop_id.desc())
            .limit(limit)
        )
    )
    hop_ids = [h.hop_id for h in hops]
    latest: dict[int, ClassificationRow] = {}
    for row in session.scalars(
        select(ClassificationRow)
        .where(ClassificationRow.mission_id == mission_id)
        .where(ClassificationRow.hop_id.in_(hop_ids))
        .order_by(ClassificationRow.id)
    ):
        latest[row.hop_id] = row
    with_image = set(
        session.scalars(
            select(ImageRow.hop_id)
            .where(ImageRow.mission_id == mission_id)
            .where(ImageRow.hop_id.in_(hop_ids))
        )
    )
    out = []
    for hop in hops:
        position = positions.hop_position(session, mission_id, hop.hop_id)
        row = latest.get(hop.hop_id)
        raw = (row.raw_response if row else None) or {}
        out.append(
            GroundHop(
                hop_id=hop.hop_id,
                x=position[0] if position else None,
                y=position[1] if position else None,
                observed_at=hop.payload["observed_at"],
                status=row.status if row else "none",
                label=row.label if row else None,
                confidence=row.confidence if row else None,
                model_version=row.model_version if row else None,
                captured_at=_number(raw.get("captured_at")),
                age_s=_number(raw.get("age_s")),
                stale=raw.get("stale") if isinstance(raw.get("stale"), bool) else None,
                error=row.error if row else None,
                image_url=f"/api/v1/missions/{mission_id}/hops/{hop.hop_id}/image"
                if hop.hop_id in with_image
                else None,
            )
        )
    return out


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)
