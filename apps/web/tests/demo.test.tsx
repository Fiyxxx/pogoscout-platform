import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { GroundDemoState, GroundHop } from '../src/features/demo/api'
import { demoKeys } from '../src/features/demo/api'
import { GridLegend, GroundGrid } from '../src/features/demo/GroundGrid'
import { HopStrip } from '../src/features/demo/HopStrip'
import { groundColor, groundName, UNKNOWN_COLOR } from '../src/features/demo/labels'
import { Reading } from '../src/features/demo/Reading'
import { NO_LABEL_YET, runView } from '../src/features/demo/status'
import { keys } from '../src/api/client'
import { cell, cellsResponse, classification, observation } from './factories'

const state = (over: Partial<GroundDemoState> = {}): GroundDemoState => ({
  running: true,
  mission_id: 'GD-20260927-101500',
  hops: 3,
  interval_s: 2,
  ground: 'ok',
  ground_model_version: 'clip-vit-base-patch32+prompts-3f9a2c1d',
  ...over,
})

const hop = (hop_id: number, over: Partial<GroundHop> = {}): GroundHop => ({
  hop_id,
  x: hop_id,
  y: 0,
  observed_at: '2026-09-27T02:15:02Z',
  status: 'succeeded',
  label: 'gravel',
  confidence: 0.91,
  model_version: 'clip-vit-base-patch32+prompts-3f9a2c1d',
  captured_at: 1790000000.1,
  age_s: 0.4,
  stale: false,
  error: null,
  image_url: `/api/v1/missions/GD-1/hops/${hop_id}/image`,
  ...over,
})

test('wood has its own name and colour on the demo page; unknown labels stay neutral', () => {
  expect(groundName('wood')).toBe('Wood')
  expect(groundName('tiles_pavers')).toBe('Pavers')
  expect(groundColor('wood')).not.toBe(UNKNOWN_COLOR)
  expect(groundName('lava')).toBe('Unknown')
  expect(groundColor(null)).toBe(UNKNOWN_COLOR)
})

test('the recent-hops query sits under the mission key, so the live mission topic refreshes it', () => {
  expect(demoKeys.hops('GD-1').slice(0, 2)).toEqual([...keys.mission('GD-1')])
})

test('header state covers off, stopped, offline, waiting and running', () => {
  expect(runView(state({ ground: 'off', running: false }), undefined).text).toBe('Demo off')
  expect(runView(state({ running: false }), undefined).text).toBe('Stopped')
  expect(runView(state({ ground: 'offline' }), hop(3)).text).toBe('Ground service offline')
  const waiting = hop(1, { status: 'unavailable', error: NO_LABEL_YET, image_url: null, label: null })
  expect(runView(state(), waiting).text).toBe('Waiting for the first confident label')
  expect(runView(state(), hop(3))).toEqual({ text: 'Running', tone: 'live' })
})

test('current reading shows the crop, label, confidence, age and a stale note', () => {
  render(<Reading reading={hop(4, { label: 'wood', confidence: 0.62, stale: true, age_s: 2.4 })} />)
  expect(screen.getByRole('img', { name: 'Ground crop for hop 4' })).toHaveAttribute('src', '/api/v1/missions/GD-1/hops/4/image')
  expect(screen.getByText('Wood')).toBeInTheDocument()
  expect(screen.getByText('0.62')).toBeInTheDocument()
  expect(screen.getByText('2.4 s old')).toBeInTheDocument()
  expect(screen.getByText('Stale: no new reading since the last hop')).toBeInTheDocument()
  expect(screen.getByText('Low confidence')).toBeInTheDocument()
})

test('a failed fetch shows the reason in place of the crop', () => {
  render(<Reading reading={hop(5, { status: 'unavailable', label: null, confidence: null, image_url: null, error: 'unreachable: ConnectError', stale: null })} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText('No reading for this hop')).toBeInTheDocument()
  expect(screen.getByText('unreachable: ConnectError')).toBeInTheDocument()
})

test('recent hops strip lists newest first with stale marks and selects on click', () => {
  const onSelect = vi.fn()
  const hops = [hop(3, { stale: true }), hop(2, { status: 'failed', image_url: null, label: null }), hop(1)]
  render(<HopStrip hops={hops} onSelect={onSelect} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Hop 3: Gravel', 'Hop 2: no reading', 'Hop 1: Gravel'])
  expect(screen.getByText('stale')).toBeInTheDocument()
  fireEvent.click(buttons[0])
  expect(onSelect).toHaveBeenCalledWith(hops[0])
})

test('map colours cells by label, north up, and picks a cell on click', () => {
  const wood = classification({ label: 'wood', confidence: 0.9, taxonomy_version: 'ground-v1' })
  const cells = cellsResponse([
    cell(1, 0, 1),
    cell(2, 0, 2, { observations: [observation(2, { classification: wood })] }),
    cell(2, 1, 3, { observations: [observation(3, { image: null, classification: classification({ status: 'unavailable', label: null }) })] }),
  ])
  const onSelect = vi.fn()
  render(<GroundGrid cells={cells} selected={null} onSelect={onSelect} />)
  const labelled = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))
  // Row y=1 first (north up), then y=0.
  expect(labelled).toEqual(['Cell (2, 1): No reading', 'Cell (1, 0): Soil', 'Cell (2, 0): Wood'])
  expect(screen.getByRole('button', { name: 'Cell (2, 1): No reading' }).style.outline).toContain('var(--signal)') // newest
  fireEvent.click(screen.getByRole('button', { name: 'Cell (2, 0): Wood' }))
  expect(onSelect).toHaveBeenCalledWith({ x: 2, y: 0 })

  render(<GridLegend cells={cells} />)
  expect(screen.getByText('Wood')).toBeInTheDocument()
  expect(screen.getByText('Soil')).toBeInTheDocument()
})
