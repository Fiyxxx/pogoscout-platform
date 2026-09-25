import { Link } from 'react-router-dom'

/** The Hop Arc mark: one hop from takeoff to landing over a ground line. */
export function HopArcMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M6 52 H52" strokeWidth="4" strokeLinecap="square" />
      <path d="M12 52 Q32 -24 52 52" strokeWidth="7" />
      <circle cx="52" cy="52" r="7" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function Brand() {
  return (
    <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }} aria-label="PogoScout theatre">
      <HopArcMark />
      <span className="brand" style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.02em' }}>
        POGOSCOUT
      </span>
    </Link>
  )
}
