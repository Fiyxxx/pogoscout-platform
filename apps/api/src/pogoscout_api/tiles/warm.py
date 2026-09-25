"""Pre-fetch theatre tiles through a running API so first views are instant (and work offline)."""

import asyncio
import math
import time
from collections.abc import Iterable

import httpx

from pogoscout_api.domain.geo import GeoAnchor

# Singapore main island and nearby islands.
SINGAPORE = (103.59, 1.20, 104.06, 1.48)  # west, south, east, north
M_PER_DEG_LAT = 111_320


def tile_xy(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180) / 360 * n)
    lat_r = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tiles_in(
    bbox: tuple[float, float, float, float], zooms: Iterable[int]
) -> set[tuple[int, int, int]]:
    west, south, east, north = bbox
    out = set()
    for z in zooms:
        x0, y0 = tile_xy(west, north, z)
        x1, y1 = tile_xy(east, south, z)
        out |= {(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}
    return out


def grid_to_lonlat(geo: GeoAnchor, x: float, y: float) -> tuple[float, float]:
    """Same convention as the web client: +y along heading, +x 90 degrees clockwise."""
    b = math.radians(geo.heading_deg)
    gx, gy = x * geo.cell_m, y * geo.cell_m
    east = gx * math.cos(b) + gy * math.sin(b)
    north = -gx * math.sin(b) + gy * math.cos(b)
    lat = geo.lat + north / M_PER_DEG_LAT
    lon = geo.lon + east / (M_PER_DEG_LAT * math.cos(math.radians(geo.lat)))
    return lon, lat


def mission_bbox(
    geo: GeoAnchor, cells: list[list], margin_m: float
) -> tuple[float, float, float, float]:
    points = [
        grid_to_lonlat(geo, x + dx, y + dy)
        for x, y, *_ in cells or [[0, 0]]
        for dx in (-0.5, 0.5)
        for dy in (-0.5, 0.5)
    ]
    lons = [p[0] for p in points]
    lats = [p[1] for p in points]
    dlat = margin_m / M_PER_DEG_LAT
    dlon = margin_m / (M_PER_DEG_LAT * math.cos(math.radians(geo.lat)))
    return min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat


def plan(world: dict) -> list[tuple[str, int, int, int]]:
    wanted: set[tuple[str, int, int, int]] = set()
    for layer, zooms in (
        ("imagery", range(9, 15)),
        ("labels", range(9, 15)),
        ("terrain", range(9, 14)),
    ):
        wanted |= {(layer, *t) for t in tiles_in(SINGAPORE, zooms)}
    for item in world["missions"]:
        bbox = mission_bbox(GeoAnchor(**item["geo"]), item["cells"], margin_m=450)
        for layer, zooms in (
            ("imagery", range(15, 19)),
            ("labels", range(15, 19)),
            ("terrain", range(14, 16)),
        ):
            wanted |= {(layer, *t) for t in tiles_in(bbox, zooms)}
    return sorted(wanted, key=lambda t: (t[1], t[0], t[2], t[3]))


async def _warm(
    api: str, tiles: list[tuple[str, int, int, int]], concurrency: int
) -> tuple[int, int]:
    semaphore = asyncio.Semaphore(concurrency)
    failed = 0
    async with httpx.AsyncClient(base_url=api, timeout=30) as client:

        async def one(layer: str, z: int, x: int, y: int) -> None:
            nonlocal failed
            async with semaphore:
                response = await client.get(f"/tiles/{layer}/{z}/{x}/{y}")
                if response.status_code != 200:
                    failed += 1

        await asyncio.gather(*(one(*t) for t in tiles))
    return len(tiles) - failed, failed


def warm_tiles(api: str, concurrency: int = 16) -> None:
    world = httpx.get(f"{api}/world", timeout=30).raise_for_status().json()
    tiles = plan(world)
    started = time.monotonic()
    print(f"warming {len(tiles)} tiles for Singapore and {len(world['missions'])} mission areas")
    ok, failed = asyncio.run(_warm(api, tiles, concurrency))
    print(f"cached {ok} tiles, {failed} unavailable upstream, in {time.monotonic() - started:.1f}s")
