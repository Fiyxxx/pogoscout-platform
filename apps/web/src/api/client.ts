import type { CellsResponse, Health, Mission } from './types'

const BASE = '/api/v1'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<Health>('/health'),
  missions: () => request<Mission[]>('/missions'),
  createMission: (name: string) =>
    request<Mission>('/missions', { method: 'POST', body: JSON.stringify({ name }) }),
  cells: (missionId: string) => request<CellsResponse>(`/missions/${missionId}/cells`),
}
