import type { GroundHop } from './api'
import { groundName, LOW_CONFIDENCE } from './labels'

/** The last hops, newest first: crop, label, confidence and stale mark. */
export function HopStrip({ hops, onSelect }: { hops: GroundHop[]; onSelect: (hop: GroundHop) => void }) {
  if (!hops.length) return <span className="muted">No hops yet</span>
  return (
    <ol style={{ display: 'flex', gap: 10, margin: 0, padding: 0, listStyle: 'none', overflowX: 'auto' }}>
      {hops.map((h) => {
        const ok = h.status === 'succeeded'
        return (
          <li key={h.hop_id}>
            <button
              onClick={() => onSelect(h)}
              aria-label={`Hop ${h.hop_id}: ${ok ? groundName(h.label) : 'no reading'}`}
              style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 104, padding: 0, border: 'none', background: 'transparent', textAlign: 'left' }}
            >
              {h.image_url ? (
                <img src={h.image_url} alt="" loading="lazy" style={{ width: 104, height: 104, objectFit: 'cover', display: 'block', border: '1px solid var(--line)' }} />
              ) : (
                <span className="mono faint" style={{ width: 104, height: 104, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, border: '1px dashed var(--line-strong)' }}>
                  {h.status === 'none' ? 'Fetching' : 'No reading'}
                </span>
              )}
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ok ? groundName(h.label) : h.status === 'none' ? 'Reading' : 'Unavailable'}
              </span>
              <span className="mono muted" style={{ fontSize: 11, display: 'flex', gap: 8 }}>
                <span>#{h.hop_id}</span>
                {ok && h.confidence !== null && (
                  <span style={{ color: h.confidence < LOW_CONFIDENCE ? 'var(--signal)' : undefined }}>{h.confidence.toFixed(2)}</span>
                )}
                {h.stale && <span className="signal">stale</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}
