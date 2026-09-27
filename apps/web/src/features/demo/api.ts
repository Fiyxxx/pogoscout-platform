// Live ground demo endpoints (docs/API.md, "Live ground demo"). Kept out of api/client.ts: only
// the demo page uses them.
import { API_BASE, ApiError, keys } from '../../api/client'
import type { ClassificationStatus } from '../../api/types'

export type GroundService = 'off' | 'ok' | 'offline'

export type GroundDemoState = {
  running: boolean
  mission_id: string | null
  hops: number
  interval_s: number
  ground: GroundService
  ground_model_version: string | null
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

async function call<T>(path: string, method: 'GET' | 'POST' = 'GET'): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new ApiError(res.status, typeof body?.detail === 'string' ? body.detail : res.statusText)
  }
  return res.json() as Promise<T>
}

export const demoApi = {
  state: () => call<GroundDemoState>('/ground-demo'),
  start: () => call<GroundDemoState>('/ground-demo/start', 'POST'),
  stop: () => call<GroundDemoState>('/ground-demo/stop', 'POST'),
  hops: (missionId: string, limit = 10) => call<GroundHop[]>(`/ground-demo/${missionId}/hops?limit=${limit}`),
}

export const demoKeys = {
  state: ['ground-demo'] as const,
  // Under keys.mission(id), so the live `mission` topic after every hop refreshes it too.
  hops: (missionId: string) => [...keys.mission(missionId), 'ground-hops'] as const,
}
