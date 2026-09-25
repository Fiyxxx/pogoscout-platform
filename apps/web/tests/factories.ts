import type { Cell, CellsResponse, Classification, MissionSummary, Observation } from '../src/api/types'

export function classification(over: Partial<Classification> = {}): Classification {
  return {
    status: 'succeeded',
    label: 'soil',
    confidence: 0.86,
    model_version: 'material-model 0.3.0',
    taxonomy_version: 'pogo-materials-v2',
    requested_at: '2026-09-25T08:01:20Z',
    completed_at: '2026-09-25T08:01:21Z',
    error: null,
    ...over,
  }
}

export function observation(hop_id: number, over: Partial<Observation> = {}): Observation {
  const c = over.classification ?? classification()
  return {
    hop_id,
    observed_at: `2026-09-25T08:00:${String(hop_id * 2).padStart(2, '0')}Z`,
    movement: { command: 'F', dx: 0, dy: 1 },
    metal: { value: 0, status: 'ok' },
    voc: { value: 0, status: 'ok' },
    image: {
      mission_id: 'PS-1',
      hop_id,
      sha256: 'a91f3c0e7b22' + '0'.repeat(52),
      content_type: 'image/png',
      bytes: 7000,
      received_at: '2026-09-25T08:00:02Z',
      url: `/api/v1/missions/PS-1/hops/${hop_id}/image`,
    },
    classification: c,
    classification_history: [c],
    ...over,
  }
}

export function cell(x: number, y: number, hop: number, over: Partial<Cell> = {}): Cell {
  const obs = over.observations ?? [observation(hop)]
  return {
    x,
    y,
    visit_count: obs.length,
    hop_ids: obs.map((o) => o.hop_id),
    metal: 'not_detected',
    voc: 'not_detected',
    material: obs[obs.length - 1].classification,
    quality: 'complete',
    flags: [],
    observations: obs,
    ...over,
  }
}

export function cellsResponse(cells: Cell[]): CellsResponse {
  const path = cells.flatMap((c) => c.hop_ids.map((hop_id) => ({ hop_id, x: c.x, y: c.y }))).sort((a, b) => a.hop_id - b.hop_id)
  const xs = [0, ...cells.map((c) => c.x)]
  const ys = [0, ...cells.map((c) => c.y)]
  const last = path[path.length - 1] ?? { x: 0, y: 0 }
  return {
    mission_id: 'PS-1',
    origin: { x: 0, y: 0 },
    current: { x: last.x, y: last.y },
    path,
    pending_hop_ids: [],
    bounds: { min_x: Math.min(...xs), max_x: Math.max(...xs), min_y: Math.min(...ys), max_y: Math.max(...ys) },
    cells,
  }
}

export function mission(over: Partial<MissionSummary> = {}): MissionSummary {
  return {
    id: 'PS-1',
    name: 'Grid Sweep 01',
    source: 'mock',
    status: 'live',
    status_note: null,
    created_at: '2026-09-25T07:59:00Z',
    started_at: '2026-09-25T08:00:00Z',
    last_hop_at: '2026-09-25T08:01:24Z',
    scenario_id: 'clean_baseline_v1',
    stats: { hops: 22, cells: 22, metal: 2, voc: 1, flags: 5, materials: { soil: 12, leaf_litter: 5, concrete: 4 } },
    ...over,
  }
}
