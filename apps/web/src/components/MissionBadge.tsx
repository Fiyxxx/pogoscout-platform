import type { MissionSummary } from '../api/types'

/** LIVE for a hardware feed, REPLAY for a recorded run still playing, otherwise the final state. */
export function MissionBadge({ mission }: { mission: MissionSummary }) {
  if (mission.status === 'live') {
    const replay = !!mission.scenario_id
    return (
      <span className="live-badge" style={{ color: replay ? 'var(--text)' : 'var(--signal)' }}>
        <span className="dot pulse" />
        {replay ? 'REPLAY' : 'LIVE'}
      </span>
    )
  }
  return (
    <span className="live-badge" style={{ color: mission.status === 'aborted' ? 'var(--text)' : 'var(--muted)' }}>
      {mission.status === 'aborted' ? 'ABORTED' : 'COMPLETE'}
    </span>
  )
}
