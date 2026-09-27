from typing import Annotated

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, Field

from pogoscout_api.api.deps import Ctx, SessionDep, http_error
from pogoscout_api.application import ground, missions
from pogoscout_api.application.ground import GroundDemoState, GroundHop, GroundSession

router = APIRouter(prefix="/api/v1/ground-demo")
DomainError = (missions.NotFound, missions.Conflict, missions.Invalid)


class NewGroundSession(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class GroundSessionEdit(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@router.get("", response_model=GroundDemoState)
async def get_ground_demo(ctx: Ctx):
    return await ctx.ground.state()


@router.post("/sessions", response_model=GroundSession, status_code=status.HTTP_201_CREATED)
async def create_ground_session(ctx: Ctx, body: NewGroundSession | None = None):
    """Create a session in a new live mission and start polling the ground service for it."""
    name = body.name.strip() if body and body.name else None
    return await ctx.ground.start(name or None)


@router.post("/sessions/{mission_id}/stop", response_model=GroundSession)
async def stop_ground_session(mission_id: str, ctx: Ctx):
    """Stop polling and mark the mission complete. 404 unless it is a demo session."""
    try:
        return await ctx.ground.stop(mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.patch("/sessions/{mission_id}", response_model=GroundSession)
def edit_ground_session(mission_id: str, body: GroundSessionEdit, ctx: Ctx):
    """Rename a session. 422 on a blank name, 404 unless it is a demo session."""
    try:
        return ctx.ground.rename(mission_id, body.name)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.delete("/sessions/{mission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ground_session(mission_id: str, ctx: Ctx):
    """Stop polling if it still is, then delete the mission and everything recorded for it."""
    try:
        await ctx.ground.delete(mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{mission_id}/hops", response_model=list[GroundHop])
def list_ground_hops(
    mission_id: str, session: SessionDep, limit: Annotated[int, Query(ge=1, le=100)] = 10
):
    """The newest hops first, with each reading's capture time, age and stale mark."""
    try:
        return ground.recent_hops(session, mission_id, limit)
    except DomainError as exc:
        raise http_error(exc) from exc
