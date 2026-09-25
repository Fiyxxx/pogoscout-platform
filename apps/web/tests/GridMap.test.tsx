import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { GridMap } from '../src/features/map2d/GridMap'
import { cellsFixture } from './fixtures'

test('renders observed cells with anomaly badges and selects on click', () => {
  const onSelect = vi.fn()
  render(<GridMap data={cellsFixture} selected={{ x: 1, y: 1 }} onSelect={onSelect} />)

  const anomalous = screen.getByTestId('cell-0-1')
  expect(anomalous.querySelector('[data-kind="metal"][data-state="detected"]')).not.toBeNull()
  expect(anomalous.querySelector('[data-kind="voc"][data-state="sensor_error"]')).not.toBeNull()
  expect(screen.getByTestId('cell-1-1')).toHaveAttribute('data-selected', 'true')
  expect(screen.getByTestId('cell-1-1').querySelector('.badge')).toBeNull()

  fireEvent.click(anomalous)
  expect(onSelect).toHaveBeenCalledWith(cellsFixture.cells[0])
})

test('north is up: higher y renders above lower y', () => {
  render(<GridMap data={cellsFixture} selected={null} onSelect={() => {}} />)
  const current = screen.getByTestId('current-position')
  const originCy = Number(document.querySelector('.origin')!.getAttribute('y'))
  expect(Number(current.getAttribute('cy'))).toBeLessThan(originCy)
})
