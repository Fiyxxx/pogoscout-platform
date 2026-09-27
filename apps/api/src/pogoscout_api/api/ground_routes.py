from typing import Annotated

from fastapi import APIRouter, Query

from pogoscout_api.api.deps import Ctx, SessionDep, http_error
from pogoscout_api.application import ground, missions
from pogoscout_api.application.ground import GroundDemoState, GroundHop

router = APIRouter(prefix="/api/v1/ground-demo")
DomainError = (missions.NotFound, missions.Conflict, missions.Invalid)


@router.get("", response_model=GroundDemoState)
async def get_ground_demo(ctx: Ctx):
    return await ctx.ground.state()


@router.post("/start", response_model=GroundDemoState)
async def start_ground_demo(ctx: Ctx):
    """Start a new run in a new mission. 409 while one runs, or when the demo is off."""
    try:
        return await ctx.ground.start()
    except DomainError as exc:
        raise http_error(exc) from exc


@router.post("/stop", response_model=GroundDemoState)
async def stop_ground_demo(ctx: Ctx):
    return await ctx.ground.stop()


@router.get("/{mission_id}/hops", response_model=list[GroundHop])
def list_ground_hops(
    mission_id: str, session: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 10
):
    """The newest hops first, with each reading's capture time, age and stale mark."""
    try:
        return ground.recent_hops(session, mission_id, limit)
    except DomainError as exc:
        raise http_error(exc) from exc
