import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'

test('renders dashboard shell', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>,
  )
  expect(screen.getByText('PogoScout')).toBeInTheDocument()
  expect(screen.getByText(/Select a cell/)).toBeInTheDocument()
})
