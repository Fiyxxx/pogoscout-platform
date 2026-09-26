// Risk assessment, rules `risk-1`. A line-for-line port of apps/api/src/pogoscout_api/domain/risk.py
// so the mission page can assess any moment of playback. Both run contracts/risk.v1.cases.json.
// All arithmetic is on integer hundredths so the two implementations agree exactly.

import type { Cell, SensorReading } from '../api/types'

export type RiskKind = 'explosive' | 'activity'
export type RiskLevel = 'EH' | 'H' | 'M' | 'L'
export type Verdict = 'go' | 'caution' | 'no_go'

export type CellRisk = {
  x: number
  y: number
  assessed: boolean
  kind: RiskKind | null
  score: number
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
  score: number
  reasons: string[]
}

export type RiskAssessment = {
  rules_version: string
  verdict: Verdict
  verdict_reasons: string[]
  coverage: { surveyed: number; assessed: number }
  matrix: Record<string, number[]>
  cells: CellRisk[]
  areas: RiskArea[]
}

type Reading = [number | null, string]
export type CellReadings = { x: number; y: number; metal: Reading[]; voc: Reading[] }

export const RULES_VERSION = 'risk-1'
const SIGNAL = 30
const DETECTED = 50
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
export const VERDICT_NAMES: Record<Verdict, string> = { go: 'Go', caution: 'Caution', no_go: 'No-go' }
const AREA_LEVELS: RiskLevel[] = ['EH', 'H', 'M']

/** 0..1 to 0..100, half away from zero, identical to the Python rules. */
export const hundredths = (value: number) => Math.floor(value * 100 + 0.5)
const floorDiv = (a: number, b: number) => Math.floor(a / b)
const fmt = (h: number) => `${floorDiv(h, 100)}.${String(((h % 100) + 100) % 100).padStart(2, '0')}`
const ok = (readings: Reading[]) => readings.filter(([v, s]) => s === 'ok' && v !== null).map(([v]) => hundredths(v as number))
const max = (values: number[]) => (values.length ? Math.max(...values) : 0)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const key = (x: number, y: number) => `${x},${y}`

export function probability(score: number): string {
  for (const [threshold, grade] of [[90, 'A'], [75, 'B'], [60, 'C'], [50, 'D']] as const) if (score >= threshold) return grade
  return 'E'
}

function repeat(values: number[], sensor: string): [number, string | null] {
  const n = values.length
  if (n < 2) return [0, null]
  const hits = values.filter((v) => v >= SIGNAL).length
  if (hits < n) return [-10, `${sensor} on ${hits} of ${n} visits`]
  if (Math.min(...values) >= DETECTED) return [10, `${sensor} confirmed on all ${n} visits`]
  return [0, `${sensor} on all ${n} visits`]
}

function assessCell(cell: CellReadings, metalMax: Map<string, number>, vocMax: Map<string, number>): CellRisk {
  const metal = ok(cell.metal)
  const voc = ok(cell.voc)
  const { x, y } = cell
  const none = { kind: null, score: 0, probability: null, severity: null, level: null, label: null }
  if (!metal.length) {
    const failed = cell.metal.some(([, s]) => s === 'error')
    return { x, y, assessed: false, ...none, reasons: [failed ? 'Metal sensor error' : 'No metal reading'] }
  }
  const m = max(metal)
  const v = max(voc)
  const reasons: string[] = []
  let kind: RiskKind
  let severity: string
  let score: number
  if (m >= SIGNAL) {
    kind = 'explosive'
    severity = 'I'
    score = m
    reasons.push(`Metal signal ${fmt(m)}`)
    const [change, why] = repeat(metal, 'Metal')
    score += change
    if (why) reasons.push(why)
    let near = 0
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) near = Math.max(near, vocMax.get(key(x + dx, y + dy)) ?? 0)
    if (near >= DETECTED) {
      score += 10
      reasons.push(`VOC ${fmt(near)} at or beside this cell`)
    }
    let pattern = 0
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++) if ((dx || dy) && (metalMax.get(key(x + dx, y + dy)) ?? 0) >= DETECTED) pattern++
    if (pattern >= 2) {
      score += 10
      reasons.push(`${pattern} more metal hits within 2 cells`)
    }
  } else if (v >= SIGNAL) {
    kind = 'activity'
    severity = 'III'
    score = v
    reasons.push(`VOC signal ${fmt(v)}`)
    const [change, why] = repeat(voc, 'VOC')
    score += change
    if (why) reasons.push(why)
    reasons.push('No metal signal')
  } else {
    return { x, y, assessed: true, ...none, score: Math.max(m, v), reasons: [] }
  }
  score = Math.max(0, Math.min(100, score))
  const grade = probability(score)
  const level = MATRIX[severity][PROBABILITY.indexOf(grade as (typeof PROBABILITY)[number])]
  const label = kind === 'explosive' ? (score >= DETECTED ? 'Suspected explosive hazard' : 'Metal anomaly') : 'Recent activity cue'
  return { x, y, assessed: true, kind, score, probability: grade, severity, level, label, reasons }
}

const ACTIONS = {
  severe: 'Do not enter. Mark and bypass, and request EOD clearance.',
  anomaly: 'Re-survey with the Route clearance loadout before use.',
  activity: 'Approach with caution and observe. A cue, not a detection.',
}

function areasOf(risks: CellRisk[]): RiskArea[] {
  const members = new Map<string, CellRisk>()
  for (const r of risks) if (r.level && AREA_LEVELS.includes(r.level) && r.score >= DETECTED) members.set(key(r.x, r.y), r)
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
      const a = [RANK[r.level!], r.score, -r.y, -r.x]
      const b = [RANK[best.level!], best.score, -best.y, -best.x]
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
      score: peak.score,
      reasons,
    }
  })
  areas.sort((a, b) => RANK[b.level] - RANK[a.level] || b.score - a.score || a.peak[1] - b.peak[1] || a.peak[0] - b.peak[0])
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
  if (loose) reasons.push(`${plural(loose, 'weak metal reading', 'weak metal readings')} to re-survey`)
  if (missing) reasons.push(`${missingPct}% of surveyed cells not assessed`)
  const verdict: Verdict = severe ? 'no_go' : anomalies || activity || loose || missingPct >= 5 ? 'caution' : 'go'
  if (!reasons.length) reasons.push('No indications in surveyed cells')

  return {
    rules_version: RULES_VERSION,
    verdict,
    verdict_reasons: reasons,
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
