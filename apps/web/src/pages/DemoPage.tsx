import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, keys } from '../api/client'
import { useMissionLive } from '../api/live'
import type { CellsResponse, Point } from '../api/types'
import { NavTabs } from '../components/NavTabs'
import { HealthLights, Stat, TopBar } from '../components/TopBar'
import { demoApi, demoKeys, type GroundHop } from '../features/demo/api'
import { GridLegend, GroundGrid } from '../features/demo/GroundGrid'
import { HopStrip } from '../features/demo/HopStrip'
import { Reading, type ShownReading } from '../features/demo/Reading'
import { runView } from '../features/demo/status'

const TONE_COLOR = { live: 'var(--signal)', warn: 'var(--signal)', idle: 'var(--muted)' } as const

/** The reading for a cell picked on the map: its latest hop, with age and stale mark when known. */
function cellReading(cells: CellsResponse | undefined, at: Point, hops: GroundHop[]): ShownReading | undefined {
  const cell = cells?.cells.find((c) => c.x === at.x && c.y === at.y)
  const obs = cell?.observations.at(-1)
  if (!obs) return undefined
  const recent = hops.find((h) => h.hop_id === obs.hop_id)
  if (recent) return recent
  const c = obs.classification
  return {
    hop_id: obs.hop_id,
    x: at.x,
    y: at.y,
    status: c.status,
    label: c.label,
    confidence: c.confidence,
    model_version: c.model_version,
    age_s: null,
    stale: null,
    error: c.error,
    image_url: obs.image?.url ?? null,
  }
}

export function DemoPage() {
  const queryClient = useQueryClient()
  const state = useQuery({ queryKey: demoKeys.state, queryFn: demoApi.state, refetchInterval: 2_000 })
  const missionId = state.data?.mission_id ?? undefined
  const link = useMissionLive(missionId)
  const hops = useQuery({
    queryKey: demoKeys.hops(missionId ?? ''),
    queryFn: () => demoApi.hops(missionId!),
    enabled: !!missionId,
  })
  const cells = useQuery({ queryKey: keys.cells(missionId ?? ''), queryFn: () => api.cells(missionId!), enabled: !!missionId })
  // A cell picked on the map, kept with its run so a new run starts back on the latest reading.
  const [picked, setPicked] = useState<{ missionId: string; at: Point } | null>(null)
  const selected = picked && picked.missionId === missionId ? picked.at : null
  const setSelected = (at: Point | null) => setPicked(at && missionId ? { missionId, at } : null)

  useEffect(() => {
    document.title = 'Live demo - PogoScout'
  }, [])

  const control = useMutation({
    mutationFn: (action: 'start' | 'stop') => (action === 'start' ? demoApi.start() : demoApi.stop()),
    onSuccess: (next) => {
      queryClient.setQueryData(demoKeys.state, next)
      queryClient.invalidateQueries({ queryKey: keys.missions })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: demoKeys.state }),
  })

  const recent = hops.data ?? []
  const newest = recent[0]
  const view = runView(state.data, newest)
  const running = state.data?.running ?? false
  const shown = selected ? cellReading(cells.data, selected, recent) : newest

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <Stat label="Hops" value={state.data?.hops ?? 0} />
            <Stat label="Interval" value={state.data ? `${state.data.interval_s} s` : '-'} />
            <HealthLights link={missionId ? link : undefined} />
          </div>
        }
      >
        <NavTabs />
      </TopBar>

      <main className="scroll" style={{ flexGrow: 1, padding: '32px 32px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h1 className="brand" style={{ margin: 0, fontWeight: 700, fontSize: 32, lineHeight: 1 }}>
              Live ground demo
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 14 }}>
              <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: TONE_COLOR[view.tone] }}>
                <span className={view.tone === 'live' ? 'dot pulse' : 'dot'} style={{ width: 7, height: 7 }} />
                {view.text}
              </span>
              {view.hint && <span className="muted">{view.hint}</span>}
              {missionId && (
                <Link to={`/missions/${missionId}`} className="mono faint" style={{ fontSize: 12 }}>
                  {missionId}
                </Link>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={running || control.isPending || state.data?.ground === 'off'}
              onClick={() => control.mutate('start')}
            >
              {missionId ? 'Start new run' : 'Start'}
            </button>
            <button className="btn" disabled={!running || control.isPending} onClick={() => control.mutate('stop')}>
              Stop
            </button>
          </div>
        </div>
        {control.error && <span className="signal">{control.error.message}</span>}

        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Current reading">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
              <h2 className="section-title">{selected ? `Cell (${selected.x}, ${selected.y})` : 'Current reading'}</h2>
              {selected && (
                <button className="btn btn-sm" onClick={() => setSelected(null)}>
                  Follow latest
                </button>
              )}
            </div>
            <Reading reading={shown} />
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0, flex: '1 1 380px' }} aria-label="Map">
            <div style={{ display: 'flex', alignItems: 'center', minHeight: 36 }}>
              <h2 className="section-title">Materials seen so far</h2>
            </div>
            {cells.data && cells.data.cells.length ? (
              <>
                <div className="scroll" style={{ maxHeight: 440, overflowX: 'auto' }}>
                  <GroundGrid cells={cells.data} selected={selected} onSelect={setSelected} />
                </div>
                <GridLegend cells={cells.data} />
                <span className="faint" style={{ fontSize: 12 }}>
                  Positions follow the demo's own path, 8 cells across and back, not where the camera is.
                </span>
              </>
            ) : (
              <span className="muted">The map fills in as hops arrive.</span>
            )}
          </section>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Recent hops">
          <h2 className="section-title">Recent hops</h2>
          <HopStrip hops={recent} onSelect={(h) => h.x !== null && h.y !== null && setSelected({ x: h.x, y: h.y })} />
        </section>

        <p className="muted" style={{ margin: 0, fontSize: 13, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          VOC and metal sensors aren't fitted in this demo, so there is no risk assessment. Only the ground reading is real.
        </p>
      </main>
    </div>
  )
}
