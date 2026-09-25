import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CellInspector } from '../src/features/inspector/CellInspector'
import { cellsFixture } from './fixtures'

test('shows every visit and distinguishes negative from sensor error', () => {
  render(<CellInspector cell={cellsFixture.cells[0]} />)
  expect(screen.getByText('Hop 1')).toBeInTheDocument()
  expect(screen.getByText('Hop 3')).toBeInTheDocument()
  expect(screen.getByText('metal=1 · voc=null (error)')).toBeInTheDocument()
  expect(screen.getByText('metal=0 · voc=null (error)')).toBeInTheDocument()
  expect(screen.getByText('VOC activity cue: Sensor error')).toBeInTheDocument()
})

test('empty state', () => {
  render(<CellInspector cell={null} />)
  expect(screen.getByText(/Select a cell/)).toBeInTheDocument()
})
