import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assess, hundredths, type CellReadings } from '../src/lib/risk'

// The same cases the API checks: both implementations must return identical assessments.
const path = resolve(process.cwd(), '../../contracts/risk.v1.cases.json')
const contract = JSON.parse(readFileSync(path, 'utf8')) as {
  rules_version: string
  cases: { name: string; cells: CellReadings[]; expected: unknown }[]
}

describe('risk rules match the API', () => {
  it('uses the same rules version', () => expect(contract.rules_version).toBe('risk-1'))
  for (const c of contract.cases) it(c.name, () => expect(assess(c.cells)).toEqual(c.expected))
})

describe('hundredths', () => {
  it('rounds half up like the API', () => expect([0.125, 0.745, 0.5, 0.004].map(hundredths)).toEqual([13, 75, 50, 0]))
})
