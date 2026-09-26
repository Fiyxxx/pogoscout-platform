import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, keys } from '../api/client'
import { useMissionLive } from '../api/live'
import type { CellsResponse } from '../api/types'
import { MissionBadge } from '../components/MissionBadge'
import { HealthLights, Stat, TopBar } from '../components/TopBar'
import { ExportMenu } from '../features/dashboard/ExportMenu'
import { Footer } from '../features/dashboard/Footer'
import { Inspector } from '../features/dashboard/Inspector'
import { LayerRail } from '../features/dashboard/LayerRail'
import { usePlayback } from '../features/dashboard/usePlayback'
import { cellKey, type Layer } from '../lib/cells'
import { elapsed } from '../lib/format'
import { snapshotAt } from '../lib/history'
import { assessCells, VERDICT_NAMES } from '../lib/risk'

const MissionMap = lazy(() => import('../features/map/MissionMap'))

function hopTimes(data: CellsResponse | undefined): Map<number, string> {
  const times = new Map<number, string>()
  for (const c of data?.cells ?? []) for (const o of c.observations) times.set(o.hop_id, o.observed_at)
  return times
}

export function MissionPage() {
  const { missionId = '' } = useParams()
  const link = useMissionLive(missionId)
  const mission = useQuery({ queryKey: keys.mission(missionId), queryFn: () => api.mission(missionId) })
  const cells = useQuery({ queryKey: keys.cells(missionId), queryFn: () => api.cells(missionId) })
  const events = useQuery({ queryKey: keys.events(missionId), queryFn: () => api.events(missionId, 100) })
  const health = useQuery({ queryKey: keys.health, queryFn: api.health })
  const [layer, setLayer] = useState<Layer>('combined')

  const full = cells.data
  const times = useMemo(() => hopTimes(full), [full])
  const hopSeconds = useMemo(() => {
    const path = full?.path ?? []
    if (path.length < 2) return 4
    const a = times.get(path[0].hop_id)
    const b = times.get(path[path.length - 1].hop_id)
    return a && b ? (Date.parse(b) - Date.parse(a)) / 1000 / (path.length - 1) : 4
  }, [full, times])
  const playback = usePlayback(full?.path.length ?? 0, hopSeconds)
  const shownHop = playback.index !== null ? full?.path[playback.index]?.hop_id : undefined
  const replaying = shownHop !== undefined
  const shown = useMemo(() => (full && shownHop !== undefined ? snapshotAt(full, shownHop) : full), [full, shownHop])

  // Follow the scout (null) until the operator picks a cell.
  const [picked, setPicked] = useState<string | null>(null)
  const current = shown && shown.path.length ? cellKey(shown.current) : null
  const selected = picked ?? current
  const [areaId, setAreaId] = useState<string | null>(null)
  // The hazard area the camera is focused on. It outlives the area panel: opening a cell inside
  // the area keeps the focus, a click anywhere else ends it and zooms back out.
  const [focusId, setFocusId] = useState<string | null>(null)
  const select = (key: string) => {
    setAreaId(null)
    setPicked(key === current ? null : key)
  }
  const exitFocus = () => {
    setFocusId(null)
    setAreaId(null)
    setPicked(null)
  }
  const chooseArea = (id: string | null) => {
    if (id === null) return exitFocus()
    setAreaId(id)
    setFocusId(id)
  }
  const selectedCell = useMemo(() => shown?.cells.find((c) => cellKey(c) === selected) ?? null, [shown, selected])
  // Assessed from the cells on screen, so the verdict follows playback as well as the live feed.
  const risk = useMemo(() => assessCells(shown?.cells ?? []), [shown])
  const riskByCell = useMemo(() => new Map(risk.cells.map((c) => [cellKey(c), c])), [risk])
  const area = risk.areas.find((a) => a.id === areaId) ?? null
  const focusArea = risk.areas.find((a) => a.id === focusId) ?? null
  const pickOnMap = (key: string | null) => {
    if (focusArea) {
      if (key && focusArea.cells.some(([x, y]) => `${x},${y}` === key)) select(key)
      else exitFocus()
    } else if (key) select(key)
  }

  // A cell chosen from the timeline: leave the focus first when it lies outside the area.
  const selectFromTimeline = (key: string) => {
    if (focusArea && !focusArea.cells.some(([x, y]) => `${x},${y}` === key)) setFocusId(null)
    select(key)
  }

  useEffect(() => {
    if (!focusId) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exitFocus()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusId])

  useEffect(() => {
    if (mission.data) document.title = `${mission.data.name} - PogoScout`
  }, [mission.data])

  if (mission.isError) return <div className="empty">Mission {missionId} was not found.</div>
  if (!mission.data || !full || !shown) return <div className="empty">Loading mission</div>

  const m = mission.data
  const stats = {
    hops: shown.path.length,
    metal: shown.cells.filter((c) => c.metal === 'detected').length,
    voc: shown.cells.filter((c) => c.voc === 'detected').length,
    flags: shown.cells.filter((c) => c.flags.length > 0).length,
  }
  const lastShown = shown.path.length ? (times.get(shown.path[shown.path.length - 1].hop_id) ?? null) : null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        right={
          <>
            <Stat label="Hops" value={stats.hops.toLocaleString('en-US')} />
            <Stat label="Metal" value={stats.metal} signal={stats.metal > 0} />
            <Stat label="VOC" value={stats.voc} />
            <Stat label="Flags" value={stats.flags} />
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
        <MissionBadge mission={m} replaying={replaying} />
        <button className="verdict verdict-btn" data-verdict={risk.verdict} title={risk.verdict_reasons.join('\n')} onClick={() => setLayer('risk')}>
          {VERDICT_NAMES[risk.verdict]}
        </button>
        <span className="mono" style={{ fontSize: 13 }}>
          T+{elapsed(m.started_at, replaying ? lastShown : m.last_hop_at)}
        </span>
      </TopBar>

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <LayerRail layer={layer} onLayer={setLayer} cells={shown.cells} risk={risk} area={focusId} onArea={chooseArea} />
        <main style={{ flexGrow: 1, minWidth: 0, position: 'relative' }}>
          {full.cells.length === 0 ? (
            <div className="empty">Waiting for the first hop</div>
          ) : (
            <Suspense fallback={<div className="empty">Loading map</div>}>
              <MissionMap data={shown} layer={layer} selected={selected} onPick={pickOnMap} risk={risk} area={focusId} onArea={chooseArea} focus={focusArea?.id ?? null} />
            </Suspense>
          )}
        </main>
        <Inspector
          mission={m}
          cell={selectedCell}
          cellRisk={selectedCell ? riskByCell.get(cellKey(selectedCell)) : undefined}
          area={area}
          onCloseArea={exitFocus}
          onPeak={(key) => {
            setAreaId(null)
            setPicked(key)
          }}
        />
      </div>

      <Footer full={full} times={times} events={events.data ?? []} playback={playback} onSelect={selectFromTimeline} />
    </div>
  )
}
