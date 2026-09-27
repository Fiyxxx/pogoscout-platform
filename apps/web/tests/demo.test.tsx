import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { GroundDemoState, GroundHop, GroundSession } from '../src/features/demo/api'
import { demoKeys } from '../src/features/demo/api'
import { GridLegend, GroundGrid } from '../src/features/demo/GroundGrid'
import { HopStrip } from '../src/features/demo/HopStrip'
import { groundColor, groundName, UNKNOWN_COLOR } from '../src/features/demo/labels'
import { Reading } from '../src/features/demo/Reading'
import { NO_LABEL_YET, runView } from '../src/features/demo/status'
import { SessionActions } from '../src/features/demo/SessionActions'
import { SessionList } from '../src/features/demo/SessionList'
import { keys } from '../src/api/client'
import { cell, cellsResponse, classification, observation } from './factories'

const session = (over: Partial<GroundSession> = {}): GroundSession => ({
  mission_id: 'GD-20260927-101500',
  name: 'Ground demo 10:15:00',
  status: 'live',
  running: true,
  hops: 3,
  created_at: '2026-09-27T02:15:00Z',
  ...over,
})

const state = (over: Partial<GroundDemoState> = {}): GroundDemoState => ({
  interval_s: 2,
  ground: 'ok',
  ground_model_version: 'clip-vit-base-patch32+prompts-3f9a2c1d',
  sessions: [session()],
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

test('header state covers no session, ended, not polling, offline, waiting and running', () => {
  expect(runView(state({ sessions: [] }), undefined, undefined).text).toBe('No session')
  expect(runView(state(), session({ status: 'complete', running: false }), hop(3)).text).toBe('Ended')
  expect(runView(state(), session({ running: false }), hop(3)).text).toBe('Not polling')
  expect(runView(state({ ground: 'offline' }), session(), hop(3)).text).toBe('Ground service offline')
  const waiting = hop(1, { status: 'unavailable', error: NO_LABEL_YET, image_url: null, label: null })
  expect(runView(state(), session(), waiting).text).toBe('Waiting for the first confident label')
  expect(runView(state(), session(), hop(3))).toEqual({ text: 'Running', tone: 'live' })
})

test('session list shows each session with its state and hops, and selects on click', () => {
  const onSelect = vi.fn()
  const sessions = [
    session({ mission_id: 'GD-2', name: 'Car park', hops: 12 }),
    session({ mission_id: 'GD-1', name: 'Lawn', status: 'complete', running: false }),
  ]
  render(<SessionList sessions={sessions} selected="GD-1" onSelect={onSelect} />)
  const buttons = screen.getAllByRole('button')
  expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Car park: Polling', 'Lawn: Ended'])
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText('12 hops')).toBeInTheDocument()
  fireEvent.click(buttons[0])
  expect(onSelect).toHaveBeenCalledWith('GD-2')
})

test('with no sessions the list says how to start one', () => {
  render(<SessionList sessions={[]} selected={undefined} onSelect={() => {}} />)
  expect(screen.getByText(/Create one to start polling/)).toBeInTheDocument()
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

const actions = (over: Partial<GroundSession> = {}) => {
  const handlers = { onRename: vi.fn(), onStop: vi.fn(), onDelete: vi.fn() }
  render(<SessionActions session={session(over)} busy={false} {...handlers} />)
  return handlers
}

test('rename edits the name in place and saves it trimmed; cancel leaves it', () => {
  const { onRename } = actions()
  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  const input = screen.getByRole('textbox', { name: 'New session name' })
  expect(input).toHaveValue('Ground demo 10:15:00')
  fireEvent.change(input, { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '  Car park ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onRename).toHaveBeenCalledWith('Car park')
  expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onRename).toHaveBeenCalledTimes(1)
})

test('delete asks first and only deletes on confirm', () => {
  const { onDelete } = actions({ hops: 12 })
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(onDelete).not.toHaveBeenCalled()
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete Ground demo 10:15:00 and its 12 hops? Polling stops first.')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  expect(onDelete).toHaveBeenCalledTimes(1)
})

test('an ended session can be renamed and deleted but not stopped', () => {
  actions({ status: 'complete', running: false })
  expect(screen.getByRole('button', { name: 'Stop session' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
})
