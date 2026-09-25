import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, keys } from '../api/client'
import { useMissionLive } from '../api/live'
import { MissionBadge } from '../components/MissionBadge'
import { HealthLights, Stat, TopBar } from '../components/TopBar'
import { ExportMenu } from '../features/dashboard/ExportMenu'
import { Footer } from '../features/dashboard/Footer'
import { Inspector } from '../features/dashboard/Inspector'
import { LayerRail } from '../features/dashboard/LayerRail'
import { cellKey, type Layer } from '../lib/cells'
import { elapsed } from '../lib/format'

const MissionMap = lazy(() => import('../features/map/MissionMap'))

export function MissionPage() {
  const { missionId = '' } = useParams()
  const link = useMissionLive(missionId)
  const mission = useQuery({ queryKey: keys.mission(missionId), queryFn: () => api.mission(missionId) })
  const cells = useQuery({ queryKey: keys.cells(missionId), queryFn: () => api.cells(missionId) })
  const events = useQuery({ queryKey: keys.events(missionId), queryFn: () => api.events(missionId, 50) })
  const replay = useQuery({
    queryKey: keys.replay(missionId),
    queryFn: () => api.replay(missionId),
    enabled: !!mission.data?.scenario_id,
  })
  const health = useQuery({ queryKey: keys.health, queryFn: api.health })
  const [layer, setLayer] = useState<Layer>('combined')
  // Follow the scout (null) until the operator picks a cell.
  const [picked, setPicked] = useState<string | null>(null)
  const current = cells.data && cells.data.path.length ? cellKey(cells.data.current) : null
  const selected = picked ?? current
  const select = (key: string) => setPicked(key === current ? null : key)

  const selectedCell = useMemo(
    () => cells.data?.cells.find((c) => cellKey(c) === selected) ?? null,
    [cells.data, selected],
  )

  useEffect(() => {
    if (mission.data) document.title = `${mission.data.name} - PogoScout`
  }, [mission.data])

  if (mission.isError) return <div className="empty">Mission {missionId} was not found.</div>
  if (!mission.data || !cells.data) return <div className="empty">Loading mission</div>

  const m = mission.data
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        right={
          <>
            <Stat label="Hops" value={m.stats.hops} />
            <Stat label="Metal" value={m.stats.metal} signal={m.stats.metal > 0} />
            <Stat label="VOC" value={m.stats.voc} />
            <Stat label="Flags" value={m.stats.flags} />
            <HealthLights link={link} />
            <ExportMenu mission={m} modelVersion={health.data?.model_version ?? null} />
          </>
        }
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{m.name}</span>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {m.id}
          </span>
        </div>
        <MissionBadge mission={m} />
        <span className="mono" style={{ fontSize: 13 }}>
          T+{elapsed(m.started_at, m.last_hop_at)}
        </span>
      </TopBar>

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <LayerRail layer={layer} onLayer={setLayer} cells={cells.data.cells} />
        <main style={{ flexGrow: 1, minWidth: 0, position: 'relative' }}>
          {cells.data.cells.length === 0 ? (
            <div className="empty">Waiting for the first hop</div>
          ) : (
            <Suspense fallback={<div className="empty">Loading map</div>}>
              <MissionMap data={cells.data} layer={layer} selected={selected} onSelect={select} />
            </Suspense>
          )}
        </main>
        <Inspector mission={m} cell={selectedCell} />
      </div>

      <Footer mission={m} cells={cells.data} events={events.data ?? []} replay={replay.data} selected={selected} onSelect={select} />
    </div>
  )
}
