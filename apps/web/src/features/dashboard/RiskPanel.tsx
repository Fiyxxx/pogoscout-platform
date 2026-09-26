import {
  LEVEL_NAMES,
  MATRIX,
  PROBABILITY,
  PROBABILITY_NAMES,
  SEVERITY,
  SEVERITY_NAMES,
  type RiskAssessment,
  LEVEL_COLORS,
} from '../../lib/risk'

/** Summary, the risk matrix (likelihood against severity) and the hazard areas, in the layer rail. */
export function RiskPanel({ risk, area, onArea }: { risk: RiskAssessment; area: string | null; onArea: (id: string | null) => void }) {
  const { surveyed, assessed } = risk.coverage
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 10px' }}>
        <h2 className="section-title" style={{ paddingBottom: 2 }}>
          Assessment
        </h2>
        <ul className="risk-reasons">
          {risk.summary.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
          {assessed.toLocaleString('en-US')} of {surveyed.toLocaleString('en-US')} cells assessed
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px' }}>
        <h2 className="section-title" style={{ paddingBottom: 2 }}>
          Risk matrix
        </h2>
        <div className="risk-matrix" role="table" aria-label="Cells by likelihood and severity">
          <span />
          {PROBABILITY.map((p, i) => (
            <span key={p} className="risk-matrix-head" title={PROBABILITY_NAMES[i]}>
              {p}
            </span>
          ))}
          {SEVERITY.map((s, row) => (
            <Row key={s} severity={s} name={SEVERITY_NAMES[row]} counts={risk.matrix[s]} />
          ))}
        </div>
        <span style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.5 }}>Likelihood A to E, severity I to IV. Cells with an indication.</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 className="section-title" style={{ padding: '0 10px 6px' }}>
          Hazard areas
        </h2>
        {risk.areas.length === 0 && <span style={{ padding: '0 10px', fontSize: 13, color: 'var(--muted)' }}>None</span>}
        {risk.areas.map((a) => (
          <button key={a.id} className="risk-area-row" aria-pressed={a.id === area} onClick={() => onArea(a.id === area ? null : a.id)}>
            <span className="risk-dot" style={{ background: a.kind === 'explosive' ? LEVEL_COLORS[a.level] : 'transparent', borderColor: LEVEL_COLORS[a.level] }} />
            <span style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
              <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>
                {a.id} {LEVEL_NAMES[a.level]}
              </span>
            </span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
              {a.cells.length}
            </span>
          </button>
        ))}
      </div>
    </>
  )
}

function Row({ severity, name, counts }: { severity: string; name: string; counts: number[] }) {
  return (
    <>
      <span className="risk-matrix-head" title={name}>
        {severity}
      </span>
      {counts.map((n, i) => {
        const level = MATRIX[severity][i]
        return (
          <span
            key={i}
            className="risk-matrix-cell"
            data-empty={n === 0}
            style={{ '--c': LEVEL_COLORS[level] } as React.CSSProperties}
            title={`${name}, ${PROBABILITY_NAMES[i]}: ${LEVEL_NAMES[level]} risk, ${n} ${n === 1 ? 'cell' : 'cells'}`}
          >
            {n || ''}
          </span>
        )
      })}
    </>
  )
}
