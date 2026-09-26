"""Simulated GPS start fixes for the recorded scenarios, spread across western Singapore."""

from pogoscout_api.domain.geo import GeoAnchor

SCENARIO_SITES: dict[str, GeoAnchor] = {
    # Tengah construction district.
    "district_sweep_v1": GeoAnchor(lat=1.3571, lon=103.7362, heading_deg=20),
    # Ulu Pandan canal, surveyed along the park connector.
    "canal_corridor_v1": GeoAnchor(lat=1.3186, lon=103.7738, heading_deg=72),
    # Bukit Timah canal culvert.
    "failures_v1": GeoAnchor(lat=1.3336, lon=103.7893, heading_deg=110),
    # Jurong Lake Gardens.
    "park_connector_v1": GeoAnchor(lat=1.3406, lon=103.7268, heading_deg=35),
    # Central Catchment Nature Reserve, rainforest west of MacRitchie Reservoir.
    "jungle_patrol_v1": GeoAnchor(lat=1.3552, lon=103.8048, heading_deg=15),
    # Pasir Laba training area.
    "clean_baseline_v1": GeoAnchor(lat=1.3441, lon=103.6772, heading_deg=0),
}
