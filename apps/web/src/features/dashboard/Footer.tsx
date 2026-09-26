import { useMemo, useRef } from 'react'
import type { CellsResponse, MissionEvent } from '../../api/types'
import { cellKey } from '../../lib/cells'
import { clock } from '../../lib/format'
import { DETECTED } from '../../lib/history'
import type { Playback } from './usePlayback'

const MAX_BINS = 240

type Props = {
  full: CellsResponse
  times: Map<number, string>
  events: MissionEvent[]
  playback: Playback
  onSelect: (key: string) => void
}

export function Footer({ full, times, events, playback, onSelect }: Props) {
  const n = full.path.length
  const shownHop = playback.index === null ? full.path[n - 1]?.hop_id : full.path[playback.index]?.hop_id
  return (
    <footer style={{ height: 150, flexShrink: 0, borderTop: '1px solid var(--line)', padding: '18px 20px', display: 'flex', gap: 28, alignItems: 'stretch' }}>
      <Controls playback={playback} length={n} shownHop={shownHop} time={shownHop ? times.get(shownHop) : undefined} />
      <Timeline full={full} times={times} playback={playback} onSelect={onSelect} />
      <Events events={events} limitHop={playback.index === null ? null : (shownHop ?? 0)} />
    </footer>
  )
}

function Controls({ playback: p, length, shownHop, time }: { playback: Playback; length: number; shownHop?: number; time?: string }) {
  const live = p.index === null
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-icon" aria-label="Previous hop" disabled={length === 0} onClick={() => p.step(-1)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 5v14M18 5 9 12l9 7z" /></svg>
        </button>
        <button
          className="btn btn-icon"
          aria-label={p.playing ? 'Pause history' : 'Play history'}
          disabled={length < 2}
          onClick={() => (p.playing ? p.pause() : p.play())}
          style={{ background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' }}
        >
          {p.playing ? (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 4 20 12 7 20z" /></svg>
          )}
        </button>
        <button className="btn btn-icon" aria-label="Next hop" disabled={live} onClick={() => p.step(1)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 5v14M6 5l9 7-9 7z" /></svg>
        </button>
        <button className="btn" aria-label="Playback speed" style={{ width: 60, height: 44, padding: 0, fontFamily: 'var(--font-mono)', fontSize: 12 }} onClick={p.cycleSpeed}>
          {p.speed}×
        </button>
        <button
          className="btn"
          aria-label="Return to live"
          disabled={live}
          onClick={p.goLive}
          style={{ height: 44, fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.08em', color: live ? 'var(--faint)' : 'var(--signal)', borderColor: live ? 'var(--line-strong)' : 'var(--signal)', opacity: 1 }}
        >
          LIVE
        </button>
      </div>
      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
        {live ? `Latest hop ${shownHop ?? 0}` : `Hop ${shownHop} of ${length}, ${clock(time)}Z`}
      </span>
    </div>
  )
}

type Bin = { from: number; to: number; level: 0 | 1 | 2 | 3 }

function Timeline({ full, times, playback, onSelect }: { full: CellsResponse; times: Map<number, string>; playback: Playback; onSelect: (key: string) => void }) {
  const track = useRef<HTMLDivElement>(null)
  const n = full.path.length

  // Each bin shows the most severe thing that happened in its hops: metal, VOC, other flags, plain hop.
  const bins = useMemo<Bin[]>(() => {
    const byKey = new Map(full.cells.map((c) => [cellKey(c), c]))
    const hopLevel = full.path.map((p) => {
      const c = byKey.get(cellKey(p))
      const obs = c?.observations.find((o) => o.hop_id === p.hop_id)
      if ((obs?.metal.value ?? 0) >= DETECTED) return 3
      if ((obs?.voc.value ?? 0) >= DETECTED) return 2
      return c && c.flags.some((f) => f !== 'metal' && f !== 'voc') ? 1 : 0
    })
    const count = Math.min(MAX_BINS, n)
    return Array.from({ length: count }, (_, i) => {
      const from = Math.floor((i * n) / count)
      const to = Math.max(from, Math.floor(((i + 1) * n) / count) - 1)
      let level = 0
      for (let k = from; k <= to; k++) level = Math.max(level, hopLevel[k])
      return { from, to, level: level as Bin['level'] }
    })
  }, [full, n])

  const indexAt = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * (n - 1)
  }
  const scrub = (clientX: number, select: boolean) => {
    const i = Math.max(0, Math.min(n - 1, Math.round(indexAt(clientX))))
    playback.seek(i)
    if (select) onSelect(cellKey(full.path[i]))
  }

  const head = playback.index === null ? n - 1 : playback.index
  const at = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 0)
  const first = n ? times.get(full.path[0].hop_id) : undefined
  const mid = n > 2 ? times.get(full.path[Math.floor((n - 1) / 2)].hop_id) : undefined
  const last = n ? times.get(full.path[n - 1].hop_id) : undefined

  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, color: 'var(--muted)' }}>
        <h2 className="section-title">Timeline</h2>
        <span style={{ display: 'flex', gap: 16 }}>
          <Key color="var(--signal)">Metal</Key>
          <Key color="var(--text)">VOC</Key>
          <Key color="#6e6e6a">Flag</Key>
          <Key color="var(--line-strong)">Hop</Key>
        </span>
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Mission timeline"
        aria-valuemin={1}
        aria-valuemax={n}
        aria-valuenow={head + 1}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          scrub(e.clientX, false)
        }}
        onPointerMove={(e) => e.buttons === 1 && scrub(e.clientX, false)}
        onPointerUp={(e) => scrub(e.clientX, true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') playback.step(e.shiftKey ? -10 : -1)
          if (e.key === 'ArrowRight') playback.step(e.shiftKey ? 10 : 1)
        }}
        style={{ position: 'relative', flexGrow: 1, borderBottom: '1px solid var(--line-strong)', cursor: 'ew-resize', touchAction: 'none' }}
      >
        {bins.map((b) => {
          const future = b.from > head
          return (
            <span
              key={b.from}
              style={{
                position: 'absolute', bottom: 0, left: `${at(b.from)}%`, width: `max(2px, calc(${at(b.to + 1) - at(b.from)}% - 1px))`,
                height: [16, 24, 34, 44][b.level],
                background: ['var(--line-strong)', '#6e6e6a', 'var(--text)', 'var(--signal)'][b.level],
                opacity: future ? 0.25 : 1,
                transition: 'opacity .15s ease',
                pointerEvents: 'none',
              }}
            />
          )
        })}
        {n > 0 && (
          <div
            style={{
              position: 'absolute', left: `${at(head)}%`, top: -4, bottom: -6, width: 1, marginLeft: 0,
              background: playback.index === null ? 'var(--signal)' : 'var(--text)', pointerEvents: 'none',
            }}
          />
        )}
      </div>
      <div className="mono" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--faint)' }}>
        <span>{first ? clock(first) : ''}</span>
        <span>{mid ? clock(mid) : ''}</span>
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

function Events({ events, limitHop }: { events: MissionEvent[]; limitHop: number | null }) {
  // Routine classifications live in the cell's history; the log is for things an operator acts on.
  const shown = events
    .filter((e) => e.level !== 'debug' && e.kind !== 'classification_succeeded')
    .filter((e) => limitHop === null || (e.hop_id !== null && e.hop_id <= limitHop))
    .slice(0, 4)
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
              color: e.kind === 'metal_detected' ? 'var(--signal)' : e.level === 'info' ? 'var(--text)' : 'var(--text-2)',
            }}
          >
            {e.message}
          </span>
        </div>
      ))}
    </div>
  )
}
