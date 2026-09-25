// The interface is designed on a 1440 x 900 reference frame. Scaling the root keeps those
// proportions on any display: a laptop gets the whole dashboard, a wall screen gets it large.
const REFERENCE = { width: 1440, height: 900 }
const LIMITS = { min: 0.75, max: 2.5 }

export function viewportScale(width: number, height: number): number {
  const fit = Math.min(width / REFERENCE.width, height / REFERENCE.height)
  return Math.min(LIMITS.max, Math.max(LIMITS.min, Math.round(fit * 1000) / 1000))
}

export function installViewportScale(): () => void {
  const apply = () => {
    const scale = viewportScale(window.innerWidth, window.innerHeight)
    document.documentElement.style.setProperty('zoom', String(scale))
    document.documentElement.style.setProperty('--ui-scale', String(scale))
  }
  apply()
  window.addEventListener('resize', apply)
  return () => window.removeEventListener('resize', apply)
}
