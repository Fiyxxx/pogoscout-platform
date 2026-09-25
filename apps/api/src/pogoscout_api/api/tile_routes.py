import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from pogoscout_api.tiles.cache import TileCache, TileNotFound

router = APIRouter(prefix="/api/v1")

# Tiles never change for a given z/x/y; let the browser keep them for a week.
CACHE_HEADERS = {"Cache-Control": "public, max-age=604800, immutable"}


@router.get("/tiles/{layer}/{z}/{x}/{y}")
async def get_tile(layer: str, z: int, x: int, y: int, request: Request) -> Response:
    cache: TileCache = request.app.state.tiles
    try:
        spec = cache.validate(layer, z, x, y)
    except TileNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    cached = cache.path(layer, z, x, y)
    if cached.exists():  # the common case: stream straight from disk
        return FileResponse(cached, media_type=spec.content_type, headers=CACHE_HEADERS)
    try:
        body, content_type = await cache.get(layer, z, x, y)
    except TileNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"tile upstream unavailable: {exc}") from exc
    return Response(body, media_type=content_type, headers=CACHE_HEADERS)
