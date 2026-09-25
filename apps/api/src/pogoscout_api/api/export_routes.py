from fastapi import APIRouter
from fastapi.responses import HTMLResponse, JSONResponse, Response

from pogoscout_api.api.deps import SessionDep, http_error
from pogoscout_api.application import missions
from pogoscout_api.application.views import load_mission_data
from pogoscout_api.export.archive import build_archive, cells_csv, hops_csv
from pogoscout_api.export.report import render_report

router = APIRouter(prefix="/api/v1/missions/{mission_id}")
DomainError = (missions.NotFound, missions.Conflict, missions.Invalid)


def _attachment(mission_id: str, name: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="{mission_id}-{name}"'}


@router.get("/export/archive.json")
def export_archive(mission_id: str, session: SessionDep):
    try:
        archive = build_archive(session, mission_id)
    except DomainError as exc:
        raise http_error(exc) from exc
    return JSONResponse(archive, headers=_attachment(mission_id, "archive.json"))


@router.get("/export/hops.csv")
def export_hops(mission_id: str, session: SessionDep):
    try:
        body = hops_csv(load_mission_data(session, mission_id))
    except DomainError as exc:
        raise http_error(exc) from exc
    return Response(body, media_type="text/csv", headers=_attachment(mission_id, "hops.csv"))


@router.get("/export/cells.csv")
def export_cells(mission_id: str, session: SessionDep):
    try:
        body = cells_csv(load_mission_data(session, mission_id))
    except DomainError as exc:
        raise http_error(exc) from exc
    return Response(body, media_type="text/csv", headers=_attachment(mission_id, "cells.csv"))


@router.get("/report", response_class=HTMLResponse)
def report(mission_id: str, session: SessionDep):
    try:
        return HTMLResponse(render_report(load_mission_data(session, mission_id)))
    except DomainError as exc:
        raise http_error(exc) from exc
