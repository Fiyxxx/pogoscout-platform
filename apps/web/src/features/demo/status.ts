import type { GroundDemoState, GroundHop, GroundSession } from './api'

export const NO_LABEL_YET = 'no confident classification yet'

export type RunView = { text: string; tone: 'live' | 'warn' | 'idle'; hint?: string }

/** A session's lifecycle, for the session list: polling, left idle by a restart, or ended. */
export function sessionState(session: GroundSession): RunView {
  if (session.status !== 'live') return { text: 'Ended', tone: 'idle' }
  if (!session.running)
    return { text: 'Not polling', tone: 'warn', hint: 'The platform restarted. Stop ends this session; create a new one to carry on.' }
  return { text: 'Polling', tone: 'live' }
}

/** One line for the header: what the selected session is doing right now. */
export function runView(state: GroundDemoState | undefined, session: GroundSession | undefined, newest: GroundHop | undefined): RunView {
  if (!state) return { text: 'Connecting', tone: 'idle' }
  if (!session) return { text: 'No session', tone: 'idle', hint: 'Create a session to start polling the ground service.' }
  const lifecycle = sessionState(session)
  if (lifecycle.tone !== 'live') return lifecycle
  if (state.ground === 'offline')
    return { text: 'Ground service offline', tone: 'warn', hint: 'Hops keep coming, marked unavailable, until it is back.' }
  if (newest?.status === 'unavailable' && newest.error === NO_LABEL_YET)
    return { text: 'Waiting for the first confident label', tone: 'warn', hint: 'Point the camera at the ground.' }
  return { text: 'Running', tone: 'live' }
}

/** "0.4 s old" for a reading's age at the moment it was fetched. */
export function ageText(age: number | null): string {
  return age === null ? '' : `${age.toFixed(1)} s old`
}
