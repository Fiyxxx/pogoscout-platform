import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { Inspector } from '../src/features/dashboard/Inspector'
import { LayerRail } from '../src/features/dashboard/LayerRail'
import { cell, classification, mission, observation } from './factories'

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

test('inspector shows a metal anomaly with its evidence and provenance', () => {
  const metal = cell(3, 2, 21, { metal: 'detected', flags: ['metal'] })
  renderIn(<Inspector mission={mission()} cell={metal} />)
  expect(screen.getByText('(3, 2)')).toBeInTheDocument()
  expect(screen.getByText('METAL ANOMALY')).toBeInTheDocument()
  expect(screen.getByText('021')).toBeInTheDocument()
  expect(screen.getByText('Detected')).toBeInTheDocument()
  expect(screen.getByText('Soil')).toBeInTheDocument()
  expect(screen.getByText('0.86')).toBeInTheDocument()
  expect(screen.getByText('material-model 0.3.0')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Ground capture for hop 21' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open evidence' })).toHaveAttribute('href', '/missions/PS-1/cells/3/2')
})

test('inspector shows classifying and missing capture states without inventing values', () => {
  const pending = classification({ status: 'queued', label: null, confidence: null, model_version: null, completed_at: null })
  const c = cell(1, 1, 7, { observations: [observation(7, { image: null, classification: pending })], flags: ['pending'] })
  renderIn(<Inspector mission={mission()} cell={c} />)
  expect(screen.getAllByText('Classifying').length).toBeGreaterThan(0)
  expect(screen.getByText('No capture yet')).toBeInTheDocument()
  expect(screen.getByText('Pending')).toBeInTheDocument()
  expect(screen.queryByText('0.86')).toBeNull()
})

test('legend follows the selected layer', () => {
  const cells = [cell(0, 1, 1, { metal: 'detected' })]
  const { rerender } = render(<LayerRail layer="combined" onLayer={() => {}} cells={cells} />)
  expect(screen.getByText('Soil')).toBeInTheDocument()
  expect(screen.getByText('Metal anomaly')).toBeInTheDocument()
  rerender(<LayerRail layer="metal" onLayer={() => {}} cells={cells} />)
  expect(screen.getByText('Sensor error')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Metal/ })).toHaveAttribute('aria-pressed', 'true')
})
