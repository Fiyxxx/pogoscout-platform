import type { MissionSummary } from '../api/types'

export function statusView(mission: MissionSummary): { text: string; color: string; pulse: boolean } {
  if (mission.status === 'live') return { text: mission.scenario_id ? 'Replaying' : 'Live', color: 'var(--signal)', pulse: true }
  if (mission.status === 'aborted') return { text: 'Aborted', color: 'var(--text)', pulse: false }
  return { text: 'Complete', color: 'var(--muted)', pulse: false }
}
