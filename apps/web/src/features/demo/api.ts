// Live ground demo endpoints (docs/API.md, "Live ground demo"). Kept out of api/client.ts: only
// the demo page uses them.
import { API_BASE, ApiError, keys } from '../../api/client'
import type { ClassificationStatus, MissionStatus } from '../../api/types'

export type GroundService = 'ok' | 'offline'

/** One demo run: a live mission the platform makes hops for while `running`. */
export type GroundSession = {
  mission_id: string
  name: string
  status: MissionStatus
  running: boolean // false for a session left live by a platform restart
  hops: number
  created_at: string
}

export type GroundDemoState = {
  interval_s: number
  ground: GroundService
  ground_model_version: string | null
  sessions: GroundSession[] // newest first
}

export type GroundHop = {
  hop_id: number
  x: number | null
  y: number | null
  observed_at: string
  status: ClassificationStatus
  label: string | null
  confidence: number | null
  model_version: string | null
  captured_at: number | null
  age_s: number | null
  stale: boolean | null
  error: string | null
  image_url: string | null
}

async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, typeof body?.detail === 'string' ? body.detail : res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const demoApi = {
  state: () => call<GroundDemoState>('/ground-demo'),
  create: (name?: string) => call<GroundSession>('/ground-demo/sessions', 'POST', { name: name || null }),
  stop: (missionId: string) => call<GroundSession>(`/ground-demo/sessions/${missionId}/stop`, 'POST'),
  rename: (missionId: string, name: string) => call<GroundSession>(`/ground-demo/sessions/${missionId}`, 'PATCH', { name }),
  remove: (missionId: string) => call<void>(`/ground-demo/sessions/${missionId}`, 'DELETE'),
  hops: (missionId: string, limit = 10) => call<GroundHop[]>(`/ground-demo/${missionId}/hops?limit=${limit}`),
}

export const demoKeys = {
  state: ['ground-demo'] as const,
  // Under keys.mission(id), so the live `mission` topic after every hop refreshes it too.
  hops: (missionId: string) => [...keys.mission(missionId), 'ground-hops'] as const,
}
