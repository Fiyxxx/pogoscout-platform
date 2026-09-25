import type { SensorCellState } from '../api/types'

export const SENSOR_LABELS: Record<SensorCellState, string> = {
  detected: 'Detected',
  not_detected: 'Not detected',
  sensor_error: 'Sensor error',
  missing: 'Missing',
}
