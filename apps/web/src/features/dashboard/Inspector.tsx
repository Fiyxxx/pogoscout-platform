import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Cell, MissionSummary } from '../../api/types'
import { recordFor, SOURCE_NAMES } from '../../lib/records'
import { Capture, Overlay } from '../../components/Capture'
import { classificationText, isLowConfidence, latestObservation, primaryFlag, sensorText } from '../../lib/cells'
import { clock, confidence, pad3, xy } from '../../lib/format'
import { materialName } from '../../lib/materials'

export function Inspector({ mission, cell }: { mission: MissionSummary; cell: Cell | null }) {
  const [copied, setCopied] = useState(false)
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

      <Capture image={obs.image} alt={`Ground capture for hop ${obs.hop_id}`} style={{ width: '100%', aspectRatio: '340 / 190' }}>
        {obs.image && <Overlay corner="bl">{clock(obs.observed_at)}Z</Overlay>}
      </Capture>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1, background: 'var(--line)', border: '1px solid var(--line)' }}>
        <Reading label="Metal" text={sensorText(cell.metal)} signal={cell.metal === 'detected'} />
        <Reading label="VOC" text={sensorText(cell.voc)} />
      </div>

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

      <div style={{ display: 'flex', gap: 8 }}>
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
  display: 'flex', flexDirection: 'column' as const, gap: 18,
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

function Reading({ label, text, signal }: { label: string; text: string; signal?: boolean }) {
  return (
    <div style={{ background: 'var(--bg)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="key">{label}</span>
      <span style={{ fontSize: 16, fontWeight: 600, color: signal ? 'var(--signal)' : 'var(--text)' }}>{text}</span>
    </div>
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

