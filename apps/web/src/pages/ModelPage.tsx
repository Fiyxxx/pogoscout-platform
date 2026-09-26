import { useEffect, useRef, useState } from 'react'
import { NavTabs } from '../components/NavTabs'
import { TopBar } from '../components/TopBar'
import type { ModelScene } from '../features/model/modelScene'
import { AIRFRAME, BAYS, bayOf, DEFAULT_VARIANTS, EMPTY, LOADOUTS, type Module, MOUNTS, PARTS, type PartId, partNumber, type SlotId } from '../features/model/parts'

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
  const refit = (next: Record<SlotId, string>) => {
    setVariants(next)
    scene.current?.setVariants(next)
  }
  const part = PARTS.find((p) => p.id === selected)
  const bay = bayOf(selected)
  const fittedModule = bay?.modules.find((m) => m.id === variants[bay.id])
  const fitted = BAYS.filter((b) => variants[b.id] !== EMPTY).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar>
        <NavTabs />
      </TopBar>
      <div className="model-page" style={{ position: 'relative', flexGrow: 1, minHeight: 0 }}>
        <div ref={container} style={{ position: 'absolute', inset: 0, isolation: 'isolate' }} aria-label="PogoScout 3D model" role="img" />

        <aside className="model-panel" style={{ left: 24, top: 24, width: 300, maxHeight: 'calc(100% - 48px)', overflowY: 'auto', padding: '20px 0 12px' }}>
          <div style={{ padding: '0 20px 16px', borderBottom: '1px solid var(--m-line)' }}>
            <div className="brand" style={{ fontWeight: 800, fontSize: 20 }}>POGOSCOUT PS-1</div>
            <div style={{ fontSize: 13, color: 'var(--m-muted)', marginTop: 4 }}>Modular hopping scout</div>
          </div>
          <div className="model-section">Airframe</div>
          <div style={{ padding: '0 8px', display: 'flex', flexDirection: 'column' }}>
            {AIRFRAME.map((p) => (
              <PartRow key={p.id} id={p.id} name={p.name} selected={selected} hovered={hovered} onChoose={choose} />
            ))}
          </div>
          <div className="model-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--m-line)', marginTop: 10 }}>
            <span>Sensor payload</span>
            <span className="mono" style={{ fontSize: 11 }}>{fitted} of {BAYS.length} bays fitted</span>
          </div>
          <p style={{ margin: '0 20px 10px', fontSize: 12, color: 'var(--m-muted)', lineHeight: 1.5 }}>
            Sensors ride on the pogo leg. One mount and connector per bay, swapped in the field without tools.
          </p>
          <div className="model-loadouts" role="group" aria-label="Loadout">
            {LOADOUTS.map((l) => {
              const on = BAYS.every((b) => variants[b.id] === l.variants[b.id])
              return (
                <button key={l.id} aria-pressed={on} title={l.summary} onClick={() => refit({ ...l.variants })}>
                  {l.name}
                </button>
              )
            })}
          </div>
          {MOUNTS.map((mount) => (
            <div key={mount.id} style={{ padding: '0 8px', display: 'flex', flexDirection: 'column' }}>
              <div className="model-zone">{mount.name}</div>
              {BAYS.filter((b) => b.mount === mount.id).map((b) => {
                const mod = b.modules.find((m) => m.id === variants[b.id])
                return (
                  <PartRow key={b.id} id={b.id} name={b.name} selected={selected} hovered={hovered} onChoose={choose}>
                    {mod ? <span className="model-fit">{mod.name}</span> : <span className="model-fit" data-empty="true">Add</span>}
                  </PartRow>
                )
              })}
            </div>
          ))}
          <p style={{ margin: '12px 20px 0', paddingTop: 12, borderTop: '1px solid var(--m-line)', fontSize: 12, color: 'var(--m-muted)' }}>
            Drag to rotate, scroll to zoom. Click any part to take it apart.
          </p>
        </aside>

        {part && (
          <aside className="model-panel" style={{ right: 24, top: 24, width: 400, padding: 24, display: 'flex', flexDirection: 'column', gap: 18, maxHeight: 'calc(100% - 140px)', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--signal)' }}>
                  {partNumber(part.id)}
                  {bay && <span style={{ color: 'var(--m-muted)', marginLeft: 10 }}>{bay.standard ? 'Standard bay' : 'Optional bay'}</span>}
                </div>
                <h2 className="brand" style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 700 }}>{part.name}</h2>
                <div style={{ fontSize: 14, color: 'var(--m-muted)', marginTop: 4 }}>{part.role}</div>
              </div>
              <button className="model-close" aria-label="Close" onClick={() => choose(null)}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            </div>
            {bay && <Spec module={fittedModule} mount={MOUNTS.find((m) => m.id === bay.mount)!.name} />}
            <div>
              <div style={{ fontSize: 12, color: 'var(--m-muted)', marginBottom: 6 }}>How it works</div>
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{part.how}</p>
            </div>
            {bay && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-muted)', marginBottom: 6 }}>Why it sits here</div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>{bay.placement}</p>
              </div>
            )}
            {bay && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--m-muted)', marginBottom: 8 }}>Modules for this bay</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {bay.modules.map((m) => {
                    const on = variants[bay.id] === m.id
                    return (
                      <button key={m.id} className="model-variant" data-fitted={on} onClick={() => refit({ ...variants, [bay.id]: m.id })}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: 600, fontSize: 14 }}>
                          {m.name}
                          <span style={{ fontSize: 12, color: on ? 'var(--signal)' : 'var(--m-muted)', fontWeight: 500 }}>{on ? 'Fitted' : 'Fit'}</span>
                        </span>
                        <span className="mono" style={{ fontSize: 11, color: 'var(--m-ink)' }}>{m.part}</span>
                        <span style={{ fontSize: 12, color: 'var(--m-muted)', textAlign: 'left', lineHeight: 1.45 }}>{m.summary}</span>
                      </button>
                    )
                  })}
                  {!bay.standard && (
                    <button className="model-variant" data-fitted={variants[bay.id] === EMPTY} onClick={() => refit({ ...variants, [bay.id]: EMPTY })}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontWeight: 600, fontSize: 14 }}>
                        Leave empty
                        {variants[bay.id] === EMPTY && <span style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500 }}>Current</span>}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--m-muted)', textAlign: 'left' }}>Saves weight and power when the mission does not need it.</span>
                    </button>
                  )}
                </div>
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

function PartRow(props: {
  id: PartId
  name: string
  selected: PartId | null
  hovered: PartId | null
  onChoose: (id: PartId | null) => void
  children?: React.ReactNode
}) {
  const active = props.id === props.selected
  return (
    <button className="model-part" data-active={active} data-hover={props.id === props.hovered} onClick={() => props.onChoose(active ? null : props.id)}>
      <span className="mono" style={{ fontSize: 11, color: active ? 'var(--signal)' : 'var(--m-muted)' }}>{partNumber(props.id)}</span>
      <span style={{ flexGrow: 1 }}>{props.name}</span>
      {props.children}
    </button>
  )
}

/** The fitted module's real component, key figure and interface. */
function Spec({ module: m, mount }: { module?: Module; mount: string }) {
  const rows: [string, string][] = m
    ? [['Fitted', m.name], ['Part', m.part], ['Spec', m.spec], ['Interface', m.iface], ['Mount', mount]]
    : [['Fitted', 'Empty'], ['Mount', mount]]
  return (
    <dl className="model-spec">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={k === 'Part' ? 'mono' : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  )
}
