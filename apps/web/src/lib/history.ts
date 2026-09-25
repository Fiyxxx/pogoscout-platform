import type { Cell, CellFlag, CellsResponse, SensorCellState, SensorReading } from '../api/types'

function aggregate(readings: SensorReading[]): SensorCellState {
  if (readings.some((r) => r.status === 'ok' && r.value === 1)) return 'detected'
  if (readings.some((r) => r.status === 'ok' && r.value === 0)) return 'not_detected'
  if (readings.some((r) => r.status === 'error')) return 'sensor_error'
  return 'missing'
}

/**
 * The mission as it stood when hop `lastHop` landed. Bounds stay at the full mission extent so
 * the camera holds still while history plays back.
 */
export function snapshotAt(data: CellsResponse, lastHop: number): CellsResponse {
  const path = data.path.filter((p) => p.hop_id <= lastHop)
  const cells: Cell[] = []
  for (const cell of data.cells) {
    if (cell.hop_ids[cell.hop_ids.length - 1] <= lastHop) {
      cells.push(cell)
      continue
    }
    const observations = cell.observations.filter((o) => o.hop_id <= lastHop)
    if (observations.length === 0) continue
    const metal = aggregate(observations.map((o) => o.metal))
    const voc = aggregate(observations.map((o) => o.voc))
    const material = [...observations].reverse().find((o) => o.image)?.classification ?? observations[observations.length - 1].classification
    const flags = cell.flags.filter((f: CellFlag) => (f === 'metal' ? metal === 'detected' : f === 'voc' ? voc === 'detected' : true))
    cells.push({
      ...cell,
      visit_count: observations.length,
      hop_ids: observations.map((o) => o.hop_id),
      observations,
      metal,
      voc,
      material,
      flags,
    })
  }
  const last = path[path.length - 1]
  return { ...data, path, cells, current: last ? { x: last.x, y: last.y } : data.origin, pending_hop_ids: [] }
}
