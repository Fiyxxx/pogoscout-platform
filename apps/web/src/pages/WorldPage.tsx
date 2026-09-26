import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, keys } from '../api/client'
import type { WorldMission } from '../api/types'
import type { MiniMapData } from '../features/missions/MiniMap'
import { NavTabs } from '../components/NavTabs'
import { HealthLights, TopBar } from '../components/TopBar'
import { MissionPreview } from '../features/missions/MissionPreview'
import { NewMissionDialog } from '../features/missions/NewMissionDialog'
import type { HeatLayer, WorldLayers } from '../features/world/WorldMap'
import { statusView } from '../lib/status'

const WorldMap = lazy(() => import('../features/world/WorldMap'))

export function WorldPage() {
  const world = useQuery({ queryKey: keys.world, queryFn: api.world, refetchInterval: 4_000 })
  const [focused, setFocused] = useState<string | null>(null)
  const [overview, setOverview] = useState(0)
  const [layers, setLayers] = useState<WorldLayers>({ heat: 'risk', areas: true, footprints: true })
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    document.title = 'Theatre - PogoScout'
  }, [])

  const missions = world.data?.missions ?? []
  const focusedWorld = missions.find((w) => w.mission.id === focused)
  const focusedMission = focusedWorld?.mission
  const totals = {
    live: missions.filter((w) => w.mission.status === 'live').length,
    cells: missions.reduce((a, w) => a + w.mission.stats.cells, 0),
    metal: missions.reduce((a, w) => a + w.mission.stats.metal, 0),
    areas: missions.reduce((a, w) => a + w.risk.areas.length, 0),
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <HealthLights />
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New mission
            </button>
          </div>
        }
      >
        <NavTabs />
      </TopBar>

      <div style={{ position: 'relative', flexGrow: 1, minHeight: 0 }}>
        <Suspense fallback={<div className="empty">Loading terrain</div>}>
          <WorldMap missions={missions} focused={focused} layers={layers} onFocus={setFocused} onOpenMission={(id) => navigate(`/missions/${id}`)} overviewSignal={overview} />
        </Suspense>

        <aside className="scroll" style={{ ...panel, left: 20, top: 20, width: 320, maxHeight: 'calc(100% - 180px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 16px 12px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <Total label="Live" value={totals.live} signal={totals.live > 0} />
            <Total label="Cells" value={totals.cells.toLocaleString('en-US')} />
            <Total label="Metal" value={totals.metal} signal={totals.metal > 0} />
            <Total label="Hazard areas" value={totals.areas} />
          </div>
          <h2 className="section-title" style={{ padding: '14px 16px 6px' }}>
            Missions
          </h2>
          {world.isLoading && <span className="muted" style={{ padding: '8px 16px' }}>Loading</span>}
          {missions.map((w) => (
            <MissionRow key={w.mission.id} w={w} active={w.mission.id === focused} onClick={() => setFocused(w.mission.id === focused ? null : w.mission.id)} />
          ))}
          {!world.isLoading && missions.length === 0 && (
            <span className="muted" style={{ padding: '8px 16px 16px', fontSize: 13 }}>No missions with a GPS fix yet.</span>
          )}
        </aside>

        {focusedMission && (
          <MissionPreview
            mission={focusedMission}
            map={focusedWorld && miniMapFrom(focusedWorld)}
            onClose={() => setFocused(null)}
            style={{ position: 'absolute', right: 20, top: 20, bottom: 84, border: '1px solid var(--line-strong)', background: 'rgba(10,10,10,.94)' }}
          />
        )}

        <div style={{ ...panel, left: 20, bottom: 20, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-sm"
              style={{ flexGrow: 1 }}
              onClick={() => {
                setFocused(null)
                setOverview((n) => n + 1)
              }}
            >
              Overview
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span className="key">Heat map</span>
            <div className="segmented" style={{ display: 'flex' }}>
              {HEAT_OPTIONS.map((o) => (
                <button key={o.id} aria-pressed={layers.heat === o.id} style={{ flexGrow: 1 }} onClick={() => setLayers({ ...layers, heat: o.id })}>
                  {o.name}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <Toggle label="Hazard areas" checked={layers.areas} onChange={(v) => setLayers({ ...layers, areas: v })} />
            <Toggle label="Mission cells" checked={layers.footprints} onChange={(v) => setLayers({ ...layers, footprints: v })} />
          </div>
          <HeatLegend heat={layers.heat} />
        </div>
      </div>
      {creating && <NewMissionDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** Mini map data from the theatre's compact cells, so the preview needs no extra request. */
function miniMapFrom(w: WorldMission): MiniMapData {
  const xs = w.cells.map((c) => c[0])
  const ys = w.cells.map((c) => c[1])
  return {
    bounds: { min_x: Math.min(0, ...xs), max_x: Math.max(0, ...xs), min_y: Math.min(0, ...ys), max_y: Math.max(0, ...ys) },
    cells: w.cells.map(([x, y, label, metal]) => ({
      x,
      y,
      metal: metal >= 0.5 ? 'detected' : 'not_detected',
      material: { status: label ? 'succeeded' : 'queued', label },
    })),
  }
}

const panel: React.CSSProperties = {
  position: 'absolute',
  background: 'rgba(10,10,10,.9)',
  border: '1px solid var(--line-strong)',
  backdropFilter: 'blur(8px)',
}

function Total({ label, value, signal }: { label: string; value: React.ReactNode; signal?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="key">{label}</span>
      <span className="mono" style={{ fontSize: 16, color: signal ? 'var(--signal)' : undefined }}>
        {value}
      </span>
    </div>
  )
}

function MissionRow({ w, active, onClick }: { w: WorldMission; active: boolean; onClick: () => void }) {
  const st = statusView(w.mission)
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: 'none', textAlign: 'left',
        background: active ? 'var(--text)' : 'transparent', color: active ? 'var(--bg)' : 'var(--text)', transition: 'background-color .2s ease',
      }}
    >
      <span className={st.pulse ? 'dot pulse' : 'dot'} style={{ width: 7, height: 7, color: active ? 'var(--bg)' : st.color }} />
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.mission.name}</span>
        <span className="mono" style={{ fontSize: 11, color: active ? '#5a5a56' : 'var(--faint)' }}>
          {w.mission.stats.cells.toLocaleString('en-US')} cells
        </span>
      </span>
      {w.risk.areas.length > 0 && (
        <span className="mono" style={{ fontSize: 13, color: active ? 'var(--bg)' : 'var(--signal)' }} title="Hazard areas">
          {w.risk.areas.length}
        </span>
      )}
    </button>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: checked ? 'var(--text)' : 'var(--muted)' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: '#f2f2f0' }} />
      {label}
    </label>
  )
}

const HEAT_OPTIONS: { id: HeatLayer; name: string }[] = [
  { id: 'risk', name: 'Risk' },
  { id: 'metal', name: 'Metal' },
  { id: 'voc', name: 'VOC' },
  { id: 'off', name: 'Off' },
]

const HEAT_LEGEND: Record<Exclude<HeatLayer, 'off'>, { gradient: string; low: string; high: string }> = {
  risk: { gradient: 'linear-gradient(90deg, rgba(255,196,0,0.35), rgba(255,140,20,0.7), #ff5a1f, #ff3a14)', low: 'P(hazard) low', high: 'Near certain' },
  metal: { gradient: 'linear-gradient(90deg, rgba(255,90,31,0.15), rgba(255,90,31,0.6), #ff5a1f, #ffd2bd)', low: 'Metal signal 0.30', high: 'Stronger' },
  voc: { gradient: 'linear-gradient(90deg, rgba(160,200,255,0.2), rgba(190,215,255,0.55), #e1ebff, #ffffff)', low: 'VOC signal 0.30', high: 'Stronger' },
}

function HeatLegend({ heat }: { heat: HeatLayer }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
      {heat !== 'off' && (
        <>
          <div style={{ height: 6, background: HEAT_LEGEND[heat].gradient }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
            <span>{HEAT_LEGEND[heat].low}</span>
            <span>{HEAT_LEGEND[heat].high}</span>
          </div>
        </>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', paddingTop: 2 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="area-swatch" />
          Hazard area
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 3px rgba(255,255,255,.15)' }} />
          Scout position
        </span>
        <span>Elevation ×1.5</span>
      </div>
    </div>
  )
}
