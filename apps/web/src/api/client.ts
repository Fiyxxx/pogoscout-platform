import type {
  CellsResponse,
  Health,
  HopRecord,
  MissionEvent,
  MissionStatus,
  MissionSummary,
  ReplayState,
  Scenario,
} from './types'

export const API_BASE = '/api/v1'

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : res.statusText
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export const api = {
  health: () => request<Health>('/health'),
  missions: () => request<MissionSummary[]>('/missions'),
  mission: (id: string) => request<MissionSummary>(`/missions/${id}`),
  createMission: (name: string) => post<MissionSummary>('/missions', { name, source: 'manual' }),
  setStatus: (id: string, status: MissionStatus) =>
    request<MissionSummary>(`/missions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  cells: (id: string) => request<CellsResponse>(`/missions/${id}/cells`),
  hops: (id: string) => request<HopRecord[]>(`/missions/${id}/hops`),
  events: (id: string, limit = 200) => request<MissionEvent[]>(`/missions/${id}/events?limit=${limit}`),
  scenarios: () => request<Scenario[]>('/scenarios'),
  createReplay: (scenarioId: string, name: string) =>
    post<MissionSummary>('/replays', { scenario_id: scenarioId, name }),
  replay: (id: string) => request<ReplayState>(`/missions/${id}/replay`),
  replayStep: (id: string) => post<ReplayState>(`/missions/${id}/replay/step`),
  replayPlay: (id: string, speed: number) => post<ReplayState>(`/missions/${id}/replay/play`, { speed }),
  replayPause: (id: string) => post<ReplayState>(`/missions/${id}/replay/pause`),
}

export const exportUrls = (id: string) => ({
  report: `${API_BASE}/missions/${id}/report`,
  hops: `${API_BASE}/missions/${id}/export/hops.csv`,
  cells: `${API_BASE}/missions/${id}/export/cells.csv`,
  archive: `${API_BASE}/missions/${id}/export/archive.json`,
})

/** Query keys, grouped by the live-notification topic that invalidates them. */
export const keys = {
  missions: ['missions'] as const,
  mission: (id: string) => ['mission', id] as const,
  cells: (id: string) => ['cells', id] as const,
  hops: (id: string) => ['hops', id] as const,
  events: (id: string) => ['events', id] as const,
  replay: (id: string) => ['replay', id] as const,
  health: ['health'] as const,
  scenarios: ['scenarios'] as const,
}
