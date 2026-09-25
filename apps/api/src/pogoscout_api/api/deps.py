from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, HTTPException, Path, Request, status
from sqlalchemy.orm import Session

from pogoscout_api.application import missions
from pogoscout_api.context import AppContext


def get_ctx(request: Request) -> AppContext:
    return request.app.state.ctx


def get_session(request: Request) -> Iterator[Session]:
    yield from request.app.state.ctx.db.session()


Ctx = Annotated[AppContext, Depends(get_ctx)]
SessionDep = Annotated[Session, Depends(get_session)]
HopId = Annotated[int, Path(ge=1)]


def http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, missions.NotFound):
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    if isinstance(exc, missions.Conflict):
        return HTTPException(status.HTTP_409_CONFLICT, str(exc))
    if isinstance(exc, missions.Invalid):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))
    raise exc
