import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, keys } from '../../api/client'
import type { Cell, CellsResponse, MissionEvent, MissionSummary, ReplayState } from '../../api/types'
import { cellKey } from '../../lib/cells'
import { clock } from '../../lib/format'

const SPEEDS = [1, 2, 4, 8]

type Props = {
  mission: MissionSummary
  cells: CellsResponse
  events: MissionEvent[]
  replay: ReplayState | undefined
  selected: string | null
  onSelect: (key: string) => void
}

export function Footer({ mission, cells, events, replay, selected, onSelect }: Props) {
  return (
    <footer style={{ height: 150, flexShrink: 0, borderTop: '1px solid var(--line)', padding: '18px 20px', display: 'flex', gap: 28, alignItems: 'stretch' }}>
      {mission.scenario_id && replay && <Playback missionId={mission.id} replay={replay} />}
      <Timeline cells={cells} selected={selected} onSelect={onSelect} />
      <Events events={events} />
    </footer>
  )
}

function Playback({ missionId, replay }: { missionId: string; replay: ReplayState }) {
  const queryClient = useQueryClient()
  const onSuccess = (state: ReplayState) => queryClient.setQueryData(keys.replay(missionId), state)
  const step = useMutation({ mutationFn: () => api.replayStep(missionId), onSuccess })
  const play = useMutation({ mutationFn: (speed: number) => api.replayPlay(missionId, speed), onSuccess })
  const pause = useMutation({ mutationFn: () => api.replayPause(missionId), onSuccess })
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(replay.speed) + 1) % SPEEDS.length]
  const done = replay.finished

  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className={replay.playing ? 'btn btn-icon' : 'btn btn-icon btn-primary'}
          aria-label={replay.playing ? 'Pause replay' : 'Play replay'}
          disabled={done}
          onClick={() => (replay.playing ? pause.mutate() : play.mutate(replay.speed))}
          style={replay.playing ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}
        >
          {replay.playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 4 20 12 7 20z" /></svg>
          )}
        </button>
        <button className="btn btn-icon" aria-label="Step one event" disabled={done || replay.playing} onClick={() => step.mutate()}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 5v14M6 5l9 7-9 7z" /></svg>
        </button>
        <button
          className="btn"
          aria-label="Replay speed"
          style={{ width: 52, height: 44, padding: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }}
          disabled={done}
          onClick={() => (replay.playing ? play.mutate(nextSpeed) : onSuccess({ ...replay, speed: nextSpeed }))}
        >
          {replay.speed}×
        </button>
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
        {done ? 'Replay complete' : `Event ${replay.cursor} of ${replay.total}`}
      </span>
    </div>
  )
}

function Timeline({ cells, selected, onSelect }: { cells: CellsResponse; selected: string | null; onSelect: (key: string) => void }) {
  const byKey = new Map<string, Cell>(cells.cells.map((c) => [cellKey(c), c]))
  const times = new Map<number, string>()
  for (const c of cells.cells) for (const o of c.observations) times.set(o.hop_id, o.observed_at)
  const path = cells.path
  const n = path.length
  const first = n ? times.get(path[0].hop_id) : null
  const mid = n ? times.get(path[Math.floor((n - 1) / 2)].hop_id) : null
  const last = n ? times.get(path[n - 1].hop_id) : null

  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
        <h2 className="section-title">Timeline</h2>
        <span style={{ display: 'flex', gap: 16 }}>
          <Key color="var(--signal)">Metal</Key>
          <Key color="var(--text)">VOC</Key>
          <Key color="var(--line-strong)">Hop</Key>
        </span>
      </div>
      <div style={{ position: 'relative', flexGrow: 1, borderBottom: '1px solid var(--line-strong)' }}>
        {path.map((p, i) => {
          const key = cellKey(p)
          const cell = byKey.get(key)
          const isSel = key === selected
          const metal = cell?.metal === 'detected'
          const voc = cell?.voc === 'detected'
          const left = n > 1 ? (i / (n - 1)) * 100 : 0
          return (
            <button
              key={p.hop_id}
              aria-label={`Hop ${p.hop_id} at (${p.x}, ${p.y})`}
              onClick={() => onSelect(key)}
              style={{
                position: 'absolute', bottom: 0, left: `${left}%`, width: 8, marginLeft: -4, padding: 0, border: 'none',
                height: metal ? 44 : voc ? 34 : isSel ? 30 : 18,
                background: metal ? 'var(--signal)' : voc ? 'var(--text)' : isSel ? 'var(--muted)' : 'var(--line-strong)',
                transition: 'height .2s ease, background-color .2s ease',
              }}
            />
          )
        })}
        {n > 0 && <div style={{ position: 'absolute', right: 0, top: -4, bottom: -6, width: 1, background: 'var(--signal)' }} />}
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--faint)' }}>
        <span>{first ? clock(first) : ''}</span>
        <span>{mid && n > 2 ? clock(mid) : ''}</span>
        <span>{last ? clock(last) : ''}</span>
      </div>
    </div>
  )
}

function Key({ color, children }: { color: string; children: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, background: color }} />
      {children}
    </span>
  )
}

function Events({ events }: { events: MissionEvent[] }) {
  // Routine classifications live in the cell's history; the log is for things an operator acts on.
  const shown = events.filter((e) => e.level !== 'debug' && e.kind !== 'classification_succeeded').slice(0, 4)
  return (
    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <h2 className="section-title">Events</h2>
      {shown.length === 0 && <span className="faint" style={{ fontSize: 13 }}>No events yet</span>}
      {shown.map((e) => (
        <div key={e.id} style={{ display: 'flex', gap: 12, fontSize: 13, whiteSpace: 'nowrap' }}>
          <span className="mono faint">{clock(e.at)}</span>
          <span
            style={{
              overflow: 'hidden', textOverflow: 'ellipsis',
              color: e.level === 'alert' && e.kind === 'metal_detected' ? 'var(--signal)' : e.level === 'info' ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            {e.message}
          </span>
        </div>
      ))}
    </div>
  )
}
