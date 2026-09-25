"""`WS /api/v1/missions/{mission_id}/live`: change notifications plus periodic pings."""

import asyncio
import contextlib

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from pogoscout_api.context import AppContext
from pogoscout_api.persistence.db import MissionRow

router = APIRouter(prefix="/api/v1")


@router.websocket("/missions/{mission_id}/live")
async def mission_live(websocket: WebSocket, mission_id: str) -> None:
    ctx: AppContext = websocket.app.state.ctx
    with ctx.db.session_scope() as session:
        exists = session.get(MissionRow, mission_id) is not None
    await websocket.accept()
    if not exists:
        await websocket.close(code=4404, reason="mission not found")
        return
    subscriber = ctx.hub.subscribe(mission_id)

    async def send() -> None:
        while True:
            try:
                message = await asyncio.wait_for(
                    subscriber.queue.get(), timeout=ctx.config.live_ping_s
                )
            except TimeoutError:
                message = {"type": "ping"}
            await websocket.send_json(message)

    async def receive() -> None:
        while True:
            incoming = await websocket.receive()
            if incoming["type"] == "websocket.disconnect":
                return

    tasks = [asyncio.create_task(send()), asyncio.create_task(receive())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, RuntimeError):
                await task
        ctx.hub.unsubscribe(mission_id, subscriber)
