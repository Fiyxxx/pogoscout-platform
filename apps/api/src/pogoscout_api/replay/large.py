"""Large deterministic fixtures: thousands of hops with generated (not committed) screenshots.

district_sweep_v1  48 x 40 Singapore-style district, boustrophedon rows along x, ~2000 hops
canal_corridor_v1  8 x 150 corridor along a canal, serpentine across the width, ~1200 hops
jungle_patrol_v1   44 x 32 rainforest patrol with a stream, trail, swamp and clearing, ~1400 hops

Terrain comes from seeded value noise; every choice draws from a seeded `random.Random`, so the
same seed gives a byte-identical scenario.json and expected_projection.json.
"""

import math
import random
from collections.abc import Callable
from pathlib import Path

from pogoscout_api.domain.hops import MOVEMENT_VECTORS
from pogoscout_api.replay.generate import (
    HOP_INTERVAL_MS,
    IMAGE_DELAY_MS,
    OK0,
    OK1,
    FixtureBuilder,
    Reading,
)
from pogoscout_api.replay.terrain import ellipse_distance, fractal_noise, in_rect, value_noise

Grid = dict[tuple[int, int], str]
OPPOSITE = {"R": "L", "L": "R", "F": "B", "B": "F"}
NATURAL = {"soil", "mud", "sand", "gravel", "grass_vegetation", "leaf_litter", "water"}


# Shared helpers -------------------------------------------------------------------------------


def boustrophedon(
    width: int,
    height: int,
    *,
    backtracks: dict[tuple[int, int], int] | None = None,
    obstacles: set[tuple[int, int]] | None = None,
) -> str:
    """Rows along x from the origin, stepping F between rows.

    backtracks: {(x, y): n} on reaching (x, y) go back n cells and return (revisits).
    obstacles:  {(x, y)} of the cell just ahead; the scout sidesteps through the next row
                (F, ahead, ahead, B), leaving the obstacle cell unvisited.
    """
    backtracks = backtracks or {}
    obstacles = obstacles or set()
    commands: list[str] = []
    x = 0
    for row in range(height):
        step = "R" if row % 2 == 0 else "L"
        dx = MOVEMENT_VECTORS[step][0]
        if row > 0:
            commands.append("F")
        end = width - 1 if dx == 1 else 0
        while x != end:
            n = backtracks.get((x, row))
            if n:
                commands += [OPPOSITE[step]] * n + [step] * n
            if (x + dx, row) in obstacles:
                commands += ["F", step, step, "B"]
                x += 2 * dx
                continue
            commands.append(step)
            x += dx
    return "".join(commands)


def walk(commands: str) -> list[tuple[int, int]]:
    x = y = 0
    out = []
    for command in commands:
        dx, dy = MOVEMENT_VECTORS[command]
        x, y = x + dx, y + dy
        out.append((x, y))
    return out


def boundary_cells(grid: Grid, counts: Callable[[str, str], bool]) -> set[tuple[int, int]]:
    """Cells with a 4-neighbour of a different material where `counts(a, b)` holds."""
    out = set()
    for (x, y), label in grid.items():
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            other = grid.get((nx, ny))
            if other is not None and other != label and counts(label, other):
                out.add((x, y))
                break
    return out


def neighbour_labels(grid: Grid, x: int, y: int) -> list[str]:
    own = grid[(x, y)]
    found = []
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        other = grid.get((nx, ny))
        if other is not None and other != own and other not in found:
            found.append(other)
    return found


def pick_near(
    rng: random.Random,
    centre: tuple[int, int],
    radius: int,
    count: int,
    allowed: set[tuple[int, int]],
    taken: set[tuple[int, int]],
) -> set[tuple[int, int]]:
    cx, cy = centre
    candidates = sorted(
        (x, y)
        for x in range(cx - radius, cx + radius + 1)
        for y in range(cy - radius, cy + radius + 1)
        if (x, y) in allowed and (x, y) not in taken
    )
    chosen = set(rng.sample(candidates, count))
    taken |= chosen
    return chosen


class SurveyPlan:
    """Per-hop truth for a large survey, emitted in arrival order with injected faults."""

    def __init__(
        self,
        builder: FixtureBuilder,
        commands: str,
        grid: Grid,
        metal: set[tuple[int, int]],
        voc: set[tuple[int, int]],
        soft: set[tuple[int, int]],
        rng: random.Random,
        *,
        confusion: float,
    ) -> None:
        self.b = builder
        self.commands = commands
        self.positions = walk(commands)
        self.grid = grid
        self.metal = metal
        self.voc = voc
        self.soft = soft
        self.rng = rng
        self.confusion = confusion
        self.sensor_faults: dict[int, tuple[str, Reading]] = {}
        self.no_image: set[int] = set()
        self.out_of_order: int | None = None  # hop k arrives after hop k + 1
        self.duplicate: int | None = None

    @property
    def hop_count(self) -> int:
        return len(self.commands)

    def choose_faults(
        self, errors: int, missing: int, no_image: int, *, out_of_order: bool, duplicate: bool
    ) -> None:
        """Faults avoid detection cells so the anomaly counts stay exact."""
        quiet = [
            h
            for h in range(2, self.hop_count)
            if self.positions[h - 1] not in self.metal and self.positions[h - 1] not in self.voc
        ]
        picked = self.rng.sample(quiet, errors + missing + no_image + 4)
        for hop in picked[:errors]:
            self.sensor_faults[hop] = (self.rng.choice(("metal", "voc")), (None, "error"))
        for hop in picked[errors : errors + missing]:
            self.sensor_faults[hop] = (self.rng.choice(("metal", "voc")), (None, "missing"))
        self.no_image = set(picked[errors + missing : errors + missing + no_image])
        spare = sorted(h for h in picked[-4:] if h + 1 < self.hop_count)
        assert len(spare) >= 2 and spare[1] > spare[0] + 1
        if out_of_order:
            self.out_of_order = spare[0]
        if duplicate:
            self.duplicate = spare[1]

    def readings(self, hop: int) -> tuple[Reading, Reading]:
        cell = self.positions[hop - 1]
        metal = OK1 if cell in self.metal else OK0
        voc = OK1 if cell in self.voc else OK0
        fault = self.sensor_faults.get(hop)
        if fault is not None:
            sensor, reading = fault
            metal, voc = (reading, voc) if sensor == "metal" else (metal, reading)
        return metal, voc

    def label_and_confidence(self, hop: int) -> tuple[str, float]:
        cell = self.positions[hop - 1]
        label = self.grid[cell]
        if cell in self.soft:
            confidence = round(self.rng.uniform(0.58, 0.79), 2)
            others = neighbour_labels(self.grid, *cell)
            if others and self.rng.random() < self.confusion:
                label = self.rng.choice(others)  # the classifier is fooled at the edge
        else:
            confidence = round(self.rng.uniform(0.82, 0.97), 2)
        return label, confidence

    def emit(self) -> None:
        def ms(hop: int, offset: int = 0) -> int:
            return (hop - 1) * HOP_INTERVAL_MS + offset

        def send(hop: int, at_ms: int) -> dict:
            metal, voc = self.readings(hop)
            return self.b.hop(hop, self.commands[hop - 1], at_ms=at_ms, metal=metal, voc=voc)

        def image(hop: int, at_ms: int) -> None:
            label, confidence = self.label_and_confidence(hop)
            if hop not in self.no_image:
                self.b.image(hop, at_ms, label, confidence, generate=True)

        hop = 1
        while hop <= self.hop_count:
            if hop == self.out_of_order:
                late, early = hop, hop + 1
                send(early, ms(early))
                image(early, ms(early, IMAGE_DELAY_MS))
                send(late, ms(early, 1000))
                image(late, ms(early, 1600))
                hop += 2
                continue
            payload = send(hop, ms(hop))
            image(hop, ms(hop, IMAGE_DELAY_MS))
            if hop == self.duplicate:
                self.b.send(hop, ms(hop, 1200), payload)  # identical resend after a link blip
            hop += 1


# district_sweep_v1 ----------------------------------------------------------------------------

DISTRICT_W, DISTRICT_H = 48, 40
DISTRICT_BACKTRACKS: dict[tuple[int, int], int] = {
    # short backtracks to re-check a reading
    (10, 3): 2,
    (40, 7): 3,
    (5, 11): 2,
    (25, 15): 3,
    (14, 23): 2,
    (3, 26): 2,
    (44, 27): 3,
    (8, 29): 2,
    (20, 33): 3,
    (38, 37): 2,
    # re-crossing the vertical road (x 30-31) and its footpaths
    (28, 5): 4,
    (33, 12): 4,
    (33, 24): 4,
    (28, 31): 4,
    (33, 36): 4,
}
# Cells blocked on the pass along their row: a parked car, a park tree, a lamp post, a tree.
DISTRICT_OBSTACLES = {(40, 8), (8, 25), (41, 30), (23, 34)}


BUILT_ZONES = {"road", "footpath", "plaza"}


def district_cell(x: int, y: int, seed: int) -> tuple[str, str]:
    """(zone, material) for a Singapore-style district. Roads and plaza have built edges."""
    if 18 <= y <= 20 or 30 <= x <= 31:
        return "road", "asphalt"
    if y in (17, 21) or x in (29, 32):
        return "footpath", "tiles_pavers"  # along both sides of both roads
    if 34 <= x <= 46 and 24 <= y <= 36:
        inlay = x in (37, 43) or y in (27, 33)
        return "plaza", "tiles_pavers" if inlay else "concrete"
    if in_rect(x, y, (34, 46, 2, 14), seed=seed + 1):
        return "car_park", "gravel"
    if in_rect(x, y, (2, 16, 2, 14), seed=seed + 2):
        puddle = min(
            ellipse_distance(x, y, 6, 5, 1.6, 1.3), ellipse_distance(x, y, 12, 10, 1.3, 1.1)
        )
        if puddle < 1:
            return "puddle", "water"
        laterite = "mud" if fractal_noise(x, y, 4, seed + 3) > 0.6 else "soil"
        return "construction", laterite
    if x < 29 and y > 21:  # park
        pond = ellipse_distance(x, y, 11, 31, 5.2, 3.4)
        wobble = (value_noise(x, y, 2.5, seed + 4) - 0.5) * 0.5
        if pond + wobble * 0.4 < 1:
            return "pond", "water"
        if pond + wobble < 1.45:
            return "pond", "mud"  # ringed by mud
        if in_rect(x, y, (20, 26, 26, 31), seed=seed + 5, jitter=0.8):
            return "playground", "sand"
        if fractal_noise(x, y, 5, seed + 6) > 0.62:
            return "park", "leaf_litter"  # under tree clusters
        return "park", "grass_vegetation"
    return "open", "grass_vegetation" if fractal_noise(x, y, 6, seed + 7) > 0.5 else "soil"


def district_material(x: int, y: int, seed: int) -> str:
    return district_cell(x, y, seed)[1]


def zone_boundaries(zones: Grid) -> set[tuple[int, int]]:
    """Cells on an edge between two unbuilt zones: where a classifier plausibly hesitates.

    Edges against roads, footpaths and the plaza are crisp and stay confident.
    """
    return boundary_cells(zones, lambda a, c: a not in BUILT_ZONES and c not in BUILT_ZONES)


def build_district_sweep(out_dir: Path, seed: int = 925) -> None:
    b = FixtureBuilder("district_sweep_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = boustrophedon(
        DISTRICT_W, DISTRICT_H, backtracks=DISTRICT_BACKTRACKS, obstacles=DISTRICT_OBSTACLES
    )
    visited = set(walk(commands))
    cells = {
        (x, y): district_cell(x, y, seed) for x in range(DISTRICT_W) for y in range(DISTRICT_H)
    }
    grid = {cell: material for cell, (_, material) in cells.items()}
    soft = zone_boundaries({cell: zone for cell, (zone, _) in cells.items()}) & visited

    taken: set[tuple[int, int]] = set()
    metal: set[tuple[int, int]] = set()
    for centre, count in (((6, 6), 5), ((13, 11), 5), ((38, 5), 4), ((44, 11), 4)):
        metal |= pick_near(rng, centre, 2, count, visited, taken)
    open_ground = sorted(visited - taken)
    for cell in rng.sample(open_ground, 7):
        metal.add(cell)
        taken.add(cell)
    voc: set[tuple[int, int]] = set()
    for centre, count in (((33, 28), 3), ((46, 36), 3), ((28, 34), 3), ((10, 22), 3)):
        voc |= pick_near(rng, centre, 2, count, visited, taken)

    plan = SurveyPlan(b, commands, grid, metal, voc, soft, rng, confusion=0.3)
    hops = plan.hop_count
    plan.choose_faults(
        errors=round(hops * 0.01),
        missing=round(hops * 0.005),
        no_image=round(hops * 0.005),
        out_of_order=True,
        duplicate=True,
    )
    plan.emit()
    b.write_large(
        f"District sweep, {DISTRICT_W} x {DISTRICT_H} cells in lawnmower rows with detours and "
        f"revisits ({hops} hops): roads, footpaths, plaza, car park, park with pond, playground "
        f"and a construction patch. {len(metal)} metal anomalies, {len(voc)} VOC cues, "
        "sensor errors, missing readings and screenshots, an out-of-order pair and a duplicate. "
        "Screenshots are generated at replay time.",
        "District sweep",
    )


# canal_corridor_v1 ----------------------------------------------------------------------------

CANAL_W, CANAL_L = 8, 150
CULVERTS = (15, 45, 75, 105, 135)


def canal_material(x: int, y: int, seed: int) -> str:
    """East side canal (water + concrete edge), a paver park connector, then a grass verge."""
    water_width = 2 if fractal_noise(0, y, 14, seed) > 0.6 else 1
    edge = CANAL_W - 1 - water_width
    if x > edge:
        return "water"
    near_culvert = min(abs(y - c) for c in CULVERTS)
    if x == edge or (near_culvert == 0 and x >= edge - 1):
        return "concrete"  # canal edge and culvert headwalls
    path = 2 + (1 if value_noise(0, y, 20, seed + 1) > 0.5 else 0)
    if path <= x <= path + 1:
        return "tiles_pavers"
    if near_culvert <= 2 and x >= edge - 2 and value_noise(x, y, 2, seed + 2) > 0.35:
        return "mud"  # outlet splash zone
    if x < path:
        if fractal_noise(x, y, 5, seed + 3) > 0.64:
            return "leaf_litter"  # under the tree line
        if value_noise(x, y, 3, seed + 4) > 0.86:
            return "mud"
        if value_noise(x, y, 4, seed + 5) > 0.85:
            return "gravel"
    return "grass_vegetation"


def build_canal_corridor(out_dir: Path, seed: int = 924) -> None:
    b = FixtureBuilder("canal_corridor_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = boustrophedon(CANAL_W, CANAL_L)
    visited = set(walk(commands))
    grid = {(x, y): canal_material(x, y, seed) for x in range(CANAL_W) for y in range(CANAL_L)}
    # Organic edges are ambiguous; the built canal edge and path edges are not.
    soft = {
        cell
        for cell in boundary_cells(grid, lambda a, c: a in NATURAL and c in NATURAL)
        if cell in visited and rng.random() < 0.6
    }

    taken: set[tuple[int, int]] = set()
    metal: set[tuple[int, int]] = set()
    for culvert in CULVERTS[:4]:
        metal |= pick_near(rng, (5, culvert), 2, 2, visited, taken)
    for cell in rng.sample(sorted(visited - taken), 2):
        metal.add(cell)
        taken.add(cell)
    voc: set[tuple[int, int]] = set()
    for culvert in (CULVERTS[1], CULVERTS[4]):
        voc |= pick_near(rng, (4, culvert), 2, 2, visited, taken)
    for cell in rng.sample(sorted(visited - taken), 2):
        voc.add(cell)
        taken.add(cell)

    plan = SurveyPlan(b, commands, grid, metal, voc, soft, rng, confusion=0.25)
    hops = plan.hop_count
    plan.choose_faults(errors=6, missing=3, no_image=4, out_of_order=False, duplicate=False)
    plan.emit()
    b.write_large(
        f"Canal corridor survey, {CANAL_W} cells wide by {CANAL_L} long ({hops} hops), "
        "serpentine across the width: concrete canal edge and water to the east, paver park "
        f"connector, grass verge and leaf litter. {len(metal)} metal anomalies (mostly by "
        f"culvert outlets), {len(voc)} VOC cues. Screenshots are generated at replay time.",
        "Canal corridor survey",
    )


# jungle_patrol_v1 -----------------------------------------------------------------------------

JUNGLE_W, JUNGLE_H = 44, 32
JUNGLE_BACKTRACKS: dict[tuple[int, int], int] = {(9, 6): 2, (24, 15): 3, (34, 22): 3, (12, 25): 2}
# Fallen trees across the row.
JUNGLE_OBSTACLES = {(18, 10), (30, 27), (5, 19)}
FORD = (25, 15)
CLEARING = (34, 22)
SWAMP = (9, 25)
TRAIL_CACHE = (9, 6)


def stream_x(y: float) -> float:
    """Centre line of the stream, meandering north across the patrol area."""
    return 24 + 5 * math.sin(y / 5.5) + 1.6 * math.sin(y / 2.3 + 1)


def trail_distance(x: int, y: int) -> float:
    """Distance to the footpath running from the south-west to the north-east."""
    (x0, y0), (x1, y1) = (0, 4), (43, 28)
    return abs((y1 - y0) * x - (x1 - x0) * y + x1 * y0 - y1 * x0) / math.hypot(x1 - x0, y1 - y0)


def jungle_cell(x: int, y: int, seed: int) -> tuple[str, str]:
    """(zone, material) for secondary rainforest in the Central Catchment."""
    bank = abs(x - stream_x(y)) + (value_noise(x, y, 2.5, seed) - 0.5) * 0.8
    if bank < 0.9:
        return "stream", "water"
    if math.dist((x, y), FORD) < 2.3 and trail_distance(x, y) < 1.6:
        return "ford", "gravel"  # stones laid where the trail crosses
    if bank < 2.1:
        return "bank", "mud"
    if trail_distance(x, y) < 0.8:
        return "trail", "soil"
    clearing = ellipse_distance(x, y, *CLEARING, 4.6, 3.6)
    if clearing + (value_noise(x, y, 2, seed + 1) - 0.5) * 0.4 < 1:
        return "clearing", "soil" if value_noise(x, y, 1.5, seed + 2) > 0.7 else "grass_vegetation"
    swamp = ellipse_distance(x, y, *SWAMP, 3.8, 2.6)
    if swamp + (value_noise(x, y, 2, seed + 3) - 0.5) * 0.6 < 1:
        return "swamp", "water" if value_noise(x, y, 1.8, seed + 4) > 0.72 else "mud"
    if fractal_noise(x, y, 4, seed + 5) > 0.7:
        return "forest", "grass_vegetation"  # ferns and undergrowth in light gaps
    if fractal_noise(x, y, 3, seed + 6) > 0.78:
        return "forest", "soil"  # bare, trampled patches
    return "forest", "leaf_litter"


def build_jungle_patrol(out_dir: Path, seed: int = 926) -> None:
    b = FixtureBuilder("jungle_patrol_v1", out_dir, seed)
    rng = random.Random(seed)
    commands = boustrophedon(
        JUNGLE_W, JUNGLE_H, backtracks=JUNGLE_BACKTRACKS, obstacles=JUNGLE_OBSTACLES
    )
    visited = set(walk(commands))
    cells = {(x, y): jungle_cell(x, y, seed) for x in range(JUNGLE_W) for y in range(JUNGLE_H)}
    grid = {cell: material for cell, (_, material) in cells.items()}
    # Forest floor is hard to call at every zone edge.
    zones = {cell: zone for cell, (zone, _) in cells.items()}
    soft = {
        cell
        for cell in boundary_cells(zones, lambda a, c: True)
        if cell in visited and rng.random() < 0.55
    }

    # Three dense metal clusters make clear hotspots; a few stray readings elsewhere.
    taken: set[tuple[int, int]] = set()
    metal: set[tuple[int, int]] = set()
    for centre, count in ((TRAIL_CACHE, 9), (FORD, 8), (CLEARING, 7)):
        metal |= pick_near(rng, centre, 2, count, visited, taken)
    for cell in rng.sample(sorted(visited - taken), 3):
        metal.add(cell)
        taken.add(cell)
    voc: set[tuple[int, int]] = set()
    voc |= pick_near(rng, (CLEARING[0] - 1, CLEARING[1] + 2), 3, 7, visited, taken)
    voc |= pick_near(rng, SWAMP, 2, 4, visited, taken)

    plan = SurveyPlan(b, commands, grid, metal, voc, soft, rng, confusion=0.35)
    hops = plan.hop_count
    plan.choose_faults(
        errors=round(hops * 0.015),  # canopy and humidity cost more readings than in town
        missing=round(hops * 0.008),
        no_image=round(hops * 0.006),
        out_of_order=True,
        duplicate=False,
    )
    plan.emit()
    b.write_large(
        f"Rainforest patrol in the Central Catchment, {JUNGLE_W} x {JUNGLE_H} cells ({hops} "
        "hops): leaf litter under canopy, a meandering stream with muddy banks, a trail with a "
        f"gravel ford, a swamp and a clearing. {len(metal)} metal anomalies in three clusters "
        f"(trail, ford, clearing), {len(voc)} VOC cues around the clearing and swamp. "
        "Screenshots are generated at replay time.",
        "Jungle patrol",
    )


LARGE_BUILDERS = {
    "district_sweep_v1": build_district_sweep,
    "canal_corridor_v1": build_canal_corridor,
    "jungle_patrol_v1": build_jungle_patrol,
}
