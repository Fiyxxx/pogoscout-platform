import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Theatre' },
  { to: '/missions', label: 'Missions' },
]
// Presentation pages, set apart from the operational tabs.
const SHOWCASE = { to: '/3d', label: '3D' }
const DEMO = { to: '/demo', label: 'Live demo' }

export function NavTabs() {
  return (
    <nav style={{ display: 'flex', gap: 4, fontSize: 14 }}>
      {[...TABS, SHOWCASE, DEMO].map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          style={({ isActive }) => ({
            padding: '8px 12px',
            marginLeft: t === SHOWCASE ? 20 : 0,
            borderLeft: t === SHOWCASE ? '1px solid var(--line)' : undefined,
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
