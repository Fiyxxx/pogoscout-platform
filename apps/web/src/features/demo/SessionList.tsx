import type { GroundSession } from './api'
import { sessionState } from './status'

const TONE_COLOR = { live: 'var(--signal)', warn: 'var(--signal)', idle: 'var(--faint)' } as const

/** Every demo session, newest first. Picking one shows its run below. */
export function SessionList({
  sessions,
  selected,
  onSelect,
}: {
  sessions: GroundSession[]
  selected: string | undefined
  onSelect: (missionId: string) => void
}) {
  if (!sessions.length) return <span className="muted">No sessions yet. Create one to start polling the ground service.</span>
  return (
    <ul style={{ display: 'flex', gap: 10, margin: 0, padding: 0, listStyle: 'none', overflowX: 'auto' }}>
      {sessions.map((s) => {
        const state = sessionState(s)
        const active = s.mission_id === selected
        return (
          <li key={s.mission_id}>
            <button
              onClick={() => onSelect(s.mission_id)}
              aria-pressed={active}
              aria-label={`${s.name}: ${state.text}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                width: 200,
                padding: '10px 12px',
                textAlign: 'left',
                background: active ? 'var(--line)' : 'transparent',
                border: `1px solid ${active ? 'var(--text)' : 'var(--line-strong)'}`,
                color: 'var(--text)',
                font: 'inherit',
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span className="mono faint" style={{ fontSize: 11 }}>
                {s.mission_id}
              </span>
              <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TONE_COLOR[state.tone] }}>
                  <span className={state.tone === 'live' ? 'dot pulse' : 'dot'} />
                  {state.text}
                </span>
                <span className="mono muted">{s.hops} hops</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
