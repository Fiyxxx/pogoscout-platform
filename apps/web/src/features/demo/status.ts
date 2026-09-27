import type { GroundDemoState, GroundHop } from './api'

export const NO_LABEL_YET = 'no confident classification yet'

export type RunView = { text: string; tone: 'live' | 'warn' | 'idle'; hint?: string }

/** One line for the header: what the run is doing right now. */
export function runView(state: GroundDemoState | undefined, newest: GroundHop | undefined): RunView {
  if (!state) return { text: 'Connecting', tone: 'idle' }
  if (state.ground === 'off')
    return { text: 'Demo off', tone: 'idle', hint: 'Start the platform with POGOSCOUT_GROUND_ENABLED=true.' }
  if (!state.running) return { text: 'Stopped', tone: 'idle' }
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
