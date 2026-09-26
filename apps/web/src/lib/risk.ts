// Risk assessment, rules `risk-2` (Bayesian evidence fusion). A line-for-line port of
// apps/api/src/pogoscout_api/domain/risk.py, so the mission page can assess any moment of playback.
// Both run contracts/risk.v2.cases.json. Evidence is integer decibans and probabilities integer
// hundredths, so the two implementations agree exactly. See the Python module for the model.

import type { Cell, SensorReading } from '../api/types'

export type RiskKind = 'explosive' | 'activity'
export type RiskLevel = 'EH' | 'H' | 'M' | 'L'

export type CellRisk = {
  x: number
  y: number
  assessed: boolean
  kind: RiskKind | null
  /** Posterior log odds in decibans. */
  db: number
  /** Posterior probability in hundredths. */
  p: number
  /** Likelihood grade A to E on the risk matrix. */
  probability: string | null
  severity: string | null
  level: RiskLevel | null
  label: string | null
  reasons: string[]
}

export type RiskArea = {
  id: string
  kind: RiskKind
  level: RiskLevel
  label: string
  action: string
  cells: [number, number][]
  centroid: [number, number]
  peak: [number, number]
  p: number
  reasons: string[]
}

export type RiskAssessment = {
  rules_version: string
  /** Plain counts for the operator. No go or no-go: they may still need to enter an area. */
  summary: string[]
  coverage: { surveyed: number; assessed: number }
  matrix: Record<string, number[]>
  cells: CellRisk[]
  areas: RiskArea[]
}

type Reading = [number | null, string]
export type CellReadings = { x: number; y: number; metal: Reading[]; voc: Reading[] }

export const RULES_VERSION = 'risk-2'
const SIGNAL = 30
const DETECTED = 50
const SUSPECTED = 15
export const PROBABILITY = ['A', 'B', 'C', 'D', 'E'] as const
export const SEVERITY = ['I', 'II', 'III', 'IV'] as const
export const PROBABILITY_NAMES = ['Frequent', 'Likely', 'Occasional', 'Seldom', 'Unlikely']
export const SEVERITY_NAMES = ['Catastrophic', 'Critical', 'Moderate', 'Negligible']
export const MATRIX: Record<string, RiskLevel[]> = {
  I: ['EH', 'EH', 'H', 'H', 'M'],
  II: ['EH', 'H', 'H', 'M', 'L'],
  III: ['H', 'M', 'M', 'L', 'L'],
  IV: ['M', 'L', 'L', 'L', 'L'],
}
export const RANK: Record<RiskLevel, number> = { EH: 4, H: 3, M: 2, L: 1 }
export const LEVEL_NAMES: Record<RiskLevel, string> = { EH: 'Extremely high', H: 'High', M: 'Medium', L: 'Low' }
export const LEVEL_COLORS: Record<RiskLevel, string> = { EH: 'var(--risk-eh)', H: 'var(--risk-h)', M: 'var(--risk-m)', L: '#4a4a46' }
const AREA_LEVELS: RiskLevel[] = ['EH', 'H', 'M']

// Priors [share of cells, decibans] and sensor models [lowest signal, P | hypothesis, P | not, dB].
export const HAZARD_PRIOR = [0.02, -17] as const
export const ACTIVITY_PRIOR = [0.03, -15] as const
type Model = readonly (readonly [number, number, number, number])[]
export const METAL_MODEL: Model = [
  [85, 0.15, 0.0005, 25],
  [70, 0.25, 0.0015, 22],
  [50, 0.3, 0.008, 16],
  [30, 0.15, 0.04, 6],
  [0, 0.15, 0.95, -8],
]
export const VOC_MODEL: Model = [
  [85, 0.15, 0.001, 22],
  [70, 0.2, 0.002, 20],
  [50, 0.25, 0.007, 16],
  [30, 0.2, 0.035, 8],
  [0, 0.2, 0.955, -7],
]
const VOC_NEARBY_DB = 8
const METAL_PATTERN_DB = 10
const DB_LIMIT = 60

/** 0..1 to 0..100, half away from zero, identical to the Python rules. */
export const hundredths = (value: number) => Math.floor(value * 100 + 0.5)
const floorDiv = (a: number, b: number) => Math.floor(a / b)
const fmt = (h: number) => `${floorDiv(h, 100)}.${String(((h % 100) + 100) % 100).padStart(2, '0')}`
export const signed = (db: number) => (db > 0 ? `+${db} dB` : db < 0 ? `\u2212${-db} dB` : '0 dB')
const ok = (readings: Reading[]) => readings.filter(([v, s]) => s === 'ok' && v !== null).map(([v]) => hundredths(v as number))
const max = (values: number[]) => (values.length ? Math.max(...values) : 0)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const key = (x: number, y: number) => `${x},${y}`

/** Probability in hundredths as text; never shows certainty the evidence cannot give. */
export const probText = (p: number) => (p >= 100 ? '>0.99' : p <= 0 ? '<0.01' : (p / 100).toFixed(2))

/** Log odds in decibans to probability in hundredths. */
export const posterior = (db: number) => hundredths(1 / (1 + 10 ** (-db / 10)))

export function grade(p: number): string {
  for (const [threshold, letter] of [[80, 'A'], [50, 'B'], [25, 'C'], [15, 'D']] as const) if (p >= threshold) return letter
  return 'E'
}

function weight(model: Model, value: number): number {
  for (const [lowest, , , db] of model) if (value >= lowest) return db
  throw new Error(`no bin for ${value}`)
}

/** Evidence from every visit: the strongest reading in full, each further visit half. */
function visits(values: number[], sensor: string, model: Model): [number, string[]] {
  let total = 0
  const lines: string[] = []
  ;[...values]
    .sort((a, b) => b - a)
    .forEach((value, i) => {
      let db = weight(model, value)
      if (i === 0) lines.push(`${sensor} ${fmt(value)}: ${signed(db)}`)
      else {
        db = floorDiv(db, 2)
        lines.push(`${sensor} ${fmt(value)} on revisit: ${signed(db)}`)
      }
      total += db
    })
  return [total, lines]
}

function assessCell(cell: CellReadings, metalMax: Map<string, number>, vocMax: Map<string, number>): CellRisk {
  const metal = ok(cell.metal)
  const voc = ok(cell.voc)
  const { x, y } = cell
  const none = { kind: null, db: 0, p: 0, probability: null, severity: null, level: null, label: null }
  if (!metal.length) {
    const failed = cell.metal.some(([, s]) => s === 'error')
    return { x, y, assessed: false, ...none, reasons: [failed ? 'Metal sensor error' : 'No metal reading'] }
  }
  let kind: RiskKind
  let severity: string
  let db: number
  let reasons: string[]
  if (max(metal) >= SIGNAL) {
    kind = 'explosive'
    severity = 'I'
    db = HAZARD_PRIOR[1]
    reasons = [`Prior ${Math.round(HAZARD_PRIOR[0] * 100)}% of cells: ${signed(db)}`]
    const [evidence, lines] = visits(metal, 'Metal', METAL_MODEL)
    db += evidence
    reasons.push(...lines)
    let near = 0
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) near = Math.max(near, vocMax.get(key(x + dx, y + dy)) ?? 0)
    if (near >= DETECTED) {
      db += VOC_NEARBY_DB
      reasons.push(`VOC ${fmt(near)} at or beside this cell: ${signed(VOC_NEARBY_DB)}`)
    }
    let pattern = 0
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) if ((dx || dy) && (metalMax.get(key(x + dx, y + dy)) ?? 0) >= DETECTED) pattern++
    if (pattern >= 2) {
      db += METAL_PATTERN_DB
      reasons.push(`${pattern} more metal detections within 2 cells: ${signed(METAL_PATTERN_DB)}`)
    }
  } else if (voc.length && max(voc) >= SIGNAL) {
    kind = 'activity'
    severity = 'III'
    db = ACTIVITY_PRIOR[1]
    const [evidence, lines] = visits(voc, 'VOC', VOC_MODEL)
    db += evidence
    reasons = [`Prior ${Math.round(ACTIVITY_PRIOR[0] * 100)}% of cells: ${signed(ACTIVITY_PRIOR[1])}`, ...lines, 'No metal signal']
  } else {
    return { x, y, assessed: true, ...none, reasons: [] }
  }
  db = Math.max(-DB_LIMIT, Math.min(DB_LIMIT, db))
  const p = posterior(db)
  const letter = grade(p)
  const level = MATRIX[severity][PROBABILITY.indexOf(letter as (typeof PROBABILITY)[number])]
  const label = kind === 'explosive' ? (p >= SUSPECTED ? 'Suspected explosive hazard' : 'Metal anomaly') : 'Recent activity cue'
  return { x, y, assessed: true, kind, db, p, probability: letter, severity, level, label, reasons }
}

const ACTIONS = {
  severe: 'Mark the area and bypass where possible. If passage is needed, use a cleared lane or request EOD.',
  anomaly: 'Re-survey with the Route clearance loadout before use.',
  activity: 'Approach with caution and observe. A cue, not a detection.',
}

function areasOf(risks: CellRisk[]): RiskArea[] {
  const members = new Map<string, CellRisk>()
  for (const r of risks) if (r.level && AREA_LEVELS.includes(r.level) && r.p >= SUSPECTED) members.set(key(r.x, r.y), r)
  const seen = new Set<string>()
  const groups: CellRisk[][] = []
  const starts = [...members.values()].sort((a, b) => a.y - b.y || a.x - b.x)
  for (const start of starts) {
    const k = key(start.x, start.y)
    if (seen.has(k)) continue
    seen.add(k)
    const queue = [start]
    const group: CellRisk[] = []
    while (queue.length) {
      const r = queue.pop()!
      group.push(r)
      for (let dx = -2; dx <= 2; dx++)
        for (let dy = -2; dy <= 2; dy++) {
          const nk = key(r.x + dx, r.y + dy)
          const next = members.get(nk)
          if (next && !seen.has(nk)) {
            seen.add(nk)
            queue.push(next)
          }
        }
    }
    groups.push(group.sort((a, b) => a.y - b.y || a.x - b.x))
  }

  const areas = groups.map((group): RiskArea => {
    const kind: RiskKind = group.some((r) => r.kind === 'explosive') ? 'explosive' : 'activity'
    const peak = group.reduce((best, r) => {
      const a = [RANK[r.level!], r.p, -r.y, -r.x]
      const b = [RANK[best.level!], best.p, -best.y, -best.x]
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? r : best
      return best
    })
    const level = peak.level!
    const severe = kind === 'explosive' && (level === 'EH' || level === 'H')
    const n = group.length
    const cx = floorDiv(group.reduce((s, r) => s + r.x, 0) * 100, n)
    const cy = floorDiv(group.reduce((s, r) => s + r.y, 0) * 100, n)
    const reasons = [...peak.reasons]
    if (n > 1) reasons.push(`${plural(n, 'cell', 'cells')} in this area`)
    return {
      id: '',
      kind,
      level,
      label: kind === 'explosive' ? 'Suspected explosive hazard' : 'Recent activity',
      action: kind === 'explosive' ? (severe ? ACTIONS.severe : ACTIONS.anomaly) : ACTIONS.activity,
      cells: group.map((r) => [r.x, r.y]),
      centroid: [cx / 100, cy / 100],
      peak: [peak.x, peak.y],
      p: peak.p,
      reasons,
    }
  })
  areas.sort((a, b) => RANK[b.level] - RANK[a.level] || b.p - a.p || a.peak[1] - b.peak[1] || a.peak[0] - b.peak[0])
  return areas.map((a, i) => ({ ...a, id: `A${i + 1}` }))
}

export function assess(input: CellReadings[]): RiskAssessment {
  const metalMax = new Map(input.map((c) => [key(c.x, c.y), max(ok(c.metal))]))
  const vocMax = new Map(input.map((c) => [key(c.x, c.y), max(ok(c.voc))]))
  const risks = [...input].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => assessCell(c, metalMax, vocMax))
  const areas = areasOf(risks)

  const matrix: Record<string, number[]> = Object.fromEntries(SEVERITY.map((s) => [s, [0, 0, 0, 0, 0]]))
  for (const r of risks) if (r.kind) matrix[r.severity!][PROBABILITY.indexOf(r.probability as (typeof PROBABILITY)[number])] += 1

  const surveyed = risks.length
  const assessed = risks.filter((r) => r.assessed).length
  const severe = areas.filter((a) => a.kind === 'explosive' && (a.level === 'EH' || a.level === 'H')).length
  const anomalies = areas.filter((a) => a.kind === 'explosive' && a.level === 'M').length
  const activity = areas.filter((a) => a.kind === 'activity').length
  const inAreas = new Set(areas.flatMap((a) => a.cells.map(([x, y]) => key(x, y))))
  const loose = risks.filter((r) => r.kind === 'explosive' && !inAreas.has(key(r.x, r.y))).length
  const missing = surveyed - assessed
  const missingPct = surveyed ? floorDiv(missing * 100 + floorDiv(surveyed, 2), surveyed) : 0

  const reasons: string[] = []
  if (severe) reasons.push(plural(severe, 'suspected explosive hazard', 'suspected explosive hazards'))
  if (anomalies) reasons.push(`${plural(anomalies, 'metal anomaly area', 'metal anomaly areas')} to re-survey`)
  if (activity) reasons.push(plural(activity, 'recent activity area', 'recent activity areas'))
  if (loose) reasons.push(`${plural(loose, 'metal anomaly', 'metal anomalies')} to re-survey`)
  if (missing) reasons.push(`${missingPct}% of surveyed cells not assessed`)
  if (!reasons.length) reasons.push('No indications in surveyed cells')

  return {
    rules_version: RULES_VERSION,
    summary: reasons,
    coverage: { surveyed, assessed },
    matrix,
    cells: risks.filter((r) => r.kind !== null || !r.assessed),
    areas,
  }
}

const reading = (r: SensorReading): Reading => [r.value, r.status]

/** Risk for the cells as currently shown (live or at a point in playback). */
export function assessCells(cells: Cell[]): RiskAssessment {
  return assess(cells.map((c) => ({ x: c.x, y: c.y, metal: c.observations.map((o) => reading(o.metal)), voc: c.observations.map((o) => reading(o.voc)) })))
}

/** Strongest valid reading for a sensor, 0..1, or null when there is none. */
export function strongest(cell: Cell, sensor: 'metal' | 'voc'): number | null {
  const values = cell.observations.map((o) => o[sensor]).filter((r) => r.status === 'ok' && r.value !== null).map((r) => r.value as number)
  return values.length ? Math.max(...values) : null
}
