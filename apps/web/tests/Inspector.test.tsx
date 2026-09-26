import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, test } from 'vitest'
import { Inspector } from '../src/features/dashboard/Inspector'
import { LayerRail } from '../src/features/dashboard/LayerRail'
import { assessCells } from '../src/lib/risk'
import { cell, classification, mission, observation } from './factories'

const renderIn = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)
const noop = () => {}
const riskProps = { cellRisk: undefined, area: null, onCloseArea: noop, onPeak: noop }
const railProps = (cells: ReturnType<typeof cell>[]) => ({ risk: assessCells(cells), area: null, onArea: noop })

test('inspector shows a metal anomaly with its evidence and provenance', () => {
  const metal = cell(3, 2, 21, { metal: 'detected', flags: ['metal'] })
  renderIn(<Inspector mission={mission()} cell={metal} {...riskProps} />)
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
  renderIn(<Inspector mission={mission()} cell={c} {...riskProps} />)
  expect(screen.getAllByText('Classifying').length).toBeGreaterThan(0)
  expect(screen.getByText('No capture yet')).toBeInTheDocument()
  expect(screen.getByText('Pending')).toBeInTheDocument()
  expect(screen.queryByText('0.86')).toBeNull()
})

test('legend follows the selected layer', () => {
  const cells = [cell(0, 1, 1, { metal: 'detected' })]
  const { rerender } = render(<LayerRail layer="combined" onLayer={() => {}} cells={cells} {...railProps(cells)} />)
  expect(screen.getByText('Soil')).toBeInTheDocument()
  expect(screen.getByText('Metal anomaly')).toBeInTheDocument()
  rerender(<LayerRail layer="metal" onLayer={() => {}} cells={cells} {...railProps(cells)} />)
  expect(screen.getByText('Sensor error')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Metal/ })).toHaveAttribute('aria-pressed', 'true')
})

const strongMetal = (x: number, y: number, hop: number, value: number) =>
  cell(x, y, hop, { metal: 'detected', observations: [observation(hop, { metal: { value, status: 'ok' } })] })

test('inspector explains a cell rating with its reasons', () => {
  const c = strongMetal(2, 2, 5, 0.91)
  const risk = assessCells([c]).cells[0]
  renderIn(<Inspector mission={mission()} cell={c} {...riskProps} cellRisk={risk} />)
  expect(screen.getByText('Suspected explosive hazard')).toBeInTheDocument()
  expect(screen.getByText('Extremely high')).toBeInTheDocument()
  expect(screen.getByText('Metal 0.91')).toBeInTheDocument()
  expect(screen.getByText('+25 dB')).toBeInTheDocument()
  expect(screen.getByText('P 0.86 from +8 dB total')).toBeInTheDocument()
  expect(screen.getByText('0.91')).toBeInTheDocument()
})

test('inspector shows a hazard area with its action', () => {
  const area = assessCells([strongMetal(0, 0, 1, 0.8)]).areas[0]
  renderIn(<Inspector mission={mission()} cell={null} {...riskProps} area={area} />)
  expect(screen.getByText('A1')).toBeInTheDocument()
  expect(screen.getByText('Mark the area and bypass where possible. If passage is needed, use a cleared lane or request EOD.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Go to peak cell' })).toBeInTheDocument()
})

test('risk layer shows the summary, matrix and areas, without a verdict', () => {
  const cells = [strongMetal(0, 0, 1, 0.8), cell(5, 5, 2)]
  render(<LayerRail layer="risk" onLayer={() => {}} cells={cells} {...railProps(cells)} />)
  expect(screen.queryByText('No-go')).toBeNull()
  expect(screen.getByText('1 suspected explosive hazard')).toBeInTheDocument()
  expect(screen.getByRole('table', { name: 'Cells by likelihood and severity' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Suspected explosive hazard/ })).toBeInTheDocument()
})
