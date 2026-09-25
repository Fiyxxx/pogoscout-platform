import { useEffect, useRef, useState } from 'react'
import { exportUrls } from '../../api/client'
import type { MissionSummary } from '../../api/types'
import { clock } from '../../lib/format'

export function ExportMenu({ mission, modelVersion }: { mission: MissionSummary; modelVersion: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const urls = exportUrls(mission.id)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const s = mission.stats
  const summary = [
    `${s.flags} flags`,
    `${s.hops} hops`,
    mission.started_at ? `${clock(mission.started_at)} to ${clock(mission.last_hop_at)}Z` : null,
    modelVersion,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 8 }}>
      <button className="btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)} style={{ background: open ? 'var(--hover)' : undefined }}>
        Export
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 46, zIndex: 20, width: 300, background: 'var(--surface)', border: '1px solid var(--line-strong)', boxShadow: '0 16px 40px rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column' }}>
          <MenuLink href={urls.report} newTab>
            <span style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: 14, fontWeight: 600 }}>
              Mission report
              <Format>PDF</Format>
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{summary}</span>
          </MenuLink>
          <MenuLink href={urls.hops}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Hop log <Format>CSV</Format>
            </span>
          </MenuLink>
          <MenuLink href={urls.cells}>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Cell map <Format>CSV</Format>
            </span>
          </MenuLink>
          <MenuLink href={urls.archive} last>
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              Full mission archive <Format>JSON</Format>
            </span>
          </MenuLink>
        </div>
      )}
    </div>
  )
}

function Format({ children }: { children: string }) {
  return (
    <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
      {children}
    </span>
  )
}

function MenuLink({ href, children, newTab, last }: { href: string; children: React.ReactNode; newTab?: boolean; last?: boolean }) {
  return (
    <a
      role="menuitem"
      href={href}
      target={newTab ? '_blank' : undefined}
      rel={newTab ? 'noreferrer' : undefined}
      download={newTab ? undefined : ''}
      style={{
        display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 16px', textDecoration: 'none', fontSize: 14,
        borderBottom: last ? undefined : '1px solid var(--line)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </a>
  )
}
