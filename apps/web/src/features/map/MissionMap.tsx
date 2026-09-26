import { useEffect, useRef, useState } from 'react'
import type { CellsResponse } from '../../api/types'
import { cellKey, type Layer } from '../../lib/cells'
import { CELL_M, footprintM } from '../../lib/geo'
import { MissionScene, type HeightMetric, type ViewMode } from './scene'
import { LEVEL_NAMES, type RiskAssessment } from '../../lib/risk'

type Props = {
  data: CellsResponse
  layer: Layer
  selected: string | null
  onSelect: (key: string) => void
  risk: RiskAssessment
  area: string | null
  onArea: (id: string | null) => void
}

// Checked once per page load. The probe context is released straight away: browsers cap the
// number of live WebGL contexts, and a leaked one per mount eventually starves the real map.
let webgl: boolean | undefined
function webglSupported(): boolean {
  if (webgl === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2')
      webgl = !!gl
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      webgl = false
    }
  }
  return webgl
}

export default function MissionMap({ data, layer, selected, onSelect, risk, area, onArea }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<MissionScene | null>(null)
  const drag = useRef<{ x: number; y: number; moved: boolean; pan: boolean } | null>(null)
  const [view, setView] = useState<ViewMode>('3d')
  const [metric, setMetric] = useState<HeightMetric>('none')
  const [supported] = useState(webglSupported)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // A fresh canvas per mount: a disposed scene releases its context, so the canvas can't be reused.
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'width: 100%; height: 100%; display: block'
    host.appendChild(canvas)
    const scene = new MissionScene(canvas)
    sceneRef.current = scene
    const observer = new ResizeObserver(([entry]) => scene.resize(entry.contentRect.width, entry.contentRect.height))
    observer.observe(canvas)
    return () => {
      observer.disconnect()
      scene.dispose()
      canvas.remove()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.update(data), [data])

  // Risk levels for the risk layer: U marks cells that could not be assessed.
  useEffect(() => {
    const levels = new Map<string, string>()
    for (const c of risk.cells) levels.set(cellKey(c), c.assessed ? (c.level ?? '') : 'U')
    sceneRef.current?.setRisk(levels)
  }, [risk])

  // Hotspots are HTML over the canvas; the scene moves them after every frame.
  const hotspots = useRef(new Map<string, HTMLElement>())
  const tip = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const showHotspots = layer === 'risk'
  const latest = useRef({ risk, hovered })
  useEffect(() => {
    latest.current = { risk, hovered }
  })
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    scene.onFrame = () => {
      const { risk: r, hovered: h } = latest.current
      for (const a of r.areas) {
        const el = hotspots.current.get(a.id)
        if (!el) continue
        const p = scene.project(a.centroid[0], a.centroid[1])
        el.style.left = `${p.left}px`
        el.style.top = `${p.top}px`
        el.style.visibility = p.visible ? 'visible' : 'hidden'
        if (a.id === h && tip.current) {
          tip.current.style.left = `${p.left}px`
          tip.current.style.top = `${p.top}px`
        }
      }
    }
    return () => {
      scene.onFrame = null
    }
  }, [])
  const hoveredArea = risk.areas.find((a) => a.id === hovered)

  // Fly to an area when it is chosen, from a hotspot or from the list.
  useEffect(() => {
    const chosen = latest.current.risk.areas.find((a) => a.id === area)
    if (chosen) sceneRef.current?.focus(cellKey({ x: chosen.peak[0], y: chosen.peak[1] }))
  }, [area])
  useEffect(() => sceneRef.current?.setOptions({ layer, view, metric, selected }), [layer, view, metric, selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '+' || e.key === '=') sceneRef.current?.zoomBy(-400)
      if (e.key === '-' || e.key === '_') sceneRef.current?.zoomBy(400)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!supported) return <div className="empty">3D rendering is not available in this browser.</div>

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        ref={hostRef}
        role="img"
        aria-label="Mission map"
        style={{ position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none' }}
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
      {showHotspots && (
        <div className="map-hotspots">
          {risk.areas.map((a) => (
            <button
              key={a.id}
              ref={(el) => {
                if (el) hotspots.current.set(a.id, el)
                else hotspots.current.delete(a.id)
              }}
              className="area-marker"
              data-level={a.level}
              data-kind={a.kind}
              data-active={a.id === area}
              aria-label={`${a.id} ${a.label}, ${LEVEL_NAMES[a.level]} risk`}
              onMouseEnter={() => setHovered(a.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onArea(a.id === area ? null : a.id)}
            >
              <span className="ring" />
              <span className="core" />
            </button>
          ))}
          {hoveredArea && (
            <div ref={tip} className="map-hotspot-tip">
              <strong style={{ color: `var(--risk-${hoveredArea.level.toLowerCase()})` }}>{LEVEL_NAMES[hoveredArea.level]}</strong>
              {hoveredArea.id} {hoveredArea.label}
            </div>
          )}
        </div>
      )}
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
      <div style={{ position: 'absolute', right: 20, bottom: 16, display: 'flex', flexDirection: 'column', border: '1px solid var(--line-strong)', background: 'rgba(10,10,10,.8)' }}>
        <button className="btn" aria-label="Zoom in (+)" title="Zoom in (+)" style={{ width: 40, height: 40, padding: 0, border: 'none', borderBottom: '1px solid var(--line-strong)' }} onClick={() => sceneRef.current?.zoomBy(-400)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button className="btn" aria-label="Zoom out (-)" title="Zoom out (-)" style={{ width: 40, height: 40, padding: 0, border: 'none' }} onClick={() => sceneRef.current?.zoomBy(400)}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
      </div>
      <span className="mono" style={{ position: 'absolute', left: 20, bottom: 16, fontSize: 11, color: 'var(--faint)', pointerEvents: 'none' }}>
        1 cell = 1 hop = {CELL_M} × {CELL_M} m{data.cells.length > 0 && ` · area ${footprintM(data.bounds).join(' × ')} m`}
      </span>
    </div>
  )
}
