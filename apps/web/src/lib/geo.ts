import type { GeoAnchor } from '../api/types'

const M_PER_DEG_LAT = 111_320

/**
 * Grid cell to longitude/latitude. The anchor places cell (0, 0) at the start fix; +y points along
 * `heading_deg` (clockwise from true north) and +x is 90 degrees clockwise from it.
 */
export function gridToLngLat(geo: GeoAnchor, x: number, y: number): [number, number] {
  const b = (geo.heading_deg * Math.PI) / 180
  const gx = x * geo.cell_m
  const gy = y * geo.cell_m
  const east = gx * Math.cos(b) + gy * Math.sin(b)
  const north = -gx * Math.sin(b) + gy * Math.cos(b)
  const lat = geo.lat + north / M_PER_DEG_LAT
  const lon = geo.lon + east / (M_PER_DEG_LAT * Math.cos((geo.lat * Math.PI) / 180))
  return [lon, lat]
}

/** The four corners of a cell as a closed GeoJSON ring. */
export function cellRing(geo: GeoAnchor, x: number, y: number): [number, number][] {
  const c = [
    gridToLngLat(geo, x - 0.5, y - 0.5),
    gridToLngLat(geo, x + 0.5, y - 0.5),
    gridToLngLat(geo, x + 0.5, y + 0.5),
    gridToLngLat(geo, x - 0.5, y + 0.5),
  ]
  return [...c, c[0]]
}

/** Longitude/latitude bounds of a set of cells, as [[west, south], [east, north]]. */
export function cellBounds(geo: GeoAnchor, cells: { x: number; y: number }[]): [[number, number], [number, number]] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const c of cells.length ? cells : [{ x: 0, y: 0 }]) {
    for (const [lon, lat] of cellRing(geo, c.x, c.y)) {
      w = Math.min(w, lon)
      e = Math.max(e, lon)
      s = Math.min(s, lat)
      n = Math.max(n, lat)
    }
  }
  return [[w, s], [e, n]]
}
