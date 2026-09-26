import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cell, MissionSummary } from '../../api/types'
import { recordFor, SOURCE_NAMES } from '../../lib/records'
import { Capture, Overlay } from '../../components/Capture'
import { classificationText, isLowConfidence, latestObservation, primaryFlag, sensorText } from '../../lib/cells'
import { clock, confidence, pad3, xy } from '../../lib/format'
import { materialName } from '../../lib/materials'
import { LEVEL_COLORS, LEVEL_NAMES, strongest, type CellRisk, type RiskArea } from '../../lib/risk'

type Props = {
  mission: MissionSummary
  cell: Cell | null
  cellRisk: CellRisk | undefined
  area: RiskArea | null
  onCloseArea: () => void
  onPeak: (key: string) => void
}

export function Inspector({ mission, cell, cellRisk, area, onCloseArea, onPeak }: Props) {
  const [copied, setCopied] = useState(false)
  if (area) return <AreaView area={area} onClose={onCloseArea} onPeak={onPeak} />
  if (!cell) {
    return (
      <aside style={asideStyle}>
        <p className="muted" style={{ margin: 0 }}>
          Select a cell on the map.
        </p>
      </aside>
    )
  }
  const obs = latestObservation(cell)
  const flag = primaryFlag(cell)
  const c = cell.material
  const low = isLowConfidence(c)
  const confColor = low ? 'var(--signal)' : 'var(--text)'

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
    <aside className="scroll" style={asideStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Cell</span>
          <span className="brand" style={{ fontWeight: 700, fontSize: 30, lineHeight: 1 }}>
            {xy(cell)}
          </span>
        </div>
        {flag && (
          <span className="flag-badge" style={{ color: flag.signal ? 'var(--signal)' : 'var(--text)' }}>
            {flag.text}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <Fact label="Hop" value={pad3(obs.hop_id)} />
        <Fact label="Time" value={clock(obs.observed_at)} divider />
        <Fact label="Visits" value={cell.visit_count} divider />
      </div>

      <Capture image={obs.image} alt={`Ground capture for hop ${obs.hop_id}`} style={{ width: '100%', aspectRatio: '340 / 190', flexShrink: 0 }}>
        {obs.image && <Overlay corner="bl">{clock(obs.observed_at)}Z</Overlay>}
      </Capture>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)' }}>
        <Reading label="Metal" text={sensorText(cell.metal)} value={strongest(cell, 'metal')} signal={cell.metal === 'detected'} />
        <Reading label="VOC" text={sensorText(cell.voc)} value={strongest(cell, 'voc')} />
      </div>

      <RiskBlock risk={cellRisk} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: '1px solid var(--line)' }}>
        <span className="key">Material</span>
        {c.status === 'succeeded' ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{materialName(c.label)}</span>
              <span className="mono" style={{ fontSize: 18, color: confColor }}>
                {confidence(c.confidence)}
              </span>
            </div>
            <div style={{ height: 3, background: 'var(--line)' }}>
              <div style={{ height: 3, width: `${Math.round((c.confidence ?? 0) * 100)}%`, background: confColor, transition: 'width .4s var(--ease)' }} />
            </div>
          </>
        ) : (
          <span style={{ fontSize: 18, fontWeight: 600, color: c.status === 'failed' || c.status === 'unavailable' ? 'var(--signal)' : 'var(--muted)' }}>
            {classificationText(c)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--line)' }}>
        <Row k="Source" v={SOURCE_NAMES[mission.source]} />
        <Row k="Classifier" v={c.model_version ?? 'Not yet run'} />
        <Row k="Classified" v={c.completed_at ? `${clock(c.completed_at)}Z` : 'Pending'} last />
      </div>

      <div style={{ position: 'sticky', bottom: -20, marginTop: 'auto', margin: '-4px -20px -20px', padding: '12px 20px 20px', background: 'var(--bg)', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
        <button className="btn" style={{ flexGrow: 1 }} onClick={copy}>
          <CopyIcon />
          {copied ? 'Copied' : 'Copy record'}
        </button>
        <Link className="btn" style={{ flexGrow: 1 }} to={`/missions/${mission.id}/cells/${cell.x}/${cell.y}`}>
          Open evidence
        </Link>
      </div>
    </aside>
  )
}

const asideStyle = {
  width: 380, flexShrink: 0, borderLeft: '1px solid var(--line)', padding: 20,
  display: 'flex', flexDirection: 'column' as const, gap: 18, overflowY: 'auto' as const,
}

function Fact({ label, value, divider }: { label: string; value: React.ReactNode; divider?: boolean }) {
  return (
    <div style={{ padding: divider ? '10px 0 10px 14px' : '10px 0', borderLeft: divider ? '1px solid var(--line)' : undefined, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span className="key">{label}</span>
      <span className="mono" style={{ fontSize: 14 }}>
        {value}
      </span>
    </div>
  )
}

function Reading({ label, text, value, signal }: { label: string; text: string; value: number | null; signal?: boolean }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="key">{label}</span>
        {value !== null && (
          <span className="mono" style={{ fontSize: 12, color: signal ? 'var(--signal)' : 'var(--muted)' }} title="Strongest signal, 0 to 1">
            {value.toFixed(2)}
          </span>
        )}
      </span>
      <span style={{ fontSize: 16, fontWeight: 600, color: signal ? 'var(--signal)' : 'var(--text)' }}>{text}</span>
    </div>
  )
}

/** The cell's risk: level and label with the reasons behind them, or why it is not assessed. */
function RiskBlock({ risk }: { risk: CellRisk | undefined }) {
  const assessed = risk?.assessed ?? true
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, border: '1px solid var(--line)', borderLeft: risk?.level ? `3px solid ${LEVEL_COLORS[risk.level]}` : '1px solid var(--line)' }}>
      <span className="key">Risk</span>
      {risk?.level ? (
        <>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 16, fontWeight: 600 }}>{risk.label}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: LEVEL_COLORS[risk.level], whiteSpace: 'nowrap' }}>{LEVEL_NAMES[risk.level]}</span>
          </span>
          <ul className="risk-reasons">
            {risk.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </>
      ) : (
        <span style={{ fontSize: 16, fontWeight: 600, color: assessed ? 'var(--text-2)' : 'var(--muted)' }}>
          {assessed ? 'No indication' : `Not assessed: ${risk?.reasons[0] ?? ''}`}
        </span>
      )}
    </div>
  )
}

/** A hazard area: what it is, why it is rated so, and what to do. */
function AreaView({ area, onClose, onPeak }: { area: RiskArea; onClose: () => void; onPeak: (key: string) => void }) {
  const color = LEVEL_COLORS[area.level]
  return (
    <aside className="scroll" style={asideStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Hazard area</span>
          <span className="brand" style={{ fontWeight: 700, fontSize: 30, lineHeight: 1 }}>
            {area.id}
          </span>
        </div>
        <button className="btn btn-sm" aria-label="Close area" onClick={onClose}>
          Close
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, borderLeft: `3px solid ${color}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color }}>{LEVEL_NAMES[area.level]} risk</span>
        <span style={{ fontSize: 20, fontWeight: 600 }}>{area.label}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        <Fact label="Cells" value={area.cells.length} />
        <Fact label="Evidence" value={(area.score / 100).toFixed(2)} divider />
        <Fact label="Peak cell" value={xy({ x: area.peak[0], y: area.peak[1] })} divider />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span className="key">Why</span>
        <ul className="risk-reasons" style={{ fontSize: 14 }}>
          {area.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, border: '1px solid var(--line)' }}>
        <span className="key">Action</span>
        <span style={{ fontSize: 15, lineHeight: 1.5 }}>{area.action}</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--faint)', lineHeight: 1.5 }}>
        Sensors report signal strength, not what an object is. An area stays suspected until a team confirms or clears it.
      </p>
      <button className="btn" style={{ marginTop: 'auto' }} onClick={() => onPeak(`${area.peak[0]},${area.peak[1]}`)}>
        Go to peak cell
      </button>
    </aside>
  )
}

export function Row({ k, v, last }: { k: string; v: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: last ? undefined : '1px solid var(--line-soft)', fontSize: 13 }}>
      <span className="muted">{k}</span>
      <span className="mono">{v}</span>
    </div>
  )
}

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" />
      <path d="M16 8V4H4v12h4" />
    </svg>
  )
}

