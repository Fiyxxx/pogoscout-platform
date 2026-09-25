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
    if any(r.status == "ok" and r.value == 1 for r in readings):
        return "detected"
    if any(r.status == "ok" and r.value == 0 for r in readings):
        return "not_detected"
    if any(r.status == "error" for r in readings):
        return "sensor_error"
    return "missing"


def project(hops: dict[int, HopPayload]) -> Projection:
    placed: list[PlacedHop] = []
    x, y = 0, 0
    hop_id = 1
    while hop_id in hops:
        payload = hops[hop_id]
        x, y = x + payload.movement.dx, y + payload.movement.dy
        placed.append(PlacedHop(hop_id, x, y, payload))
        hop_id += 1

    cells: dict[tuple[int, int], Cell] = {}
    for hop in placed:
        cells.setdefault((hop.x, hop.y), Cell(hop.x, hop.y)).hops.append(hop)

    pending = sorted(h for h in hops if h >= hop_id)
    return Projection(placed=placed, pending_hop_ids=pending, cells=cells)
