import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from './api/client'
import type { Point } from './api/types'
import { CellInspector } from './features/inspector/CellInspector'
import { GridMap } from './features/map2d/GridMap'
import { MissionPicker } from './features/mission/MissionPicker'

export default function App() {
  const [missionId, setMissionId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Point | null>(null)
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 5000 })
  const cells = useQuery({
    queryKey: ['cells', missionId],
    queryFn: () => api.cells(missionId!),
    enabled: missionId !== null,
  })
  const selectedCell =
    cells.data?.cells.find((c) => c.x === selected?.x && c.y === selected?.y) ?? null

  return (
    <div className="shell">
      <header className="topbar">
        <strong>PogoScout</strong>
        <MissionPicker
          value={missionId}
          onChange={(id) => {
            setMissionId(id)
            setSelected(null)
          }}
        />
        {cells.data && (
          <span className="muted">
            {cells.data.path.length} hops
            {cells.data.pending_hop_ids.length > 0 &&
              ` · ${cells.data.pending_hop_ids.length} pending`}
          </span>
        )}
        <span className="status" data-state={health.isSuccess ? 'ok' : 'down'}>
          API {health.isSuccess ? `online · classifier: ${health.data.classifier}` : 'offline'}
        </span>
      </header>
      <aside className="layers">
        <h3>Legend</h3>
        <ul className="legend">
          <li><span className="swatch metal" /> Metal anomaly</li>
          <li><span className="swatch voc" /> VOC activity cue</li>
          <li><span className="swatch error" /> Sensor error / missing</li>
          <li><span className="swatch current" /> Current position</li>
        </ul>
      </aside>
      <main className="map">
        {!missionId && <p className="muted">Create or select a mission.</p>}
        {cells.isError && <p className="error">Failed to load cells: {cells.error.message}</p>}
        {cells.data && (
          <GridMap data={cells.data} selected={selected} onSelect={(c) => setSelected(c)} />
        )}
      </main>
      <aside className="inspector">
        <CellInspector cell={selectedCell} />
      </aside>
      <footer className="timeline muted">Timeline and replay controls arrive in M2.</footer>
    </div>
  )
}
