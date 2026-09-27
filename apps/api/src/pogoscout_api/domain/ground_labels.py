"""Labels from the ground-classification service (contracts/ground-latest.v1.openapi.yaml).

The live ground demo stores readings under the service's own labels, which add `wood` to the
platform taxonomy. The platform taxonomy itself stays at pogo-materials-v2.
"""

from pogoscout_api.domain.materials import MATERIAL_LABELS

GROUND_TAXONOMY_VERSION = "ground-v1"

GROUND_LABELS: tuple[str, ...] = (*MATERIAL_LABELS, "wood")
