"""GPS anchoring of the nominal grid.

With a GPS fix, cell (0, 0) sits at the start position, +y points along `heading_deg`
(clockwise from true north) and one cell is `cell_m` metres on the ground.
"""

from pydantic import BaseModel, ConfigDict, Field


class GeoAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    heading_deg: float = Field(ge=0, lt=360)
    cell_m: float = Field(gt=0, le=20)
