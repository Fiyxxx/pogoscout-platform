import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'
import { api, keys } from '../api/client'
import type { WorldMission } from '../api/types'
import { NavTabs } from '../components/NavTabs'
import { HealthLights, TopBar } from '../components/TopBar'
import { MissionPreview } from '../features/missions/MissionPreview'
import { NewMissionDialog } from '../features/missions/NewMissionDialog'
import type { WorldLayers } from '../features/world/WorldMap'
import { statusView } from '../lib/status'

const WorldMap = lazy(() => import('../features/world/WorldMap'))

export function WorldPage() {
  const world = useQuery({ queryKey: keys.world, queryFn: api.world, refetchInterval: 4_000 })
  const [focused, setFocused] = useState<string | null>(null)
  const [overview, setOverview] = useState(0)
  const [layers, setLayers] = useState<WorldLayers>({ basemap: 'relief', hotspots: true, footprints: true })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    document.title = 'Theatre - PogoScout'
  }, [])

  const missions = world.data?.missions ?? []
  const focusedMission = missions.find((w) => w.mission.id === focused)?.mission
  const totals = {
    live: missions.filter((w) => w.mission.status === 'live').length,
    metal: missions.reduce((a, w) => a + w.mission.stats.metal, 0),
    voc: missions.reduce((a, w) => a + w.mission.stats.voc, 0),
    cells: missions.reduce((a, w) => a + w.mission.stats.cells, 0),
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
          <WorldMap missions={missions} focused={focused} layers={layers} onFocus={setFocused} overviewSignal={overview} />
        </Suspense>

        <aside className="scroll" style={{ ...panel, left: 20, top: 20, width: 320, maxHeight: 'calc(100% - 180px)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 16px 12px', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, borderBottom: '1px solid var(--line)' }}>
            <Total label="Live" value={totals.live} signal={totals.live > 0} />
            <Total label="Cells" value={totals.cells.toLocaleString('en-US')} />
            <Total label="Metal" value={totals.metal} signal={totals.metal > 0} />
            <Total label="VOC" value={totals.voc} />
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
            onClose={() => setFocused(null)}
            style={{ position: 'absolute', right: 20, top: 20, bottom: 76, border: '1px solid var(--line-strong)', background: 'rgba(10,10,10,.94)' }}
          />
        )}

        <div style={{ ...panel, left: 20, bottom: 20, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="segmented" style={{ flexGrow: 1 }}>
              <button style={{ flexGrow: 1, fontFamily: 'var(--font-ui)' }} aria-pressed={layers.basemap === 'relief'} onClick={() => setLayers({ ...layers, basemap: 'relief' })}>
                Relief
              </button>
              <button style={{ flexGrow: 1, fontFamily: 'var(--font-ui)' }} aria-pressed={layers.basemap === 'satellite'} onClick={() => setLayers({ ...layers, basemap: 'satellite' })}>
                Satellite
              </button>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => {
                setFocused(null)
                setOverview((n) => n + 1)
              }}
            >
              Overview
            </button>
          </div>
          <div style={{ display: 'flex', gap: 16, fontSize: 13 }}>
            <Toggle label="Anomaly density" checked={layers.hotspots} onChange={(v) => setLayers({ ...layers, hotspots: v })} />
            <Toggle label="Mission cells" checked={layers.footprints} onChange={(v) => setLayers({ ...layers, footprints: v })} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <div style={{ height: 6, background: 'linear-gradient(90deg, rgba(255,90,31,0.15), rgba(255,90,31,0.6), #ff5a1f, #ffd2bd)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)' }}>
              <span>Metal anomaly density</span>
              <span>Higher</span>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--muted)', paddingTop: 2 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid var(--text)' }} />
                VOC cue
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid #fff', boxShadow: '0 0 0 3px rgba(255,255,255,.15)' }} />
                Scout position
              </span>
              <span>Elevation ×3</span>
            </div>
          </div>
        </div>
      </div>
      {creating && <NewMissionDialog onClose={() => setCreating(false)} />}
    </div>
  )
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
      {w.mission.stats.metal > 0 && (
        <span className="mono" style={{ fontSize: 13, color: 'var(--signal)' }}>
          {w.mission.stats.metal}
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
