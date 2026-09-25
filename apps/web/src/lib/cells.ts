import type { Cell, CellFlag, Classification, Observation, SensorCellState } from '../api/types'

export const LOW_CONFIDENCE = 0.8

export type Layer = 'combined' | 'material' | 'captures' | 'metal' | 'voc' | 'quality'

export const LAYERS: { id: Layer; name: string }[] = [
  { id: 'combined', name: 'Combined' },
  { id: 'material', name: 'Material' },
  { id: 'captures', name: 'Captures' },
  { id: 'metal', name: 'Metal' },
  { id: 'voc', name: 'VOC' },
  { id: 'quality', name: 'Data quality' },
]

export const cellKey = (c: { x: number; y: number }) => `${c.x},${c.y}`

export function latestObservation(cell: Cell): Observation {
  return cell.observations[cell.observations.length - 1]
}

/** The badge shown on a cell, most important first. Null when there is nothing to flag. */
export function primaryFlag(cell: Cell): { text: string; signal: boolean } | null {
  const order: [CellFlag, string, boolean][] = [
    ['metal', 'METAL ANOMALY', true],
    ['voc', 'VOC CUE', false],
    ['conflicting', 'CONFLICTING DATA', true],
    ['failed', 'CLASSIFICATION FAILED', true],
    ['missing', 'MISSING DATA', false],
    ['low_confidence', 'LOW CONFIDENCE', false],
    ['pending', 'CLASSIFYING', false],
  ]
  for (const [flag, text, signal] of order) if (cell.flags.includes(flag)) return { text, signal }
  return null
}

export function sensorText(state: SensorCellState): string {
  switch (state) {
    case 'detected':
      return 'Detected'
    case 'not_detected':
      return 'Not detected'
    case 'sensor_error':
      return 'Sensor error'
    case 'missing':
      return 'No reading'
  }
}

export function isLowConfidence(c: Classification): boolean {
  return c.status === 'succeeded' && c.confidence != null && c.confidence < LOW_CONFIDENCE
}

export function classificationText(c: Classification): string {
  switch (c.status) {
    case 'none':
      return 'No capture'
    case 'queued':
    case 'retrying':
      return 'Classifying'
    case 'failed':
      return 'Classification failed'
    case 'unavailable':
      return 'Model unavailable'
    case 'succeeded':
      return ''
  }
}

/** Counts per layer shown in the rail. */
export function layerCounts(cells: Cell[]): Partial<Record<Layer, number>> {
  return {
    metal: cells.filter((c) => c.metal === 'detected').length,
    voc: cells.filter((c) => c.voc === 'detected').length,
    quality: cells.filter((c) => c.quality !== 'complete').length,
  }
}

export function flaggedCells(cells: Cell[], path: { hop_id: number; x: number; y: number }[]): Cell[] {
  const firstVisit = new Map<string, number>()
  for (const p of path) if (!firstVisit.has(cellKey(p))) firstVisit.set(cellKey(p), p.hop_id)
  return cells
    .filter((c) => c.flags.length > 0)
    .sort((a, b) => (firstVisit.get(cellKey(a)) ?? 0) - (firstVisit.get(cellKey(b)) ?? 0))
}
