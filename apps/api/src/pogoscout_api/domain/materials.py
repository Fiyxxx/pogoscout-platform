"""Controlled material taxonomy shared with the separate ML service (by contract, not code).

Must match the label list in the pogoscout-material-model repository.
"""

TAXONOMY_VERSION = "pogo-materials-v2"

MATERIAL_LABELS: tuple[str, ...] = (
    "soil",
    "mud",
    "sand",
    "gravel",
    "grass_vegetation",
    "leaf_litter",
    "concrete",
    "asphalt",
    "tiles_pavers",
    "water",
)
