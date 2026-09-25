import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { api, keys } from '../api/client'
import type { LinkState } from '../api/live'
import { Brand } from './Brand'

export function TopBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <header
      style={{
        height: 'var(--topbar-h)',
        flexShrink: 0,
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        borderBottom: '1px solid var(--line)',
      }}
    >
      <Brand />
      <span style={{ width: 1, height: 24, background: '#2a2a28' }} />
      {children}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', height: '100%' }}>{right}</div>
    </header>
  )
}

function Light({ label, state }: { label: string; state: 'ok' | 'degraded' | 'offline' }) {
  const color = state === 'ok' ? 'var(--text)' : state === 'degraded' ? 'var(--signal)' : 'var(--faint)'
  const title = state === 'ok' ? `${label} healthy` : state === 'degraded' ? `${label} degraded` : `${label} offline`
  return (
    <span title={title} style={{ display: 'flex', alignItems: 'center', gap: 6, color: state === 'ok' ? 'var(--muted)' : color }}>
      <span className="dot" style={{ color }} />
      {label}
    </span>
  )
}

/** Link (live socket) and model (classifier) health. */
export function HealthLights({ link }: { link?: LinkState }) {
  const health = useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 10_000 })
  const model = health.isError ? 'offline' : (health.data?.classifier_status ?? 'ok')
  const linkState = link === undefined ? (health.isError ? 'offline' : 'ok') : link === 'open' ? 'ok' : 'degraded'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '0 16px',
        borderLeft: '1px solid var(--line)',
        fontSize: 12,
      }}
    >
      <Light label="Link" state={linkState} />
      <Light label="Model" state={model} />
    </div>
  )
}

export function Stat({ label, value, signal }: { label: string; value: ReactNode; signal?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 16px', borderLeft: '1px solid var(--line)' }}>
      <span className="key">{label}</span>
      <span className="mono" style={{ fontSize: 15, color: signal ? 'var(--signal)' : undefined }}>
        {value}
      </span>
    </div>
  )
}
