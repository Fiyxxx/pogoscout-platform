import type { Cell, CellsResponse, Point } from '../../api/types'

const CELL = 40
const PAD = 1

type Props = {
  data: CellsResponse
  selected: Point | null
  onSelect: (cell: Cell) => void
}

export function GridMap({ data, selected, onSelect }: Props) {
  const { bounds } = data
  const minX = bounds.min_x - PAD
  const maxX = bounds.max_x + PAD
  const minY = bounds.min_y - PAD
  const maxY = bounds.max_y + PAD
  const cols = maxX - minX + 1
  const rows = maxY - minY + 1
  // North (+y) is up: flip y into SVG space.
  const sx = (x: number) => (x - minX) * CELL
  const sy = (y: number) => (maxY - y) * CELL
  const centre = (p: Point) => `${sx(p.x) + CELL / 2},${sy(p.y) + CELL / 2}`
  const path = [data.origin, ...data.path].map(centre).join(' ')

  return (
    <svg
      className="grid-map"
      viewBox={`0 0 ${cols * CELL} ${rows * CELL}`}
      role="img"
      aria-label={`Nominal grid, ${data.cells.length} observed cells`}
    >
      {Array.from({ length: cols * rows }, (_, i) => (
        <rect
          key={`bg-${i}`}
          className="grid-bg"
          x={(i % cols) * CELL}
          y={Math.floor(i / cols) * CELL}
          width={CELL}
          height={CELL}
        />
      ))}
      {data.cells.map((cell) => {
        const isSelected = selected?.x === cell.x && selected?.y === cell.y
        return (
          <g
            key={`${cell.x},${cell.y}`}
            className="cell"
            data-testid={`cell-${cell.x}-${cell.y}`}
            data-selected={isSelected}
            role="button"
            tabIndex={0}
            aria-label={`Cell ${cell.x},${cell.y}: ${cell.visit_count} visit(s)`}
            onClick={() => onSelect(cell)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(cell)}
          >
            <rect x={sx(cell.x) + 1} y={sy(cell.y) + 1} width={CELL - 2} height={CELL - 2} />
            {cell.metal !== 'not_detected' && (
              <circle
                className="badge"
                data-kind="metal"
                data-state={cell.metal}
                cx={sx(cell.x) + 10}
                cy={sy(cell.y) + 10}
                r={5}
              />
            )}
            {cell.voc !== 'not_detected' && (
              <rect
                className="badge"
                data-kind="voc"
                data-state={cell.voc}
                x={sx(cell.x) + CELL - 15}
                y={sy(cell.y) + 5}
                width={10}
                height={10}
                transform={`rotate(45 ${sx(cell.x) + CELL - 10} ${sy(cell.y) + 10})`}
              />
            )}
            {cell.visit_count > 1 && (
              <text className="visits" x={sx(cell.x) + CELL - 6} y={sy(cell.y) + CELL - 6}>
                ×{cell.visit_count}
              </text>
            )}
          </g>
        )
      })}
      <polyline className="path" points={path} />
      <rect
        className="origin"
        x={sx(0) + CELL / 2 - 4}
        y={sy(0) + CELL / 2 - 4}
        width={8}
        height={8}
      />
      <circle
        className="current"
        data-testid="current-position"
        cx={sx(data.current.x) + CELL / 2}
        cy={sy(data.current.y) + CELL / 2}
        r={7}
      />
    </svg>
  )
}
