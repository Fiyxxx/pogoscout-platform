import { xy } from '../../lib/format'
import { groundColor, groundName, LOW_CONFIDENCE } from './labels'
import { ageText } from './status'

/** What the reading panel shows: the newest hop, or a cell picked on the map. */
export type ShownReading = {
  hop_id: number
  x: number | null
  y: number | null
  status: string
  label: string | null
  confidence: number | null
  model_version: string | null
  age_s: number | null
  stale: boolean | null
  error: string | null
  image_url: string | null
}

export function Reading({ reading, size = 432 }: { reading: ShownReading | undefined; size?: number }) {
  const box = { width: size, maxWidth: '100%', aspectRatio: '1 / 1', background: 'var(--surface)', border: '1px solid var(--line)' }
  if (!reading)
    return (
      <div style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="muted">
        No hops yet
      </div>
    )
  const ok = reading.status === 'succeeded'
  const where = reading.x !== null && reading.y !== null ? xy({ x: reading.x, y: reading.y }) : 'placing'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: size, maxWidth: '100%' }}>
      {reading.image_url ? (
        <img src={reading.image_url} alt={`Ground crop for hop ${reading.hop_id}`} style={{ ...box, display: 'block', objectFit: 'cover' }} />
      ) : (
        <div style={{ ...box, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center' }}>
          <span style={{ fontWeight: 600 }}>{reading.status === 'none' ? 'Fetching reading' : 'No reading for this hop'}</span>
          {reading.error && <span className="mono muted" style={{ fontSize: 12 }}>{reading.error}</span>}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        {ok && <span style={{ width: 12, height: 12, background: groundColor(reading.label), alignSelf: 'center' }} />}
        <span className="brand" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1 }}>
          {ok ? groundName(reading.label) : reading.status === 'none' ? 'Reading' : 'Unavailable'}
        </span>
        {ok && reading.confidence !== null && (
          <span className="mono" style={{ fontSize: 18, color: reading.confidence < LOW_CONFIDENCE ? 'var(--signal)' : 'var(--text-2)' }}>
            {reading.confidence.toFixed(2)}
          </span>
        )}
      </div>
      <div className="mono muted" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: 12 }}>
        <span>Hop {reading.hop_id}</span>
        <span>{where}</span>
        {ok && reading.age_s !== null && <span>{ageText(reading.age_s)}</span>}
        {reading.stale && <span className="signal">Stale: no new reading since the last hop</span>}
        {ok && reading.confidence !== null && reading.confidence < LOW_CONFIDENCE && <span className="signal">Low confidence</span>}
      </div>
      {reading.model_version && (
        <span className="mono faint" style={{ fontSize: 11 }}>
          {reading.model_version}
        </span>
      )}
    </div>
  )
}
