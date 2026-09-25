import type { CellsResponse } from '../src/api/types'

const ok0 = { value: 0, status: 'ok' } as const

export const cellsFixture: CellsResponse = {
  mission_id: 't-1',
  origin: { x: 0, y: 0 },
  current: { x: 1, y: 1 },
  path: [
    { hop_id: 1, x: 0, y: 1 },
    { hop_id: 2, x: 1, y: 1 },
    { hop_id: 3, x: 0, y: 1 },
    { hop_id: 4, x: 1, y: 1 },
  ],
  pending_hop_ids: [],
  bounds: { min_x: 0, max_x: 1, min_y: 0, max_y: 1 },
  cells: [
    {
      x: 0,
      y: 1,
      visit_count: 2,
      hop_ids: [1, 3],
      metal: 'detected',
      voc: 'sensor_error',
      observations: [
        { hop_id: 1, observed_at: '2026-09-25T08:00:00Z', metal: { value: 1, status: 'ok' }, voc: { value: null, status: 'error' } },
        { hop_id: 3, observed_at: '2026-09-25T08:00:08Z', metal: ok0, voc: { value: null, status: 'error' } },
      ],
    },
    {
      x: 1,
      y: 1,
      visit_count: 2,
      hop_ids: [2, 4],
      metal: 'not_detected',
      voc: 'not_detected',
      observations: [
        { hop_id: 2, observed_at: '2026-09-25T08:00:04Z', metal: ok0, voc: ok0 },
        { hop_id: 4, observed_at: '2026-09-25T08:00:12Z', metal: ok0, voc: ok0 },
      ],
    },
  ],
}
