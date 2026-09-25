import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Theatre' },
  { to: '/missions', label: 'Missions' },
]

export function NavTabs() {
  return (
    <nav style={{ display: 'flex', gap: 4, fontSize: 14 }}>
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          style={({ isActive }) => ({
            padding: '8px 12px',
            textDecoration: 'none',
            color: isActive ? 'var(--text)' : 'var(--muted)',
            background: isActive ? 'var(--surface-2)' : 'transparent',
          })}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
