import { useEffect, useRef, useState } from 'react'
import type { CellsResponse } from '../../api/types'
import type { Layer } from '../../lib/cells'
import { MissionScene, type HeightMetric, type ViewMode } from './scene'

type Props = {
  data: CellsResponse
  layer: Layer
  selected: string | null
  onSelect: (key: string) => void
}

function webglSupported(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

export default function MissionMap({ data, layer, selected, onSelect }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef<MissionScene | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null)
  const [view, setView] = useState<ViewMode>('3d')
  const [metric, setMetric] = useState<HeightMetric>('none')
  const [supported] = useState(webglSupported)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new MissionScene(canvas)
    sceneRef.current = scene
    const observer = new ResizeObserver(([entry]) => scene.resize(entry.contentRect.width, entry.contentRect.height))
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.update(data), [data])
  useEffect(() => sceneRef.current?.setOptions({ layer, view, metric, selected }), [layer, view, metric, selected])

  if (!supported) return <div className="empty">3D rendering is not available in this browser.</div>

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <canvas
        ref={canvasRef}
        aria-label="Mission map"
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: false, pan: e.button === 2 || e.shiftKey || view === '2d' }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = e.clientX - d.x
          const dy = e.clientY - d.y
          if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
          if (d.pan) sceneRef.current?.pan(dx, dy)
          else sceneRef.current?.orbit(dx, dy)
          d.x = e.clientX
          d.y = e.clientY
        }}
        onPointerUp={(e) => {
          if (drag.current && !drag.current.moved) {
            const key = sceneRef.current?.pick(e.clientX, e.clientY)
            if (key) onSelect(key)
          }
          drag.current = null
        }}
        onWheel={(e) => sceneRef.current?.zoomBy(e.deltaY)}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          const key = sceneRef.current?.pick(e.clientX, e.clientY)
          if (key) sceneRef.current?.focus(key)
        }}
      />
      <div style={{ position: 'absolute', right: 20, top: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-sm"
            style={{ background: 'rgba(10,10,10,.8)' }}
            title="Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom, double-click a cell to fly to it"
            onClick={() => sceneRef.current?.recenter()}
          >
            Recenter
          </button>
          <div className="segmented">
            <button aria-pressed={view === '2d'} onClick={() => setView('2d')}>
              2D
            </button>
            <button aria-pressed={view === '3d'} onClick={() => setView('3d')}>
              3D
            </button>
          </div>
        </div>
        {view === '3d' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--muted)' }}>
            <span>Column height</span>
            <div className="segmented" style={{ borderColor: '#2a2a28' }}>
              <button aria-pressed={metric === 'none'} onClick={() => setMetric('none')} style={{ fontFamily: 'var(--font-ui)', padding: '6px 10px' }}>
                None
              </button>
              <button aria-pressed={metric === 'uncertainty'} onClick={() => setMetric('uncertainty')} style={{ fontFamily: 'var(--font-ui)', padding: '6px 10px' }}>
                Uncertainty
              </button>
            </div>
          </div>
        )}
        {view === '3d' && metric === 'uncertainty' && (
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Height shows classification uncertainty, not terrain.</span>
        )}
      </div>
      <span className="mono" style={{ position: 'absolute', left: 20, bottom: 16, fontSize: 11, color: 'var(--faint)', pointerEvents: 'none' }}>
        1 cell = 1 hop
      </span>
    </div>
  )
}
