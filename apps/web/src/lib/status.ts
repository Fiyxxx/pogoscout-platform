import type { MissionSummary } from '../api/types'
import { duration, elapsed } from './format'

export const missionDuration = (m: MissionSummary) =>
  m.status === 'live' ? `T+${elapsed(m.started_at, m.last_hop_at)}` : duration(m.started_at, m.last_hop_at)

export function statusView(mission: MissionSummary): { text: string; color: string; pulse: boolean } {
  if (mission.status === 'live') return { text: 'Live', color: 'var(--signal)', pulse: true }
  if (mission.status === 'aborted') return { text: 'Aborted', color: 'var(--text)', pulse: false }
  return { text: 'Complete', color: 'var(--muted)', pulse: false }
}
