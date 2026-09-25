import type { SensorCellState } from '../api/types'
import { SENSOR_LABELS } from './sensorLabels'

export function SensorBadge({ kind, state }: { kind: 'metal' | 'voc'; state: SensorCellState }) {
  const title = kind === 'metal' ? 'Metal anomaly' : 'VOC activity cue'
  return (
    <span className="sensor-badge" data-state={state}>
      {title}: {SENSOR_LABELS[state]}
    </span>
  )
}
