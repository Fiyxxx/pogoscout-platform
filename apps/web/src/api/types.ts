export type SensorStatus = 'ok' | 'missing' | 'error'
export type SensorReading = { value: 0 | 1 | null; status: SensorStatus }
export type SensorCellState = 'detected' | 'not_detected' | 'sensor_error' | 'missing'

export type Mission = { id: string; name: string; source: 'mock' | 'manual' | 'hardware'; created_at: string }

export type Point = { x: number; y: number }
export type PathPoint = Point & { hop_id: number }

export type CellObservation = {
  hop_id: number
  observed_at: string
  metal: SensorReading
  voc: SensorReading
}

export type Cell = Point & {
  visit_count: number
  hop_ids: number[]
  metal: SensorCellState
  voc: SensorCellState
  observations: CellObservation[]
}

export type CellsResponse = {
  mission_id: string
  origin: Point
  current: Point
  path: PathPoint[]
  pending_hop_ids: number[]
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number }
  cells: Cell[]
}

export type Health = { status: string; classifier: string }
