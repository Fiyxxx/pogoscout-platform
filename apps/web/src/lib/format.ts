import type { Point } from '../api/types'

export const xy = (p: Point) => `(${p.x}, ${p.y})`

/** HH:MM:SS in UTC. */
export function clock(iso: string | null | undefined): string {
  if (!iso) return '--:--:--'
  return new Date(iso).toISOString().slice(11, 19)
}

export const pad3 = (n: number) => String(n).padStart(3, '0')

/** Mission time between two instants, as MM:SS (or H:MM:SS past an hour). */
export function elapsed(from: string | null, to: string | null): string {
  if (!from || !to) return '00:00'
  const total = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Human duration such as "1m 24s" or "36s". */
export function duration(from: string | null, to: string | null): string {
  if (!from || !to) return '0s'
  const total = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  if (m === 0) return `${s}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "25 Sep 08:00" in UTC, independent of the browser locale. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return 'Not started'
  const d = new Date(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`
}

export const confidence = (c: number | null | undefined) => (c == null ? '' : c.toFixed(2))
