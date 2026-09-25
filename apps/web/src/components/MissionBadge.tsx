import type { MissionSummary } from '../api/types'

/** What the operator is looking at: the live feed, a history replay, or a finished mission. */
export function MissionBadge({ mission, replaying = false }: { mission: MissionSummary; replaying?: boolean }) {
  if (replaying) {
    return <span className="live-badge" style={{ color: 'var(--text)' }}>REPLAY</span>
  }
  if (mission.status === 'live') {
    return (
      <span className="live-badge" style={{ color: 'var(--signal)' }}>
        <span className="dot pulse" />
        LIVE
      </span>
    )
  }
  return (
    <span className="live-badge" style={{ color: mission.status === 'aborted' ? 'var(--text)' : 'var(--muted)' }}>
      {mission.status === 'aborted' ? 'ABORTED' : 'COMPLETE'}
    </span>
  )
}
