"""Controlled material taxonomy shared with the separate ML service (by contract, not code)."""

TAXONOMY_VERSION = "pogo-materials-v1"

MATERIAL_LABELS: tuple[str, ...] = (
    "firm_soil",
    "leaf_litter",
    "mud",
    "standing_water",
    "root_or_wood",
    "manmade_surface",
    "unknown",
)
