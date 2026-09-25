import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MissionsPage } from '../src/pages/MissionsPage'
import { cell, cellsResponse, mission } from './factories'

const MISSIONS = [
  mission(),
  mission({ id: 'PS-2', name: 'Drainage Culvert', status: 'aborted', status_note: 'Link lost after hop 9', scenario_id: null, stats: { hops: 9, cells: 9, metal: 1, voc: 0, flags: 2, materials: { concrete: 9 } } }),
]

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = url.endsWith('/missions')
        ? MISSIONS
        : url.includes('/cells')
          ? cellsResponse([cell(0, 1, 1)])
          : { status: 'ok', classifier: 'mock', classifier_status: 'ok', model_version: null }
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

test('lists missions, filters by status and previews the selection', async () => {
  renderPage()
  expect(await screen.findByText('Drainage Culvert')).toBeInTheDocument()
  const preview = screen.getByRole('link', { name: 'Open live mission' })
  expect(preview).toHaveAttribute('href', '/missions/PS-1')

  fireEvent.click(screen.getByRole('tab', { name: /Aborted/ }))
  expect(screen.queryByText('PS-1')).toBeNull()
  const row = screen.getAllByText('Drainage Culvert').map((el) => el.closest('tr')).find(Boolean)!
  expect(within(row).getByText('Aborted')).toBeInTheDocument()

  fireEvent.click(row)
  expect(await screen.findByText('Link lost after hop 9')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Open mission' })).toHaveAttribute('href', '/missions/PS-2')
})

test('search narrows the list', async () => {
  renderPage()
  await screen.findByText('Drainage Culvert')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search missions' }), { target: { value: 'culvert' } })
  expect(screen.queryByText('PS-1')).toBeNull()
  expect(screen.getAllByText('Drainage Culvert').length).toBeGreaterThan(0)
})
