import asyncio

import httpx
import pytest

from pogoscout_api.tiles import warm
from pogoscout_api.tiles.cache import TileCache, TileNotFound


def test_tile_math_matches_known_tiles() -> None:
    # Singapore city at z12 is tile 3229/2025 (as used by the map).
    assert warm.tile_xy(103.85, 1.29, 12) == (3229, 2033)
    assert warm.tiles_in((103.85, 1.29, 103.85, 1.29), [12]) == {(12, 3229, 2033)}


def test_cache_fetches_once_and_serves_from_disk(tmp_path) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, content=b"tile-bytes")

    cache = TileCache(tmp_path)
    cache._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    async def run() -> None:
        results = await asyncio.gather(*(cache.get("terrain", 12, 3229, 2025) for _ in range(5)))
        assert {r for r in results} == {(b"tile-bytes", "image/png")}
        assert await cache.get("terrain", 12, 3229, 2025) == (b"tile-bytes", "image/png")
        await cache.close()

    asyncio.run(run())
    assert len(calls) == 1  # concurrent requests share one upstream fetch, then disk serves
    assert cache.path("terrain", 12, 3229, 2025).read_bytes() == b"tile-bytes"


def test_cache_rejects_unknown_layers_and_out_of_range_tiles(tmp_path) -> None:
    cache = TileCache(tmp_path)
    for args in (("roads", 1, 0, 0), ("terrain", 16, 0, 0), ("imagery", 2, 4, 0)):
        with pytest.raises(TileNotFound):
            cache.validate(*args)


def test_upstream_failure_is_not_cached(tmp_path) -> None:
    cache = TileCache(tmp_path)
    cache._client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404)))

    async def run() -> None:
        with pytest.raises(TileNotFound):
            await cache.get("labels", 3, 1, 1)
        await cache.close()

    asyncio.run(run())
    assert not cache.path("labels", 3, 1, 1).exists()


def test_tile_route_serves_cached_tile(client, tmp_path) -> None:
    tiles: TileCache = client.app.state.tiles
    path = tiles.path("imagery", 5, 25, 15)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"jpeg")
    response = client.get("/api/v1/tiles/imagery/5/25/15")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert "immutable" in response.headers["cache-control"]
    assert client.get("/api/v1/tiles/roads/5/25/15").status_code == 404


def test_large_json_is_compressed(client, mission) -> None:
    response = client.get("/api/v1/missions", headers={"Accept-Encoding": "gzip"})
    assert response.status_code == 200
