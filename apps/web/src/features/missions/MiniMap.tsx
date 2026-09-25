import type { CellsResponse } from '../../api/types'
import { cellKey } from '../../lib/cells'
import { isMaterial, MATERIAL_COLORS } from '../../lib/materials'

/** Flat material map of a mission, for previews. Highlights one cell when given. */
export function MiniMap({ data, width, height, highlight, maxCell = 34 }: { data: CellsResponse; width: number; height: number; highlight?: string; maxCell?: number }) {
  if (data.cells.length === 0) {
    return (
      <div className="empty" style={{ width, height, fontSize: 13 }}>
        No hops yet
      </div>
    )
  }
  const { min_x, max_x, min_y, max_y } = data.bounds
  const cols = max_x - min_x + 1
  const rows = max_y - min_y + 1
  // Cells shrink to fit long corridors; below 6 px the gutter between cells is dropped.
  const size = Math.max(1, Math.min(maxCell, Math.min((width - 40) / cols, (height - 40) / rows)))
  const gap = size >= 6 ? 2 : 0
  const dot = Math.max(4, Math.min(8, size * 1.5))
  const ox = Math.round((width - cols * size) / 2)
  const oy = Math.round((height - rows * size) / 2)

  return (
    <div style={{ position: 'relative', width, height, overflow: 'hidden' }} aria-hidden="true">
      {data.cells.map((c) => {
        const left = ox + (c.x - min_x) * size
        const top = oy + (max_y - c.y) * size
        const on = highlight === cellKey(c)
        const label = c.material.label
        const fill = on ? '#f2f2f0' : c.material.status === 'succeeded' && isMaterial(label) ? MATERIAL_COLORS[label] : '#2a2a28'
        return (
          <span key={cellKey(c)}>
            <span style={{ position: 'absolute', left, top, width: Math.max(1, size - gap), height: Math.max(1, size - gap), background: fill, transition: 'background-color .3s ease' }} />
            {c.metal === 'detected' && !on && (
              <span style={{ position: 'absolute', left: left + size / 2 - dot / 2, top: top + size / 2 - dot / 2, width: dot, height: dot, borderRadius: '50%', background: 'var(--signal)', boxShadow: '0 0 0 1px var(--bg)' }} />
            )}
          </span>
        )
      })}
    </div>
  )
}
