import type { Cell } from '../../api/types'
import { LAYERS, layerCounts, type Layer } from '../../lib/cells'
import { MATERIAL_COLORS, MATERIAL_NAMES, MATERIALS } from '../../lib/materials'

type Swatch = { label: string; fill: string; border?: string; shape?: 'dot' | 'diamond' }

const SENSOR_LEGEND = (detected: string): Swatch[] => [
  { label: 'Detected', fill: detected },
  { label: 'Not detected', fill: '#1c1c1b', border: '1px solid #3a3a37' },
  { label: 'Sensor error', fill: '#5a2410' },
  { label: 'No reading', fill: 'transparent', border: '1px dashed #8a8a86' },
]

function legendFor(layer: Layer, cells: Cell[]): Swatch[] {
  const present = MATERIALS.filter((m) => cells.some((c) => c.material.status === 'succeeded' && c.material.label === m))
  const materials: Swatch[] = present.map((m) => ({ label: MATERIAL_NAMES[m], fill: MATERIAL_COLORS[m] }))
  const classifying: Swatch = { label: 'Classifying', fill: '#161615', border: '1px dashed #8a8a86' }
  const markers: Swatch[] = [
    { label: 'Metal anomaly', fill: '#ff5a1f', shape: 'dot' },
    { label: 'VOC cue', fill: 'transparent', border: '2px solid #f2f2f0', shape: 'diamond' },
  ]
  switch (layer) {
    case 'combined':
      return [...materials, classifying, ...markers]
    case 'material':
      return [...materials, classifying]
    case 'captures':
      return markers
    case 'metal':
      return SENSOR_LEGEND('#ff5a1f')
    case 'voc':
      return SENSOR_LEGEND('#d9d9d4')
    case 'quality':
      return [
        { label: 'Complete', fill: '#2c3a2f' },
        { label: 'Low confidence (<0.80)', fill: '#8a6a24' },
        classifying,
        { label: 'Missing data', fill: '#121211', border: '1px dashed #8a8a86' },
        { label: 'Failed', fill: '#5a2410' },
        { label: 'Conflicting', fill: '#7a2a12' },
      ]
  }
}

export function LayerRail({ layer, onLayer, cells }: { layer: Layer; onLayer: (l: Layer) => void; cells: Cell[] }) {
  const counts = layerCounts(cells)
  return (
    <aside className="scroll" style={{ width: 240, flexShrink: 0, borderRight: '1px solid var(--line)', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 className="section-title" style={{ padding: '0 10px 8px' }}>
          Layers
        </h2>
        {LAYERS.map((l) => {
          const active = l.id === layer
          const count = counts[l.id]
          return (
            <button
              key={l.id}
              aria-pressed={active}
              onClick={() => onLayer(l.id)}
              style={{
                display: 'flex', alignItems: 'center', padding: '11px 10px', border: 'none', textAlign: 'left',
                background: active ? 'var(--text)' : 'transparent', color: active ? 'var(--bg)' : 'var(--text)',
                transition: 'background-color .2s ease, color .2s ease',
              }}
              onMouseEnter={(e) => !active && (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={(e) => !active && (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>{l.name}</span>
              {count ? (
                <span className="mono" style={{ fontSize: 12, color: active ? '#5a5a56' : l.id === 'metal' ? 'var(--signal)' : 'var(--muted)' }}>
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 10px' }}>
        <h2 className="section-title" style={{ paddingBottom: 4 }}>
          Legend
        </h2>
        {legendFor(layer, cells).map((s) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span
              style={{
                width: 14, height: 14, flexShrink: 0, background: s.fill, border: s.border ?? 'none',
                borderRadius: s.shape === 'dot' ? '50%' : 0, transform: s.shape === 'diamond' ? 'rotate(45deg) scale(.75)' : undefined,
              }}
            />
            <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
          </div>
        ))}
        {layer === 'captures' && <span style={{ fontSize: 13, color: 'var(--text-2)' }}>Cells show their ground capture.</span>}
      </div>
    </aside>
  )
}

