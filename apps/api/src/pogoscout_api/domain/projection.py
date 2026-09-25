"""Nominal grid projection: hops -> coordinates -> cells.

Pure functions. Hop N lands at the sum of movements of hops 1..N from the origin (0, 0).
A hop whose predecessor chain has a gap stays pending until the gap is filled.
Revisits append observations; nothing is overwritten.
"""

from dataclasses import dataclass, field
from typing import Literal

from pogoscout_api.domain.hops import HopPayload, SensorReading

SensorCellState = Literal["detected", "not_detected", "sensor_error", "missing"]


@dataclass(frozen=True)
class PlacedHop:
    hop_id: int
    x: int
    y: int
    payload: HopPayload


@dataclass
class Cell:
    x: int
    y: int
    hops: list[PlacedHop] = field(default_factory=list)

    @property
    def metal(self) -> SensorCellState:
        return aggregate_sensor([h.payload.sensors.metal for h in self.hops])

    @property
    def voc(self) -> SensorCellState:
        return aggregate_sensor([h.payload.sensors.voc for h in self.hops])


@dataclass
class Projection:
    placed: list[PlacedHop]
    pending_hop_ids: list[int]
    cells: dict[tuple[int, int], Cell]

    @property
    def current(self) -> tuple[int, int]:
        return (self.placed[-1].x, self.placed[-1].y) if self.placed else (0, 0)


def aggregate_sensor(readings: list[SensorReading]) -> SensorCellState:
    """Any positive wins; then any valid negative; then error; else missing."""
    return aggregate_sensor_values([(r.value, r.status) for r in readings])


def aggregate_sensor_values(readings: list[tuple[int | None, str]]) -> SensorCellState:
    """`aggregate_sensor` over plain (value, status) pairs."""
    if any(status == "ok" and value == 1 for value, status in readings):
        return "detected"
    if any(status == "ok" and value == 0 for value, status in readings):
        return "not_detected"
    if any(status == "error" for _, status in readings):
        return "sensor_error"
    return "missing"


def place(moves: dict[int, tuple[int, int]]) -> tuple[list[tuple[int, int, int]], list[int]]:
    """(placed [(hop_id, x, y)], pending hop ids) from {hop_id: (dx, dy)}."""
    placed: list[tuple[int, int, int]] = []
    x, y = 0, 0
    hop_id = 1
    while hop_id in moves:
        dx, dy = moves[hop_id]
        x, y = x + dx, y + dy
        placed.append((hop_id, x, y))
        hop_id += 1
    return placed, sorted(h for h in moves if h >= hop_id)


def project(hops: dict[int, HopPayload]) -> Projection:
    spots, pending = place({h: (p.movement.dx, p.movement.dy) for h, p in hops.items()})
    placed = [PlacedHop(h, x, y, hops[h]) for h, x, y in spots]
    cells: dict[tuple[int, int], Cell] = {}
    for hop in placed:
        cells.setdefault((hop.x, hop.y), Cell(hop.x, hop.y)).hops.append(hop)
    return Projection(placed=placed, pending_hop_ids=pending, cells=cells)
