import type { CellsResponse, Point } from '../../api/types'
import { groundColor, groundName, LOW_CONFIDENCE } from './labels'

const SIZE = 40

/**
 * Plain 2D map of the materials seen so far, north up, so the newest lanes sit at the top.
 * MissionMap isn't used: it expects a risk assessment and doesn't know wood.
 */
export function GroundGrid({
  cells,
  selected,
  onSelect,
}: {
  cells: CellsResponse
  selected: Point | null
  onSelect: (p: Point) => void
}) {
  // Sized to the cells, not the response bounds: those include the origin, where no hop lands.
  const xs = cells.cells.map((c) => c.x)
  const ys = cells.cells.map((c) => c.y)
  const [min_x, max_x, min_y, max_y] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const byPosition = new Map(cells.cells.map((c) => [`${c.x},${c.y}`, c]))
  const current = cells.path.length ? cells.current : null
  const columns = max_x - min_x + 1
  const rows: number[] = []
  for (let y = max_y; y >= min_y; y--) rows.push(y)

  return (
    <div
      role="group"
      aria-label="Materials seen so far"
      style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, ${SIZE}px)`, gap: 2, width: 'max-content' }}
    >
      {rows.flatMap((y) =>
        Array.from({ length: columns }, (_, i) => {
          const x = min_x + i
          const cell = byPosition.get(`${x},${y}`)
          if (!cell) return <span key={`${x},${y}`} style={{ width: SIZE, height: SIZE }} />
          const m = cell.material
          const known = m.status === 'succeeded'
          const isCurrent = current?.x === x && current?.y === y
          const isSelected = selected?.x === x && selected?.y === y
          const name = known ? groundName(m.label) : m.status === 'none' ? 'Reading' : 'No reading'
          return (
            <button
              key={`${x},${y}`}
              aria-pressed={isSelected}
              title={`(${x}, ${y}) ${name}${known && m.confidence !== null ? ` ${m.confidence.toFixed(2)}` : ''}`}
              aria-label={`Cell (${x}, ${y}): ${name}`}
              onClick={() => onSelect({ x, y })}
              style={{
                width: SIZE,
                height: SIZE,
                padding: 0,
                border: 'none',
                background: known ? groundColor(m.label) : 'var(--surface-2)',
                backgroundImage: known
                  ? undefined
                  : 'repeating-linear-gradient(45deg, transparent 0 5px, rgba(255,255,255,0.06) 5px 6px)',
                outline: isSelected ? '3px solid var(--text)' : isCurrent ? '2px solid var(--signal)' : undefined,
                outlineOffset: isSelected ? -3 : -2,
                // Low-confidence cells are drawn fainter: the label is the model's best guess.
                opacity: known && (m.confidence ?? 0) < LOW_CONFIDENCE ? 0.55 : 1,
              }}
            />
          )
        }),
      )}
    </div>
  )
}

/** Swatches for the labels on the map, most common first. */
export function GridLegend({ cells }: { cells: CellsResponse }) {
  const counts = new Map<string, number>()
  for (const c of cells.cells) {
    if (c.material.status === 'succeeded' && c.material.label) counts.set(c.material.label, (counts.get(c.material.label) ?? 0) + 1)
  }
  const entries = [...counts].sort((a, b) => b[1] - a[1])
  if (!entries.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12 }}>
      {entries.map(([label, n]) => (
        <span key={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-2)' }}>
          <span style={{ width: 10, height: 10, background: groundColor(label) }} />
          {groundName(label)}
          <span className="mono faint">{n}</span>
        </span>
      ))}
    </div>
  )
}
