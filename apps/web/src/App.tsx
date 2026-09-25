import { useQuery } from '@tanstack/react-query'
import { getJson, type Health } from './api/client'

export default function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => getJson<Health>('/health') })

  return (
    <div className="shell">
      <header className="topbar">
        <strong>PogoScout</strong>
        <span className="status" data-state={health.isSuccess ? 'ok' : 'down'}>
          API {health.isSuccess ? `online · classifier: ${health.data.classifier}` : 'offline'}
        </span>
      </header>
      <aside className="layers">Layers</aside>
      <main className="map">Map</main>
      <aside className="inspector">Cell inspector</aside>
      <footer className="timeline">Timeline / replay</footer>
    </div>
  )
}
