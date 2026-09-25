import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, exportUrls, keys } from '../../api/client'
import type { MissionSummary } from '../../api/types'
import { shortDate } from '../../lib/format'
import { isMaterial, MATERIAL_COLORS, MATERIAL_NAMES } from '../../lib/materials'
import { missionDuration, statusView } from '../../lib/status'
import { MiniMap, type MiniMapData } from './MiniMap'

export function MissionPreview({ mission: m, style, onClose, map }: { mission: MissionSummary; style?: React.CSSProperties; onClose?: () => void; map?: MiniMapData }) {
  // Callers that already hold the cells (the theatre) pass them in and skip the full download.
  const cells = useQuery({ queryKey: keys.cells(m.id), queryFn: () => api.cells(m.id), enabled: !map })
  const mapData = map ?? cells.data
  const st = statusView(m)
  const total = Object.values(m.stats.materials).reduce((a, b) => a + b, 0)
  const mix = Object.entries(m.stats.materials)
    .filter(([label]) => isMaterial(label))
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => ({ label, pct: Math.round((n / total) * 100) }))
  const stats: [string, string | number, boolean?][] = [
    ['Hops', m.stats.hops],
    ['Metal', m.stats.metal, m.stats.metal > 0],
    ['VOC', m.stats.voc],
    ['Flags', m.stats.flags],
    ['Duration', missionDuration(m)],
    ['Started', m.started_at ? shortDate(m.started_at).split(' ').pop()! : 'Not started'],
  ]

  return (
    <aside style={{ width: 420, flexShrink: 0, borderLeft: '1px solid var(--line)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20, background: 'var(--bg)', ...style }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="brand" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
            {m.name}
          </span>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {m.id}
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: st.color, whiteSpace: 'nowrap' }}>
          <span className={st.pulse ? 'dot pulse' : 'dot'} style={{ width: 7, height: 7 }} />
          {st.text}
          {onClose && (
            <button aria-label="Close" onClick={onClose} style={{ marginLeft: 8, width: 28, height: 28, border: '1px solid var(--line-strong)', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          )}
        </span>
      </div>

      <div
        style={{
          position: 'relative', height: 300, border: '1px solid var(--line)', backgroundColor: '#0d0d0c',
          backgroundImage: 'linear-gradient(#171716 1px, transparent 1px), linear-gradient(90deg, #171716 1px, transparent 1px)', backgroundSize: '20px 20px',
        }}
      >
        {mapData && <MiniMap data={mapData} width={370} height={298} />}
        {m.status_note && (
          <span style={{ position: 'absolute', left: 10, bottom: 10, fontSize: 12, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--line-strong)' }}>
            {m.status_note}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderTop: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>
        {stats.map(([label, value, signal]) => (
          <div key={label} style={{ padding: 12, borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="key">{label}</span>
            <span className="mono" style={{ fontSize: 16, color: signal ? 'var(--signal)' : undefined }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {mix.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="section-title">Ground cover</span>
          <div style={{ display: 'flex', height: 8 }}>
            {mix.map((k) => (
              <span key={k.label} style={{ width: `${k.pct}%`, background: isMaterial(k.label) ? MATERIAL_COLORS[k.label] : undefined }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {mix.map((k) => (
              <span key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ width: 8, height: 8, background: isMaterial(k.label) ? MATERIAL_COLORS[k.label] : undefined }} />
                {isMaterial(k.label) ? MATERIAL_NAMES[k.label] : k.label}
                <span className="mono faint">{k.pct}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
        <Link className="btn btn-primary" style={{ flexGrow: 1, height: 44 }} to={`/missions/${m.id}`}>
          {m.status === 'live' ? 'Open live mission' : 'Open mission'}
        </Link>
        <a className="btn" style={{ height: 44 }} href={exportUrls(m.id).report} target="_blank" rel="noreferrer">
          Report
        </a>
      </div>
    </aside>
  )
}
