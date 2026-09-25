// Mirrors docs/API.md. Keep in sync with apps/api.

export type MissionStatus = 'live' | 'complete' | 'aborted'
export type HopSource = 'mock' | 'manual' | 'hardware'
export type SensorStatus = 'ok' | 'missing' | 'error'
export type SensorReading = { value: 0 | 1 | null; status: SensorStatus }
export type SensorCellState = 'detected' | 'not_detected' | 'sensor_error' | 'missing'
export type MovementCommand = 'F' | 'B' | 'L' | 'R'

export type MissionStats = {
  hops: number
  cells: number
  metal: number
  voc: number
  flags: number
  materials: Record<string, number>
}

export type MissionSummary = {
  id: string
  name: string
  source: HopSource
  status: MissionStatus
  status_note: string | null
  created_at: string
  started_at: string | null
  last_hop_at: string | null
  scenario_id: string | null
  stats: MissionStats
}

export type HopPayload = {
  schema_version: '1.0'
  observed_at: string
  producer_id: string
  source: HopSource
  movement: { command: MovementCommand; dx: number; dy: number }
  sensors: { metal: SensorReading; voc: SensorReading }
}

export type HopRecord = {
  mission_id: string
  hop_id: number
  payload: HopPayload
  content_hash: string
  received_at: string
}

export type ImageRecord = {
  mission_id: string
  hop_id: number
  sha256: string
  content_type: string
  bytes: number
  received_at: string
  url: string
}

export type ClassificationStatus = 'none' | 'queued' | 'retrying' | 'succeeded' | 'failed' | 'unavailable'
export type Classification = {
  status: ClassificationStatus
  label: string | null
  confidence: number | null
  model_version: string | null
  taxonomy_version: string | null
  requested_at: string | null
  completed_at: string | null
  error: string | null
}

export type Observation = {
  hop_id: number
  observed_at: string
  movement: { command: MovementCommand; dx: number; dy: number }
  metal: SensorReading
  voc: SensorReading
  image: ImageRecord | null
  classification: Classification
  classification_history: Classification[]
}

export type Quality = 'complete' | 'pending' | 'low_confidence' | 'missing' | 'failed' | 'conflicting'
export type CellFlag = 'metal' | 'voc' | 'low_confidence' | 'pending' | 'failed' | 'missing' | 'conflicting'

export type Point = { x: number; y: number }
export type Cell = Point & {
  visit_count: number
  hop_ids: number[]
  metal: SensorCellState
  voc: SensorCellState
  material: Classification
  quality: Quality
  flags: CellFlag[]
  observations: Observation[]
}

export type CellsResponse = {
  mission_id: string
  origin: Point
  current: Point
  path: (Point & { hop_id: number })[]
  pending_hop_ids: number[]
  bounds: { min_x: number; max_x: number; min_y: number; max_y: number }
  cells: Cell[]
}

export type EventLevel = 'debug' | 'info' | 'warning' | 'alert'
export type MissionEvent = {
  id: number
  at: string
  kind: string
  level: EventLevel
  hop_id: number | null
  x: number | null
  y: number | null
  message: string
}

export type Scenario = { scenario_id: string; description: string; hops: number; events: number }
export type ReplayState = {
  scenario_id: string
  cursor: number
  total: number
  playing: boolean
  speed: number
  finished: boolean
}

export type Health = {
  status: string
  classifier: 'mock' | 'http' | 'disabled'
  classifier_status: 'ok' | 'degraded' | 'offline'
  model_version: string | null
}

export type LiveMessage =
  | { type: 'changed'; mission_id: string; topics: string[]; hop_id: number | null }
  | { type: 'ping' }

/** GPS fix of the mission start and the grid's orientation on the ground. */
export type GeoAnchor = { lat: number; lon: number; heading_deg: number; cell_m: number }

/** Compact cell for the theatre view: [x, y, material label or null, metal 0|1, voc 0|1]. */
export type WorldCell = [number, number, string | null, 0 | 1, 0 | 1]

export type WorldMission = {
  mission: MissionSummary
  geo: GeoAnchor
  current: Point | null
  cells: WorldCell[]
}

export type WorldResponse = { missions: WorldMission[] }
