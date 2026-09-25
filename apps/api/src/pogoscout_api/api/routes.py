from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from sqlalchemy.orm import Session

from pogoscout_api.api.schemas import (
    Bounds,
    CellObservation,
    CellOut,
    CellsOut,
    HopOut,
    MissionCreate,
    MissionOut,
    PathPoint,
    Point,
)
from pogoscout_api.application import missions
from pogoscout_api.domain.hops import HopPayload


def get_session(request: Request) -> Iterator[Session]:
    yield from request.app.state.db.session()


SessionDep = Annotated[Session, Depends(get_session)]
HopId = Annotated[int, Path(ge=1)]

router = APIRouter(prefix="/api/v1")


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, missions.NotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    if isinstance(exc, missions.Conflict):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    raise exc


@router.post("/missions", status_code=status.HTTP_201_CREATED, response_model=MissionOut)
def create_mission(body: MissionCreate, session: SessionDep):
    try:
        return missions.create_mission(session, body.name, body.source, body.mission_id)
    except missions.Conflict as exc:
        raise _translate(exc) from exc


@router.get("/missions", response_model=list[MissionOut])
def list_missions(session: SessionDep):
    return missions.list_missions(session)


@router.get("/missions/{mission_id}", response_model=MissionOut)
def get_mission(mission_id: str, session: SessionDep):
    try:
        return missions.get_mission(session, mission_id)
    except missions.NotFound as exc:
        raise _translate(exc) from exc


@router.put("/missions/{mission_id}/hops/{hop_id}", response_model=HopOut)
def put_hop(
    mission_id: str, hop_id: HopId, payload: HopPayload, session: SessionDep, response: Response
):
    try:
        result = missions.ingest_hop(session, mission_id, hop_id, payload)
    except (missions.NotFound, missions.Conflict) as exc:
        raise _translate(exc) from exc
    response.status_code = status.HTTP_201_CREATED if result.outcome == "created" else 200
    return result.row


@router.get("/missions/{mission_id}/hops", response_model=list[HopOut])
def list_hops(mission_id: str, session: SessionDep):
    try:
        return missions.list_hops(session, mission_id)
    except missions.NotFound as exc:
        raise _translate(exc) from exc


@router.get("/missions/{mission_id}/cells", response_model=CellsOut)
def get_cells(mission_id: str, session: SessionDep):
    try:
        projection = missions.project_mission(session, mission_id)
    except missions.NotFound as exc:
        raise _translate(exc) from exc

    xs = [0, *(h.x for h in projection.placed)]
    ys = [0, *(h.y for h in projection.placed)]
    cx, cy = projection.current
    return CellsOut(
        mission_id=mission_id,
        origin=Point(x=0, y=0),
        current=Point(x=cx, y=cy),
        path=[PathPoint(hop_id=h.hop_id, x=h.x, y=h.y) for h in projection.placed],
        pending_hop_ids=projection.pending_hop_ids,
        bounds=Bounds(min_x=min(xs), max_x=max(xs), min_y=min(ys), max_y=max(ys)),
        cells=[
            CellOut(
                x=cell.x,
                y=cell.y,
                visit_count=len(cell.hops),
                hop_ids=[h.hop_id for h in cell.hops],
                metal=cell.metal,
                voc=cell.voc,
                observations=[
                    CellObservation(
                        hop_id=h.hop_id,
                        observed_at=h.payload.observed_at,
                        metal=h.payload.sensors.metal.model_dump(),
                        voc=h.payload.sensors.voc.model_dump(),
                    )
                    for h in cell.hops
                ],
            )
            for cell in sorted(projection.cells.values(), key=lambda c: (c.y, c.x))
        ],
    )
