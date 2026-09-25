from typing import Annotated

from fastapi import APIRouter, File, Form, Query, Response, UploadFile, status
from fastapi.responses import FileResponse

from pogoscout_api.api.deps import Ctx, HopId, SessionDep, http_error
from pogoscout_api.api.schemas import (
    CellsResponse,
    EventOut,
    HopOut,
    ImageRecord,
    MissionCreate,
    MissionPatch,
    MissionSummary,
)
from pogoscout_api.application import events, images, missions, views
from pogoscout_api.domain.hops import HopPayload

router = APIRouter(prefix="/api/v1")
DomainError = (missions.NotFound, missions.Conflict, missions.Invalid)


@router.post("/missions", status_code=status.HTTP_201_CREATED, response_model=MissionSummary)
def create_mission(body: MissionCreate, session: SessionDep, ctx: Ctx):
    try:
        row = missions.create_mission(
            session, body.name, body.source, body.mission_id, notifier=ctx.hub
        )
    except DomainError as exc:
        raise http_error(exc) from exc
    return views.mission_summary(session, row.id)


@router.get("/missions", response_model=list[MissionSummary])
def list_missions(session: SessionDep):
    return [views.mission_summary(session, m.id) for m in missions.list_missions(session)]


@router.get("/missions/{mission_id}", response_model=MissionSummary)
def get_mission(mission_id: str, session: SessionDep):
    try:
        return views.mission_summary(session, mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.patch("/missions/{mission_id}", response_model=MissionSummary)
def patch_mission(mission_id: str, body: MissionPatch, session: SessionDep, ctx: Ctx):
    try:
        missions.set_status(session, mission_id, body.status, body.status_note, notifier=ctx.hub)
    except DomainError as exc:
        raise http_error(exc) from exc
    if body.status != "live":
        mission = missions.get_mission(session, mission_id)
        if mission.scenario_id is not None:
            ctx.replay.pause(mission_id)
    return views.mission_summary(session, mission_id)


@router.put("/missions/{mission_id}/hops/{hop_id}", response_model=HopOut)
def put_hop(
    mission_id: str,
    hop_id: HopId,
    payload: HopPayload,
    session: SessionDep,
    response: Response,
    ctx: Ctx,
):
    try:
        result = missions.ingest_hop(session, mission_id, hop_id, payload, notifier=ctx.hub)
    except DomainError as exc:
        raise http_error(exc) from exc
    response.status_code = status.HTTP_201_CREATED if result.outcome == "created" else 200
    return result.row


@router.get("/missions/{mission_id}/hops", response_model=list[HopOut])
def list_hops(mission_id: str, session: SessionDep):
    try:
        return missions.list_hops(session, mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.put("/missions/{mission_id}/hops/{hop_id}/image", response_model=ImageRecord)
def put_image(
    mission_id: str,
    hop_id: HopId,
    file: Annotated[UploadFile, File()],
    session: SessionDep,
    response: Response,
    ctx: Ctx,
    label_hint: Annotated[str | None, Form()] = None,
    confidence_hint: Annotated[float | None, Form()] = None,
):
    limit = ctx.config.max_image_bytes
    data = file.file.read(limit + 1)
    try:
        result = images.store_image(
            session,
            ctx.store,
            mission_id,
            hop_id,
            data,
            file.content_type,
            max_bytes=limit,
            label_hint=label_hint or None,
            confidence_hint=confidence_hint,
            notifier=ctx.hub,
        )
    except DomainError as exc:
        raise http_error(exc) from exc
    response.status_code = status.HTTP_201_CREATED if result.outcome == "created" else 200
    return views.image_record(result.row)


@router.get("/missions/{mission_id}/hops/{hop_id}/image", response_class=FileResponse)
def get_image(mission_id: str, hop_id: HopId, session: SessionDep, ctx: Ctx):
    try:
        row = images.get_image(session, mission_id, hop_id)
    except DomainError as exc:
        raise http_error(exc) from exc
    path = ctx.store.absolute(row.path)
    if not path.is_file():
        raise http_error(missions.NotFound(f"screenshot file for hop {hop_id} is missing"))
    return FileResponse(
        path,
        media_type=row.content_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable", "ETag": row.sha256},
    )


@router.get("/missions/{mission_id}/cells", response_model=CellsResponse)
def get_cells(mission_id: str, session: SessionDep):
    try:
        return views.mission_cells(session, mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc


@router.get("/missions/{mission_id}/events", response_model=list[EventOut])
def get_events(
    mission_id: str, session: SessionDep, limit: Annotated[int, Query(ge=1, le=5000)] = 200
):
    try:
        missions.get_mission(session, mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc
    return events.list_events(session, mission_id, limit)
