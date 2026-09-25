"""Read-through disk cache for the theatre map's tiles.

The browser asks the platform for tiles instead of the internet. A tile is fetched upstream once,
kept on disk and then served locally, so zooming is fast and a warmed area works offline.
"""

import asyncio
import os
from dataclasses import dataclass
from pathlib import Path

import httpx


@dataclass(frozen=True)
class TileLayer:
    url: str  # upstream template with {z}, {x}, {y}
    content_type: str
    max_zoom: int


LAYERS: dict[str, TileLayer] = {
    "imagery": TileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "image/jpeg",
        19,
    ),
    "labels": TileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        "image/png",
        19,
    ),
    "terrain": TileLayer(
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
        "image/png",
        15,
    ),
}


class TileNotFound(Exception):
    pass


class TileCache:
    def __init__(self, root: Path, timeout_s: float = 10.0) -> None:
        self.root = root
        self.timeout_s = timeout_s
        self._client: httpx.AsyncClient | None = None
        self._inflight: dict[Path, asyncio.Future[bytes]] = {}

    def path(self, layer: str, z: int, x: int, y: int) -> Path:
        return self.root / layer / str(z) / str(x) / str(y)

    def validate(self, layer: str, z: int, x: int, y: int) -> TileLayer:
        spec = LAYERS.get(layer)
        if spec is None or not 0 <= z <= spec.max_zoom or not (0 <= x < 2**z and 0 <= y < 2**z):
            raise TileNotFound(f"no tile {layer}/{z}/{x}/{y}")
        return spec

    async def get(self, layer: str, z: int, x: int, y: int) -> tuple[bytes, str]:
        spec = self.validate(layer, z, x, y)
        path = self.path(layer, z, x, y)
        if path.exists():
            return path.read_bytes(), spec.content_type
        # One upstream request per tile, however many clients ask at once.
        pending = self._inflight.get(path)
        if pending is None:
            pending = asyncio.ensure_future(self._fetch(spec, path, z, x, y))
            self._inflight[path] = pending
            pending.add_done_callback(lambda _: self._inflight.pop(path, None))
        return await asyncio.shield(pending), spec.content_type

    async def _fetch(self, spec: TileLayer, path: Path, z: int, x: int, y: int) -> bytes:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.timeout_s,
                headers={"User-Agent": "PogoScout platform tile cache"},
                limits=httpx.Limits(max_connections=32, max_keepalive_connections=32),
            )
        response = await self._client.get(spec.url.format(z=z, x=x, y=y))
        if response.status_code != 200:
            raise TileNotFound(f"upstream {response.status_code} for {path}")
        body = response.content
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_bytes(body)
        tmp.replace(path)  # atomic: readers never see a half-written tile
        return body

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
