import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, exportUrls, keys } from '../api/client'
import type { MissionStatus, MissionSummary } from '../api/types'
import { statusView } from '../lib/status'
import { HealthLights, TopBar } from '../components/TopBar'
import { MiniMap } from '../features/missions/MiniMap'
import { NewMissionDialog } from '../features/missions/NewMissionDialog'
import { duration, elapsed, shortDate } from '../lib/format'
import { isMaterial, MATERIAL_COLORS, MATERIAL_NAMES } from '../lib/materials'

type Tab = 'all' | MissionStatus
const TABS: { id: Tab; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'live', name: 'Live' },
  { id: 'complete', name: 'Complete' },
  { id: 'aborted', name: 'Aborted' },
]

const missionDuration = (m: MissionSummary) =>
  m.status === 'live' ? `T+${elapsed(m.started_at, m.last_hop_at)}` : duration(m.started_at, m.last_hop_at)

export function MissionsPage() {
  const missions = useQuery({ queryKey: keys.missions, queryFn: api.missions, refetchInterval: 5_000 })
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    document.title = 'Missions - PogoScout'
  }, [])

  const all = useMemo(() => missions.data ?? [], [missions.data])
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all.filter((m) => (tab === 'all' || m.status === tab) && (!q || `${m.name} ${m.id}`.toLowerCase().includes(q)))
  }, [all, tab, query])
  const selected = all.find((m) => m.id === selectedId) ?? shown[0] ?? null

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <TopBar
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <HealthLights />
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New mission
            </button>
          </div>
        }
      >
        <nav style={{ display: 'flex', gap: 4, fontSize: 14 }}>
          <span style={{ padding: '8px 12px', background: 'var(--surface-2)' }}>Missions</span>
        </nav>
      </TopBar>

      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <main className="scroll" style={{ flexGrow: 1, minWidth: 0, padding: '32px 32px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <h1 className="brand" style={{ margin: 0, fontWeight: 700, fontSize: 32, lineHeight: 1 }}>
              Missions
            </h1>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, width: 300, height: 40, padding: '0 12px', border: '1px solid #2a2a28' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#8a8a86" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="6" />
                <path d="M20 20l-4.5-4.5" />
              </svg>
              <input
                aria-label="Search missions"
                placeholder="Search missions"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ flexGrow: 1, background: 'transparent', border: 'none', color: 'var(--text)', font: 'inherit', outline: 'none' }}
              />
            </label>
          </div>

          <div role="tablist" style={{ display: 'flex', gap: 24, borderBottom: '1px solid var(--line)' }}>
            {TABS.map((t) => {
              const active = t.id === tab
              const count = all.filter((m) => t.id === 'all' || m.status === t.id).length
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '0 0 12px', border: 'none', borderBottom: `2px solid ${active ? 'var(--text)' : 'transparent'}`, marginBottom: -1,
                    background: 'transparent', fontSize: 14, fontWeight: 500, color: active ? 'var(--text)' : 'var(--muted)', display: 'flex', gap: 8,
                  }}
                >
                  {t.name}
                  <span className="mono faint">{count}</span>
                </button>
              )
            })}
          </div>

          {missions.isLoading ? (
            <span className="muted">Loading missions</span>
          ) : shown.length === 0 ? (
            <span className="muted">{all.length === 0 ? 'No missions yet. Start one with New mission.' : 'No missions match.'}</span>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 12 }}>
                  <Th first>Mission</Th>
                  <Th>Status</Th>
                  <Th>Started</Th>
                  <Th>Duration</Th>
                  <Th right>Hops</Th>
                  <Th right>Metal</Th>
                  <Th right>VOC</Th>
                  <Th right last>Flags</Th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <MissionRow key={m.id} mission={m} active={m.id === selected?.id} onSelect={() => setSelectedId(m.id)} />
                ))}
              </tbody>
            </table>
          )}
        </main>
        {selected && <Preview mission={selected} />}
      </div>
      {creating && <NewMissionDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function Th({ children, right, first, last }: { children: string; right?: boolean; first?: boolean; last?: boolean }) {
  return (
    <th style={{ padding: `0 ${last ? 0 : 12}px 10px ${first ? 0 : 12}px`, fontWeight: 500, textAlign: right ? 'right' : 'left' }}>
      {children}
    </th>
  )
}

function MissionRow({ mission: m, active, onSelect }: { mission: MissionSummary; active: boolean; onSelect: () => void }) {
  const navigate = useNavigate()
  const st = statusView(m)
  const td = { padding: '16px 12px' }
  return (
    <tr
      tabIndex={0}
      aria-selected={active}
      onClick={onSelect}
      onDoubleClick={() => navigate(`/missions/${m.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate(`/missions/${m.id}`)
        if (e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{ cursor: 'pointer', borderTop: '1px solid var(--line-soft)', background: active ? 'var(--surface-2)' : undefined, transition: 'background-color .15s ease' }}
    >
      <td style={{ padding: '16px 0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600 }}>{m.name}</span>
          <span className="mono faint" style={{ fontSize: 12 }}>
            {m.id}
          </span>
        </div>
      </td>
      <td style={td}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: st.color }}>
          <span className={st.pulse ? 'dot pulse' : 'dot'} style={{ width: 7, height: 7 }} />
          {st.text}
        </span>
      </td>
      <td className="mono" style={{ ...td, fontSize: 13, color: 'var(--text-2)' }}>
        {shortDate(m.started_at)}
      </td>
      <td className="mono" style={{ ...td, fontSize: 13, color: 'var(--text-2)' }}>
        {missionDuration(m)}
      </td>
      <td className="mono" style={{ ...td, textAlign: 'right' }}>
        {m.stats.hops}
      </td>
      <td className="mono" style={{ ...td, textAlign: 'right', color: m.stats.metal ? 'var(--signal)' : 'var(--faint)' }}>
        {m.stats.metal}
      </td>
      <td className="mono" style={{ ...td, textAlign: 'right' }}>
        {m.stats.voc}
      </td>
      <td className="mono muted" style={{ padding: '16px 0 16px 12px', textAlign: 'right' }}>
        {m.stats.flags}
      </td>
    </tr>
  )
}

function Preview({ mission: m }: { mission: MissionSummary }) {
  const cells = useQuery({ queryKey: keys.cells(m.id), queryFn: () => api.cells(m.id) })
  const st = statusView(m)
  const total = Object.values(m.stats.materials).reduce((a, b) => a + b, 0)
  const mix = Object.entries(m.stats.materials)
    .filter(([label]) => isMaterial(label))
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => ({ label, pct: Math.round((n / total) * 100) }))
  const stats: [string, string | number, boolean?][] = [
    ['Hops', m.stats.hops],
    ['Metal', m.stats.metal, m.stats.metal > 0],
    ['VOC', m.stats.voc],
    ['Flags', m.stats.flags],
    ['Duration', missionDuration(m)],
    ['Started', m.started_at ? shortDate(m.started_at).split(' ').pop()! : 'Not started'],
  ]

  return (
    <aside style={{ width: 420, flexShrink: 0, borderLeft: '1px solid var(--line)', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="brand" style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.1 }}>
            {m.name}
          </span>
          <span className="mono muted" style={{ fontSize: 12 }}>
            {m.id}
          </span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: st.color, whiteSpace: 'nowrap' }}>
          <span className={st.pulse ? 'dot pulse' : 'dot'} style={{ width: 7, height: 7 }} />
          {st.text}
        </span>
      </div>

      <div
        style={{
          position: 'relative', height: 300, border: '1px solid var(--line)', backgroundColor: '#0d0d0c',
          backgroundImage: 'linear-gradient(#171716 1px, transparent 1px), linear-gradient(90deg, #171716 1px, transparent 1px)', backgroundSize: '20px 20px',
        }}
      >
        {cells.data && <MiniMap data={cells.data} width={370} height={298} />}
        {m.status_note && (
          <span style={{ position: 'absolute', left: 10, bottom: 10, fontSize: 12, padding: '4px 8px', background: 'var(--bg)', border: '1px solid var(--line-strong)' }}>
            {m.status_note}
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', borderTop: '1px solid var(--line)', borderLeft: '1px solid var(--line)' }}>
        {stats.map(([label, value, signal]) => (
          <div key={label} style={{ padding: 12, borderRight: '1px solid var(--line)', borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="key">{label}</span>
            <span className="mono" style={{ fontSize: 16, color: signal ? 'var(--signal)' : undefined }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      {mix.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span className="section-title">Ground cover</span>
          <div style={{ display: 'flex', height: 8 }}>
            {mix.map((k) => (
              <span key={k.label} style={{ width: `${k.pct}%`, background: isMaterial(k.label) ? MATERIAL_COLORS[k.label] : undefined }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
            {mix.map((k) => (
              <span key={k.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ width: 8, height: 8, background: isMaterial(k.label) ? MATERIAL_COLORS[k.label] : undefined }} />
                {isMaterial(k.label) ? MATERIAL_NAMES[k.label] : k.label}
                <span className="mono faint">{k.pct}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'auto', display: 'flex', gap: 8 }}>
        <Link className="btn btn-primary" style={{ flexGrow: 1, height: 44 }} to={`/missions/${m.id}`}>
          {m.status === 'live' ? 'Open live mission' : 'Open mission'}
        </Link>
        <a className="btn" style={{ height: 44 }} href={exportUrls(m.id).report} target="_blank" rel="noreferrer">
          Report
        </a>
      </div>
    </aside>
  )
}
