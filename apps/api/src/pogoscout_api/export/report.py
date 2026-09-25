"""Printable HTML mission report. Self-contained, dark-on-white, browser prints it to PDF."""

from datetime import datetime
from html import escape

from pogoscout_api.application.views import (
    MissionData,
    build_summary,
    cell_views,
    latest_classification,
)
from pogoscout_api.domain.hops import HopPayload
from pogoscout_api.persistence.db import utcnow

FLAG_TEXT = {
    "metal": "Metal anomaly",
    "voc": "VOC cue",
    "low_confidence": "Low confidence",
    "pending": "Classification pending",
    "failed": "Classification failed",
    "missing": "Missing data",
    "conflicting": "Conflicting resend",
}
STATE_TEXT = {
    "detected": "Detected",
    "not_detected": "Not detected",
    "sensor_error": "Sensor error",
    "missing": "Missing",
}

CSS = """
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font: 13px/1.45 -apple-system, "Segoe UI",
  Roboto, Helvetica, Arial, sans-serif; }
main { max-width: 960px; margin: 0 auto; padding: 32px 24px 48px; }
header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 28px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
.muted { color: #555; }
.notice { border: 1px solid #111; padding: 8px 12px; margin: 16px 0; font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
dt { color: #555; } dd { margin: 0; }
.stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-top: 12px; }
.stat { border: 1px solid #bbb; padding: 8px; }
.stat b { display: block; font-size: 18px; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #ccc; vertical-align: top; }
th { border-bottom: 1.5px solid #111; font-size: 11px; text-transform: uppercase; }
.num { text-align: right; }
footer { margin-top: 32px; font-size: 11px; color: #555; border-top: 1px solid #ccc;
  padding-top: 8px; }
@media print {
  main { padding: 0; max-width: none; }
  tr { break-inside: avoid; }
  h2 { break-after: avoid; }
  .no-print { display: none; }
}
@page { size: A4; margin: 14mm; }
"""


def _t(value: datetime | None) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S UTC") if value else "n/a"


def _e(value: object) -> str:
    return escape(str(value))


def _material(label: str | None, confidence: float | None, status: str) -> str:
    if status == "succeeded" and label:
        return f"{_e(label)} ({confidence:.2f})" if confidence is not None else _e(label)
    return _e(status)


def render_report(data: MissionData) -> str:
    views = cell_views(data)
    summary = build_summary(data, views)
    stats = summary.stats
    versions = sorted(
        {
            (r.model_version, r.taxonomy_version or "")
            for rows in data.classifications.values()
            for r in rows
            if r.status == "succeeded" and r.model_version
        }
    )
    flagged = [v.cell for v in views if v.cell.flags]
    positions = {h.hop_id: (h.x, h.y) for h in data.projection.placed}

    parts = [
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>",
        f"<title>Mission report {_e(summary.id)}</title>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        f"<style>{CSS}</style></head><body><main>",
        "<header>",
        f"<h1>{_e(summary.name)}</h1>",
        f"<div class='muted'>PogoScout mission report, mission {_e(summary.id)}, "
        f"generated {_t(utcnow())}</div>",
        "</header>",
    ]
    if summary.source == "mock":
        parts.append(
            "<div class='notice'>Synthetic mock data. Screenshots and classifications in this "
            "mission are generated for development and are not field evidence.</div>"
        )
    status = _e(summary.status) + (f": {_e(summary.status_note)}" if summary.status_note else "")
    parts += [
        "<h2>Summary</h2><dl>",
        f"<dt>Status</dt><dd>{status}</dd>",
        f"<dt>Source</dt><dd>{_e(summary.source)}</dd>",
        f"<dt>Scenario</dt><dd>{_e(summary.scenario_id or 'none')}</dd>",
        f"<dt>Time range</dt><dd>{_t(summary.started_at)} to {_t(summary.last_hop_at)}</dd>",
        f"<dt>Created</dt><dd>{_t(summary.created_at)}</dd>",
        "<dt>Model versions</dt><dd>"
        + (
            ", ".join(f"{_e(m)} (taxonomy {_e(t)})" for m, t in versions)
            if versions
            else "no completed classifications"
        )
        + "</dd>",
        "</dl><div class='stats'>",
    ]
    for label, value in (
        ("Hops", stats.hops),
        ("Cells", stats.cells),
        ("Metal anomalies", stats.metal),
        ("VOC cues", stats.voc),
        ("Flagged cells", stats.flags),
        ("Pending hops", len(data.projection.pending_hop_ids)),
    ):
        parts.append(f"<div class='stat'><b>{value}</b>{label}</div>")
    parts.append("</div>")
    if stats.materials:
        materials = ", ".join(f"{_e(k)} {v}" for k, v in stats.materials.items())
        parts.append(f"<p class='muted'>Material labels by cell: {materials}</p>")

    parts.append(f"<h2>Flagged cells ({len(flagged)})</h2>")
    if flagged:
        parts.append(
            "<table><thead><tr><th>Cell</th><th>Flags</th><th>Metal</th><th>VOC</th>"
            "<th>Material</th><th>Quality</th><th>Hops</th></tr></thead><tbody>"
        )
        for cell in flagged:
            m = cell.material
            parts.append(
                f"<tr><td>({cell.x}, {cell.y})</td>"
                f"<td>{_e(', '.join(FLAG_TEXT[f] for f in cell.flags))}</td>"
                f"<td>{STATE_TEXT[cell.metal]}</td><td>{STATE_TEXT[cell.voc]}</td>"
                f"<td>{_material(m.label, m.confidence, m.status)}</td>"
                f"<td>{_e(cell.quality.replace('_', ' '))}</td>"
                f"<td>{_e(', '.join(map(str, cell.hop_ids)))}</td></tr>"
            )
        parts.append("</tbody></table>")
    else:
        parts.append("<p class='muted'>No cells are flagged.</p>")

    parts.append(f"<h2>Hops ({len(data.hops)})</h2>")
    parts.append(
        "<table><thead><tr><th class='num'>Hop</th><th>Observed</th><th>Move</th>"
        "<th>Cell</th><th>Metal</th><th>VOC</th><th>Screenshot</th><th>Material</th>"
        "</tr></thead><tbody>"
    )
    for hop in data.hops:
        payload = HopPayload.model_validate(hop.payload)
        pos = positions.get(hop.hop_id)
        cell = f"({pos[0]}, {pos[1]})" if pos else "pending"
        cls = latest_classification(data, hop.hop_id)
        readings = []
        for reading in (payload.sensors.metal, payload.sensors.voc):
            readings.append(
                ("1" if reading.value else "0") if reading.status == "ok" else reading.status
            )
        conflict = " (conflicting resend rejected)" if hop.hop_id in data.rejected_hop_ids else ""
        parts.append(
            f"<tr><td class='num'>{hop.hop_id}</td><td>{_t(payload.observed_at)}</td>"
            f"<td>{payload.movement.command}</td><td>{cell}{conflict}</td>"
            f"<td>{readings[0]}</td><td>{readings[1]}</td>"
            f"<td>{'yes' if hop.hop_id in data.images else 'none'}</td>"
            f"<td>{_material(cls.label, cls.confidence, cls.status)}</td></tr>"
        )
    parts.append("</tbody></table>")
    parts += [
        "<footer>Grid positions are nominal software positions, not measured locations. "
        "A metal anomaly is a sensor cue, not an identification of any object. A VOC cue is an "
        "activity cue, not a detection of people. Material labels are model classifications with "
        "the stated confidence and model version, not ground truth.</footer>",
        "</main></body></html>",
    ]
    return "\n".join(parts)
