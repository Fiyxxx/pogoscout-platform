import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, keys } from '../api/client'
import { useMissionLive } from '../api/live'
import type { Cell, CellsResponse, MissionSummary } from '../api/types'
import { Capture, Overlay } from '../components/Capture'
import { MissionBadge } from '../components/MissionBadge'
import { HealthLights, TopBar } from '../components/TopBar'
import { CopyIcon, Row } from '../features/dashboard/Inspector'
import { recordFor, SOURCE_NAMES } from '../lib/records'
import { MiniMap } from '../features/missions/MiniMap'
import { cellKey, classificationText, flaggedCells, isLowConfidence, latestObservation, primaryFlag, sensorText } from '../lib/cells'
import { clock, confidence, elapsed, pad3, xy } from '../lib/format'
import { materialName } from '../lib/materials'

export function CellPage() {
  const { missionId = '', x = '0', y = '0' } = useParams()
  const link = useMissionLive(missionId)
  const mission = useQuery({ queryKey: keys.mission(missionId), queryFn: () => api.mission(missionId) })
  const cells = useQuery({ queryKey: keys.cells(missionId), queryFn: () => api.cells(missionId) })
  const key = `${x},${y}`
  const cell = cells.data?.cells.find((c) => cellKey(c) === key)

  useEffect(() => {
    document.title = `Cell (${x}, ${y}) - PogoScout`
  }, [x, y])

  if (mission.isError) return <div className="empty">Mission {missionId} was not found.</div>
  if (!mission.data || !cells.data) return <div className="empty">Loading evidence</div>

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar right={<HealthLights link={link} />}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{mission.data.name}</span>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {mission.data.id}
          </span>
        </div>
        <MissionBadge mission={mission.data} />
        <span className="mono" style={{ fontSize: 13 }}>
          T+{elapsed(mission.data.started_at, mission.data.last_hop_at)}
        </span>
      </TopBar>
      {cell ? (
        <Evidence mission={mission.data} data={cells.data} cell={cell} />
      ) : (
        <div className="empty">Cell ({x}, {y}) has not been visited.</div>
      )}
    </div>
  )
}

function Evidence({ mission, data, cell }: { mission: MissionSummary; data: CellsResponse; cell: Cell }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)
  const go = (c: { x: number; y: number }) => navigate(`/missions/${mission.id}/cells/${c.x}/${c.y}`, { replace: true })
  const obs = latestObservation(cell)
  const flag = primaryFlag(cell)
  const flagged = flaggedCells(data.cells, data.path)
  const fi = flagged.findIndex((c) => cellKey(c) === cellKey(cell))
  const byKey = new Map(data.cells.map((c) => [cellKey(c), c]))
  const stepIndex = data.path.findIndex((p) => p.hop_id === obs.hop_id)
  const prev = stepIndex > 0 ? data.path[stepIndex - 1] : null
  const next = stepIndex >= 0 && stepIndex < data.path.length - 1 ? data.path[stepIndex + 1] : null
  const hopTime = (hopId: number) => {
    for (const c of data.cells) for (const o of c.observations) if (o.hop_id === hopId) return o.observed_at
    return null
  }
  const c = cell.material
  const low = isLowConfidence(c)
  const confColor = low ? 'var(--signal)' : 'var(--text)'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || flagged.length === 0) return
      if (e.key === 'j' || e.key === 'ArrowRight') go(flagged[(fi + 1 + flagged.length) % flagged.length])
      if (e.key === 'k' || e.key === 'ArrowLeft') go(flagged[(fi - 1 + flagged.length) % flagged.length])
      if (e.key === 'Escape') navigate(`/missions/${mission.id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(recordFor(mission, cell), null, 2))
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <div style={{ height: 72, flexShrink: 0, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 20, borderBottom: '1px solid var(--line)' }}>
        <Link className="btn btn-sm" to={`/missions/${mission.id}`}>
          <Chevron dir="left" />
          Map
        </Link>
        <h1 className="brand" style={{ margin: 0, fontWeight: 700, fontSize: 26 }}>
          Cell {xy(cell)}
        </h1>
        {flag && (
          <span className="flag-badge" style={{ color: flag.signal ? 'var(--signal)' : 'var(--text)' }}>
            {flag.text}
          </span>
        )}
        {flagged.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Flag <span className="mono" style={{ color: 'var(--text)' }}>{fi >= 0 ? fi + 1 : '-'}</span> of {flagged.length}
            </span>
            <button className="btn btn-sm" style={{ width: 36, padding: 0 }} aria-label="Previous flag (K)" onClick={() => go(flagged[(fi - 1 + flagged.length) % flagged.length])}>
              <Chevron dir="left" />
            </button>
            <button className="btn btn-sm" style={{ width: 36, padding: 0 }} aria-label="Next flag (J)" onClick={() => go(flagged[(fi + 1) % flagged.length])}>
              <Chevron dir="right" />
            </button>
          </div>
        )}
      </div>

      <div style={{ flexGrow: 1, minHeight: 0, padding: 24, display: 'flex', gap: 24 }}>
        <div className="scroll" style={{ flex: '0 0 58%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <Capture image={obs.image} alt={`Ground capture for hop ${obs.hop_id}`} style={{ flexGrow: 1, minHeight: 240, maxHeight: 460 }} emptyText="No capture received for this hop">
            {obs.image && <Overlay corner="bl">{clock(obs.observed_at)}Z</Overlay>}
            <Overlay corner="br">Hop {pad3(obs.hop_id)}</Overlay>
          </Capture>

          <div style={{ display: 'flex', gap: 16, height: 230, flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 className="section-title">Neighbourhood</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 74px)', gap: 3 }}>
                {[1, 0, -1].flatMap((dy) =>
                  [-1, 0, 1].map((dx) => {
                    const n = byKey.get(`${cell.x + dx},${cell.y + dy}`)
                    const center = dx === 0 && dy === 0
                    if (!n) {
                      return (
                        <span key={`${dx},${dy}`} style={{ width: 74, height: 74, border: '1px dashed #2a2a28', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#5f5f5b' }}>
                          Unexplored
                        </span>
                      )
                    }
                    const nObs = latestObservation(n)
                    return (
                      <button
                        key={`${dx},${dy}`}
                        aria-label={`Cell ${xy(n)}`}
                        onClick={() => go(n)}
                        style={{ position: 'relative', width: 74, height: 74, padding: 0, border: 'none', background: 'var(--surface)', outline: center ? '2px solid var(--text)' : undefined, outlineOffset: -2 }}
                      >
                        <Capture image={nObs.image} alt="" emptyText="" style={{ position: 'absolute', inset: 0, border: 'none' }} />
                        {n.metal === 'detected' && <span style={{ position: 'absolute', left: 5, top: 5, width: 8, height: 8, borderRadius: '50%', background: 'var(--signal)' }} />}
                      </button>
                    )
                  }),
                )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 className="section-title">Position in mission</h2>
              <div style={{ width: 228, height: 228, border: '1px solid var(--line)', background: '#0d0d0c' }}>
                <MiniMap data={data} width={226} height={226} highlight={cellKey(cell)} maxCell={30} />
              </div>
            </div>
            <div style={{ flexGrow: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 className="section-title">Movement</h2>
              <div style={{ flexGrow: 1, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                <Move label="Arrived from" at={prev ? xy(prev) : '(0, 0)'} detail={prev ? `Hop ${prev.hop_id}, moved ${obs.movement.command}` : `Start, moved ${obs.movement.command}`} />
                <Move label="Next hop" at={next ? xy(next) : 'Awaiting'} detail={next ? `Hop ${next.hop_id} at ${clock(hopTime(next.hop_id))}Z` : 'Scout is on this cell'} last />
              </div>
            </div>
          </div>
        </div>

        <div className="scroll" style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)' }}>
            <Reading label="Metal" text={sensorText(cell.metal)} status={obs.metal.status} signal={cell.metal === 'detected'} />
            <Reading label="VOC" text={sensorText(cell.voc)} status={obs.voc.status} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, border: '1px solid var(--line)' }}>
            <span className="key">Material</span>
            {c.status === 'succeeded' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 24, fontWeight: 600 }}>{materialName(c.label)}</span>
                  <span className="mono" style={{ fontSize: 24, color: confColor }}>
                    {confidence(c.confidence)}
                  </span>
                </div>
                <div style={{ height: 3, background: 'var(--line)' }}>
                  <div style={{ height: 3, width: `${Math.round((c.confidence ?? 0) * 100)}%`, background: confColor }} />
                </div>
              </>
            ) : (
              <span style={{ fontSize: 24, fontWeight: 600, color: 'var(--muted)' }}>{classificationText(c)}</span>
            )}
            <History cell={cell} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)' }}>
            <Row k="Source" v={SOURCE_NAMES[mission.source]} />
            <Row k="Received" v={obs.image ? `${clock(obs.image.received_at)}Z` : `${clock(obs.observed_at)}Z`} />
            <Row k="Capture SHA-256" v={obs.image ? obs.image.sha256.slice(0, 12) : 'None'} />
            <Row k="Classifier" v={c.model_version ?? 'Not yet run'} />
            <Row k="Classified" v={c.completed_at ? `${clock(c.completed_at)}Z` : 'Pending'} last />
          </div>

          <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn" style={{ flexGrow: 1, height: 44 }} onClick={copy}>
              <CopyIcon />
              {copied ? 'Copied' : 'Copy record'}
            </button>
            {obs.image && (
              <a className="btn" style={{ flexGrow: 1, height: 44 }} href={obs.image.url} download={`${mission.id}-hop-${obs.hop_id}`}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                </svg>
                Download capture
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function History({ cell }: { cell: Cell }) {
  // History records every state; show outcomes, plus the attempt in flight if there is one.
  const rows = cell.observations.flatMap((o) =>
    o.classification_history
      .filter((c, i, all) => c.status === 'succeeded' || c.status === 'failed' || c.status === 'unavailable' || i === all.length - 1)
      .map((c) => ({ hop: o.hop_id, c })),
  )
  if (rows.length === 0) return null
  const latest = rows[rows.length - 1].c
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 4 }}>
      <thead>
        <tr style={{ textAlign: 'left', fontSize: 12, color: 'var(--muted)' }}>
          <th style={{ padding: '6px 0', fontWeight: 500 }}>Time</th>
          <th style={{ padding: '6px 0', fontWeight: 500 }}>Model</th>
          <th style={{ padding: '6px 0', fontWeight: 500 }}>Result</th>
          <th style={{ padding: '6px 0', fontWeight: 500, textAlign: 'right' }}>Conf.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ hop, c }, i) => (
          <tr key={`${hop}-${i}`} style={{ borderTop: '1px solid var(--line-soft)', color: c === latest ? 'var(--text)' : 'var(--faint)' }}>
            <td className="mono" style={{ padding: '8px 0' }}>{clock(c.completed_at ?? c.requested_at)}</td>
            <td className="mono" style={{ padding: '8px 0' }}>{c.model_version ?? ''}</td>
            <td style={{ padding: '8px 0' }}>{c.status === 'succeeded' ? materialName(c.label) : classificationText(c)}</td>
            <td className="mono" style={{ padding: '8px 0', textAlign: 'right' }}>{confidence(c.confidence)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Reading({ label, text, status, signal }: { label: string; text: string; status: string; signal?: boolean }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 13, color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, color: signal ? 'var(--signal)' : 'var(--text)' }}>{text}</span>
      <span style={{ fontSize: 12, color: status === 'ok' ? 'var(--faint)' : 'var(--signal)' }}>{status === 'ok' ? 'Sensor ok' : status === 'error' ? 'Sensor fault' : 'Reading not received'}</span>
    </div>
  )
}

function Move({ label, at, detail, last }: { label: string; at: string; detail: string; last?: boolean }) {
  return (
    <div style={{ flexGrow: 1, padding: 14, borderBottom: last ? undefined : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="key">{label}</span>
      <span className="mono" style={{ fontSize: 15 }}>{at}</span>
      <span className="mono faint" style={{ fontSize: 12 }}>{detail}</span>
    </div>
  )
}

function Chevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
    </svg>
  )
}
