import type { Cell, SensorReading } from '../../api/types'
import { SensorBadge } from '../../components/SensorBadge'

function reading(r: SensorReading) {
  return r.status === 'ok' ? String(r.value) : `null (${r.status})`
}

export function CellInspector({ cell }: { cell: Cell | null }) {
  if (!cell) return <p className="muted">Select a cell to inspect its evidence.</p>

  return (
    <div className="inspector-body">
      <h2>
        Cell ({cell.x}, {cell.y})
      </h2>
      <p className="muted">Nominal grid position, not a measured location.</p>
      <div className="badges">
        <SensorBadge kind="metal" state={cell.metal} />
        <SensorBadge kind="voc" state={cell.voc} />
      </div>
      <h3>Visits ({cell.visit_count})</h3>
      <ol className="visits-list">
        {cell.observations.map((o) => (
          <li key={o.hop_id}>
            <strong>Hop {o.hop_id}</strong>
            <span className="muted"> · {new Date(o.observed_at).toISOString().slice(11, 19)}Z</span>
            <div>
              metal={reading(o.metal)} · voc={reading(o.voc)}
            </div>
          </li>
        ))}
      </ol>
      <p className="muted">Screenshot and material classification arrive in M3.</p>
    </div>
  )
}
