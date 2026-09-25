from fastapi import APIRouter, status

from pogoscout_api.api.deps import Ctx, SessionDep, http_error
from pogoscout_api.api.schemas import (
    MissionSummary,
    ReplayCreate,
    ReplayPlay,
    ReplayState,
    ScenarioInfo,
)
from pogoscout_api.application import missions, views

router = APIRouter(prefix="/api/v1")
DomainError = (missions.NotFound, missions.Conflict, missions.Invalid)


@router.get("/scenarios", response_model=list[ScenarioInfo])
def list_scenarios(ctx: Ctx):
    return ctx.replay.list_scenarios()


@router.post("/replays", status_code=status.HTTP_201_CREATED, response_model=MissionSummary)
def create_replay(body: ReplayCreate, session: SessionDep, ctx: Ctx):
    try:
        row = ctx.replay.create(session, body.scenario_id, body.mission_id, body.name)
    except DomainError as exc:
        raise http_error(exc) from exc
    return views.mission_summary(session, row.id)


@router.get("/missions/{mission_id}/replay", response_model=ReplayState)
async def get_replay(mission_id: str, ctx: Ctx):
    try:
        return ctx.replay.state(mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.post("/missions/{mission_id}/replay/step", response_model=ReplayState)
async def step_replay(mission_id: str, ctx: Ctx):
    try:
        return ctx.replay.step(mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.post("/missions/{mission_id}/replay/play", response_model=ReplayState)
async def play_replay(mission_id: str, ctx: Ctx, body: ReplayPlay | None = None):
    try:
        return ctx.replay.play(mission_id, (body or ReplayPlay()).speed)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.post("/missions/{mission_id}/replay/pause", response_model=ReplayState)
async def pause_replay(mission_id: str, ctx: Ctx):
    try:
        return ctx.replay.pause(mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc
