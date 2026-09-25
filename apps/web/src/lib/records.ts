import type { Cell, MissionSummary } from '../api/types'
import { latestObservation } from './cells'

export const SOURCE_NAMES = { hardware: 'Scout telemetry', manual: 'Manual entry', mock: 'Recorded replay' } as const

export function recordFor(mission: MissionSummary, cell: Cell) {
  const o = latestObservation(cell)
  return {
    mission_id: mission.id,
    hop_id: o.hop_id,
    observed_at: o.observed_at,
    cell: { x: cell.x, y: cell.y },
    movement: o.movement,
    sensors: { metal: o.metal, voc: o.voc },
    image: o.image && { sha256: o.image.sha256, content_type: o.image.content_type, bytes: o.image.bytes },
    classification: o.classification,
  }
}
