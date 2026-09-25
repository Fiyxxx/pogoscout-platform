"""Replay engine: step or timed play of a scenario into a mission.

Events go through the same application services as the HTTP endpoints; the cursor is persisted
on the mission, while play state (playing, speed) lives in memory with one asyncio task each.
"""

import asyncio
import contextlib
import threading
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy.orm import Session

from pogoscout_api.api.schemas import ReplayState, ScenarioInfo
from pogoscout_api.application import images, missions
from pogoscout_api.application.notify import Notifier
from pogoscout_api.config import Settings
from pogoscout_api.domain.geo import GeoAnchor
from pogoscout_api.evidence.store import ImageStore
from pogoscout_api.persistence.db import Database, MissionRow
from pogoscout_api.replay.generate import render_mock_image
from pogoscout_api.replay.scenario import HopEvent, ImageEvent, Scenario, load_scenario
from pogoscout_api.replay.sites import SCENARIO_SITES


@dataclass
class _Run:
    playing: bool = False
    speed: int = 1
    task: asyncio.Task | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)  # one applier at a time


class ReplayManager:
    def __init__(
        self, db: Database, store: ImageStore, config: Settings, notifier: Notifier
    ) -> None:
        self.db = db
        self.store = store
        self.config = config
        self.notifier = notifier
        self._scenarios: dict[str, Scenario] = {}
        self._runs: dict[str, _Run] = {}

    # Scenarios -----------------------------------------------------------------------------

    def _directory(self, scenario_id: str) -> Path:
        return self.config.fixture_dir / scenario_id

    def scenario(self, scenario_id: str) -> Scenario:
        if scenario_id not in self._scenarios:
            directory = self._directory(scenario_id)
            if "/" in scenario_id or not (directory / "scenario.json").is_file():
                raise missions.NotFound(f"scenario {scenario_id} not found")
            self._scenarios[scenario_id] = load_scenario(directory)
        return self._scenarios[scenario_id]

    def list_scenarios(self) -> list[ScenarioInfo]:
        root = self.config.fixture_dir
        found = sorted(p.parent.name for p in root.glob("*/scenario.json")) if root.is_dir() else []
        infos = []
        for scenario_id in found:
            scenario = self.scenario(scenario_id)
            hop_ids = {e.hop_id for e in scenario.events if isinstance(e, HopEvent)}
            infos.append(
                ScenarioInfo(
                    scenario_id=scenario_id,
                    description=scenario.description,
                    hops=len(hop_ids),
                    events=len(scenario.events),
                )
            )
        return infos

    # Missions ------------------------------------------------------------------------------

    def create(
        self,
        session: Session,
        scenario_id: str,
        mission_id: str | None,
        name: str | None,
        geo: GeoAnchor | None = None,
    ) -> MissionRow:
        scenario = self.scenario(scenario_id)
        return missions.create_mission(
            session,
            name or scenario.mission.name,
            "mock",
            mission_id,
            scenario_id=scenario_id,
            geo=geo or SCENARIO_SITES.get(scenario_id),
            notifier=self.notifier,
        )

    def _mission(self, session: Session, mission_id: str) -> tuple[MissionRow, Scenario]:
        mission = missions.get_mission(session, mission_id)
        if mission.scenario_id is None:
            raise missions.NotFound(f"mission {mission_id} is not a replay")
        return mission, self.scenario(mission.scenario_id)

    def _state(self, mission: MissionRow, scenario: Scenario) -> ReplayState:
        run = self._runs.get(mission.id, _Run())
        total = len(scenario.events)
        return ReplayState(
            scenario_id=scenario.scenario_id,
            cursor=mission.replay_cursor,
            total=total,
            playing=run.playing,
            speed=run.speed,
            finished=mission.replay_cursor >= total,
        )

    def _run(self, mission_id: str) -> _Run:
        return self._runs.setdefault(mission_id, _Run())

    def state(self, mission_id: str) -> ReplayState:
        with self.db.session_scope() as session:
            return self._state(*self._mission(session, mission_id))

    # Stepping ------------------------------------------------------------------------------

    def _apply(self, session: Session, scenario: Scenario, mission_id: str, index: int) -> None:
        event = scenario.events[index]
        try:
            if isinstance(event, HopEvent):
                missions.ingest_hop(
                    session, mission_id, event.hop_id, event.payload, notifier=self.notifier
                )
            elif isinstance(event, ImageEvent):
                if event.file is None:  # generated: rendered in memory, never committed
                    data = render_mock_image(
                        scenario.scenario_id,
                        event.hop_id,
                        event.mock_label,
                        scenario.seed,
                        optimize=False,
                    )
                    content_type = "image/png"
                else:
                    data = (self._directory(scenario.scenario_id) / event.file).read_bytes()
                    content_type = "image/png" if event.file.endswith(".png") else "image/jpeg"
                images.store_image(
                    session,
                    self.store,
                    mission_id,
                    event.hop_id,
                    data,
                    content_type,
                    max_bytes=self.config.max_image_bytes,
                    label_hint=event.mock_label,
                    confidence_hint=event.mock_confidence,
                    notifier=self.notifier,
                )
        except (missions.Conflict, missions.Invalid):
            session.rollback()  # recorded by the service as evidence; the replay carries on

    def step(self, mission_id: str) -> ReplayState:
        return self.advance(mission_id, 1)

    def advance(self, mission_id: str, count: int) -> ReplayState:
        """Apply up to `count` events now, in order, each through the application services."""
        run = self._run(mission_id)
        with run.lock, self.db.session_scope() as session:
            mission, scenario = self._mission(session, mission_id)
            total = len(scenario.events)
            end = min(total, mission.replay_cursor + max(0, count))
            applied = mission.replay_cursor < end
            while mission.replay_cursor < end:
                # The cursor moves in the same transaction as the event it applies.
                cursor = mission.replay_cursor
                mission.replay_cursor = cursor + 1
                self._apply(session, scenario, mission_id, cursor)
                mission = missions.get_mission(session, mission_id)
                if mission.replay_cursor != cursor + 1:  # the event was rolled back
                    mission.replay_cursor = cursor + 1
                session.commit()
            if applied and mission.replay_cursor >= total and mission.status == "live":
                missions.set_status(session, mission_id, "complete", notifier=self.notifier)
            self.notifier.publish(mission_id, ["replay", "mission"])
            return self._state(mission, scenario)

    # Timed play ----------------------------------------------------------------------------

    def play(self, mission_id: str, speed: int) -> ReplayState:
        """Start or re-speed timed play. Must be called from the event loop."""
        state = self.state(mission_id)
        run = self._run(mission_id)
        run.speed = speed
        if not state.finished and not run.playing:
            run.playing = True
            run.task = asyncio.create_task(self._play(mission_id), name=f"replay-{mission_id}")
        self.notifier.publish(mission_id, ["replay"])
        return self.state(mission_id)

    def pause(self, mission_id: str) -> ReplayState:
        self.state(mission_id)  # validates the mission
        run = self._runs.get(mission_id)
        if run is not None and run.playing:
            run.playing = False
            if run.task is not None:  # may be called from a worker thread (PATCH route)
                run.task.get_loop().call_soon_threadsafe(run.task.cancel)
        self.notifier.publish(mission_id, ["replay"])
        return self.state(mission_id)

    async def _play(self, mission_id: str) -> None:
        run = self._runs[mission_id]
        try:
            while run.playing:
                with self.db.session_scope() as session:
                    mission, scenario = self._mission(session, mission_id)
                    cursor = mission.replay_cursor
                if cursor >= len(scenario.events):
                    break
                previous = scenario.events[cursor - 1].at_ms if cursor > 0 else 0
                delta_ms = max(0, scenario.events[cursor].at_ms - previous)
                await asyncio.sleep(delta_ms / 1000 / run.speed)
                if not run.playing:
                    break
                self.step(mission_id)
        finally:
            run.playing = False
            run.task = None
            self.notifier.publish(mission_id, ["replay"])

    async def shutdown(self) -> None:
        tasks = [r.task for r in self._runs.values() if r.task is not None]
        for run in self._runs.values():
            run.playing = False
        for task in tasks:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
