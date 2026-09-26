"""GPS anchoring of the nominal grid.

With a GPS fix, cell (0, 0) sits at the start position, +y points along `heading_deg`
(clockwise from true north) and one cell is `CELL_M` metres square on the ground, the same
for every mission, so footprints compare directly with each other and with the map.
"""

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Ground size of one cell (and of one hop), in metres.
CELL_M = 1.0


class GeoAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    heading_deg: float = Field(ge=0, lt=360)
    cell_m: float = CELL_M

    @field_validator("cell_m")
    @classmethod
    def _fixed_cell(cls, value: float) -> float:
        if value != CELL_M:
            raise ValueError(f"cell_m is fixed at {CELL_M} m for every mission")
        return value
