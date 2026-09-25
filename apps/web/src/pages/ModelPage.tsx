import { useEffect, useRef, useState } from 'react'
import { NavTabs } from '../components/NavTabs'
import { TopBar } from '../components/TopBar'
import type { ModelScene } from '../features/model/modelScene'
import { DEFAULT_VARIANTS, PARTS, type PartId, type SlotId, VARIANTS } from '../features/model/parts'

/** Presentation page: an explorable line drawing of the PogoScout and its swappable modules. */
export function ModelPage() {
  const container = useRef<HTMLDivElement>(null)
  const scene = useRef<ModelScene | null>(null)
  const [selected, setSelected] = useState<PartId | null>(null)
  const [hovered, setHovered] = useState<PartId | null>(null)
  const [exploded, setExploded] = useState(false)
  const [spin, setSpin] = useState(true)
  const [variants, setVariants] = useState<Record<SlotId, string>>({ ...DEFAULT_VARIANTS })

  useEffect(() => {
    document.title = '3D - PogoScout'
    let disposed = false
    import('../features/model/modelScene').then(({ ModelScene }) => {
      if (disposed || !container.current) return
      scene.current = new ModelScene(
        container.current,
        (id) => {
          setSelected(id)
          if (id) setExploded(true)
          setSpin(false)
        },
        setHovered,
      )
    })
    return () => {
      disposed = true
      scene.current?.dispose()
      scene.current = null
    }
  }, [])

  const choose = (id: PartId | null) => {
    setSelected(id)
    if (id) setExploded(true)
    setSpin(false)
    scene.current?.select(id)
    scene.current?.setAutoRotate(false)
  }
  const part = PARTS.find((p) => p.id === selected)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar>
        <NavTabs />
      </TopBar>
      <div className="model-page" style={{ position: 'relative', flexGrow: 1, minHeight: 0 }}>
        <div ref={container} style={{ position: 'absolute', inset: 0, isolation: 'isolate' }} aria-label="PogoScout 3D model" role="img" />

        <aside className="model-panel" style={{ left: 24, top: 24, width: 280, padding: '20px 0 12px' }}>
          <div style={{ padding: '0 20px 16px', borderBottom: '1px solid var(--m-line)' }}>
            <div className="brand" style={{ fontWeight: 800, fontSize: 20 }}>POGOSCOUT PS-1</div>
            <div style={{ fontSize: 13, color: 'var(--m-muted)', marginTop: 4 }}>Modular hopping scout</div>
          </div>
          <div style={{ padding: '10px 8px 0', display: 'flex', flexDirection: 'column' }}>
            {PARTS.map((p, i) => {
              const active = p.id === selected
              const hover = p.id === hovered
              return (
                <button key={p.id} className="model-part" data-active={active} data-hover={hover} onClick={() => choose(active ? null : p.id)}>
                  <span className="mono" style={{ fontSize: 11, color: active ? 'var(--signal)' : 'var(--m-muted)' }}>{String(i + 1).padStart(2, '0')}</span>
                  <span style={{ flexGrow: 1 }}>{p.name}</span>
                  {p.slot && <span className="mono" style={{ fontSize: 10, color: 'var(--m-muted)' }}>{VARIANTS[p.slot].length} options</span>}
                </button>
              )
            })}
          </div>
          <p style={{ margin: '12px 20px 0', fontSize: 12, color: 'var(--m-muted)', lineHeight: 1.5 }}>
            Drag to rotate, scroll to zoom. Click any part to take it apart.
          </p>
        </aside>

        {part && (
          <aside className="model-panel" style={{ right: 24, top: 24, width: 380, padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: 'calc(100% - 140px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--signal)' }}>{String(PARTS.indexOf(part) + 1).padStart(2, '0')}</div>
                <h2 className="brand" style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700 }}>{part.name}</h2>
                <div style={{ fontSize: 14, color: 'var(--m-muted)', marginTop: 4 }}>{part.role}</div>
              </div>
              <button className="model-close" aria-label="Close" onClick={() => choose(null)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--m-muted)', marginBottom: 6 }}>How it works</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{part.how}</p>
            </div>
            {part.slot && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-muted)', marginBottom: 8 }}>Interchangeable modules</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {VARIANTS[part.slot].map((v) => {
                    const slot = part.slot!
                    const fitted = variants[slot] === v.id
                    return (
                      <button
                        key={v.id}
                        className="model-variant"
                        data-fitted={fitted}
                        onClick={() => {
                          setVariants({ ...variants, [slot]: v.id })
                          scene.current?.setVariant(slot, v.id)
                        }}
                      >
                        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: 600, fontSize: 14 }}>
                          {v.name}
                          {fitted && <span className="mono" style={{ fontSize: 10, color: 'var(--signal)', fontWeight: 500 }}>FITTED</span>}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--m-muted)', textAlign: 'left' }}>{v.summary}</span>
                      </button>
                    )
                  })}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--m-muted)', lineHeight: 1.5 }}>
                  Every bay shares one mount and connector, so modules swap in the field and the platform picks up the new sensor on the next hop.
                </p>
              </div>
            )}
          </aside>
        )}

        <div className="model-panel" style={{ left: '50%', bottom: 24, transform: 'translateX(-50%)', padding: 6, display: 'flex', gap: 6 }}>
          <div className="model-seg">
            <button aria-pressed={!exploded} onClick={() => { setExploded(false); setSelected(null); scene.current?.setExploded(false) }}>Assembled</button>
            <button aria-pressed={exploded} onClick={() => { setExploded(true); scene.current?.setExploded(true) }}>Exploded</button>
          </div>
          <button className="model-btn" onClick={() => { setExploded(false); setSelected(null); scene.current?.hop() }}>Hop</button>
          <button className="model-btn" aria-pressed={spin} onClick={() => { setSpin(!spin); scene.current?.setAutoRotate(!spin) }}>Turntable</button>
        </div>
      </div>
    </div>
  )
}
