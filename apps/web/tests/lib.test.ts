import { describe, expect, test } from 'vitest'
import { classificationText, flaggedCells, isLowConfidence, layerCounts, primaryFlag, sensorText } from '../src/lib/cells'
import { clock, duration, elapsed, shortDate } from '../src/lib/format'
import { materialName } from '../src/lib/materials'
import { cell, cellsResponse, classification } from './factories'

describe('format', () => {
  test('mission clock and durations', () => {
    expect(elapsed('2026-09-25T08:00:00Z', '2026-09-25T08:01:24Z')).toBe('01:24')
    expect(elapsed('2026-09-25T08:00:00Z', '2026-09-25T09:02:03Z')).toBe('1:02:03')
    expect(elapsed(null, null)).toBe('00:00')
    expect(duration('2026-09-25T08:00:00Z', '2026-09-25T08:00:36Z')).toBe('36s')
    expect(duration('2026-09-25T08:00:00Z', '2026-09-25T08:01:04Z')).toBe('1m 04s')
    expect(clock('2026-09-25T08:01:20.500Z')).toBe('08:01:20')
    expect(shortDate('2026-09-25T08:00:00Z')).toBe('25 Sep 08:00')
  })
})

describe('cells', () => {
  test('primary flag prefers metal, and nothing when clean', () => {
    expect(primaryFlag(cell(0, 1, 1, { flags: ['low_confidence', 'metal'] }))).toEqual({ text: 'METAL ANOMALY', signal: true })
    expect(primaryFlag(cell(0, 1, 1, { flags: ['pending'] }))?.text).toBe('CLASSIFYING')
    expect(primaryFlag(cell(0, 1, 1))).toBeNull()
  })

  test('negative, missing and error readings read differently', () => {
    expect(sensorText('not_detected')).toBe('Not detected')
    expect(sensorText('missing')).toBe('No reading')
    expect(sensorText('sensor_error')).toBe('Sensor error')
  })

  test('low confidence only applies to succeeded results below 0.80', () => {
    expect(isLowConfidence(classification({ confidence: 0.79 }))).toBe(true)
    expect(isLowConfidence(classification({ confidence: 0.8 }))).toBe(false)
    expect(isLowConfidence(classification({ status: 'queued', confidence: null }))).toBe(false)
    expect(classificationText(classification({ status: 'retrying' }))).toBe('Classifying')
  })

  test('flagged cells follow mission order and layer counts match states', () => {
    const cells = [
      cell(0, 2, 2, { metal: 'detected', flags: ['metal'] }),
      cell(0, 1, 1, { voc: 'detected', flags: ['voc'] }),
      cell(0, 3, 3, { quality: 'pending', flags: ['pending'] }),
      cell(0, 4, 4),
    ]
    const data = cellsResponse(cells)
    expect(flaggedCells(data.cells, data.path).map((c) => c.y)).toEqual([1, 2, 3])
    expect(layerCounts(cells)).toEqual({ metal: 1, voc: 1, quality: 1 })
  })

  test('material names come from the controlled taxonomy', () => {
    expect(materialName('grass_vegetation')).toBe('Grass')
    expect(materialName('lava')).toBe('Unknown')
  })
})

describe('history', () => {
  test('snapshot shows the mission as it stood at a hop, revisits included', async () => {
    const { snapshotAt } = await import('../src/lib/history')
    const { observation } = await import('./factories')
    const revisited = cell(0, 1, 1, {
      observations: [observation(1), observation(3, { metal: { value: 1, status: 'ok' } })],
      metal: 'detected',
      flags: ['metal'],
    })
    const data = cellsResponse([revisited, cell(0, 2, 2), cell(0, 3, 4)])
    const at2 = snapshotAt(data, 2)
    expect(at2.path.map((p) => p.hop_id)).toEqual([1, 2])
    expect(at2.current).toEqual({ x: 0, y: 2 })
    expect(at2.cells).toHaveLength(2)
    const early = at2.cells.find((c) => c.y === 1)!
    expect(early.metal).toBe('not_detected')
    expect(early.flags).toEqual([])
    expect(early.visit_count).toBe(1)
    expect(at2.bounds).toEqual(data.bounds)
    expect(snapshotAt(data, 4).cells.find((c) => c.y === 1)!.metal).toBe('detected')
  })
})
