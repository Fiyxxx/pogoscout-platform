import 'maplibre-gl/dist/maplibre-gl.css'
import { AttributionControl, type GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, ScaleControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import type { WorldMission } from '../../api/types'
import { cellBounds, cellRing, gridToLngLat } from '../../lib/geo'
import { isMaterial, MATERIAL_COLORS } from '../../lib/materials'

export type Basemap = 'relief' | 'satellite'
export type WorldLayers = { basemap: Basemap; hotspots: boolean; footprints: boolean }

type Props = {
  missions: WorldMission[]
  focused: string | null
  layers: WorldLayers
  onFocus: (id: string | null) => void
  overviewSignal: number
}

// Let Vite bundle MapLibre's module worker; its default lookup fails under the dev bundler.
setWorkerUrl(maplibreWorkerUrl)

const TERRAIN_EXAGGERATION = 3
const OVERVIEW = { center: [103.81, 1.318] as [number, number], zoom: 11.15, pitch: 50, bearing: -12 }
const SIGNAL = '#ff5a1f'

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    // Keyless basemaps: Esri World Dark Gray Canvas (relief) and World Imagery (satellite).
    relief: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
      attribution: 'Basemap © Esri, HERE, Garmin, OpenStreetMap contributors',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 16,
    },
    satellite: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    terrainDem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Elevation © Mapzen, AWS Terrain Tiles',
    },
    shadeDem: {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0a0a0a' } },
    { id: 'relief', type: 'raster', source: 'relief', paint: { 'raster-saturation': -1, 'raster-contrast': 0.15 } },
    {
      id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' },
      paint: { 'raster-saturation': -0.55, 'raster-brightness-max': 0.62, 'raster-contrast': 0.08 },
    },
    {
      id: 'hillshade', type: 'hillshade', source: 'shadeDem',
      paint: { 'hillshade-shadow-color': '#000000', 'hillshade-highlight-color': '#5a5a56', 'hillshade-accent-color': '#161615', 'hillshade-exaggeration': 0.7 },
    },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.55 } },
  ],
  terrain: { source: 'terrainDem', exaggeration: TERRAIN_EXAGGERATION },
  sky: { 'sky-color': '#0a0a0a', 'horizon-color': '#1a1a19', 'fog-color': '#0a0a0a', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.7 },
}

function toGeoJSON(missions: WorldMission[]) {
  const cells: Feature[] = []
  const detections: Feature[] = []
  const outlines: Feature[] = []
  for (const w of missions) {
    for (const [x, y, label, metal, voc] of w.cells) {
      cells.push({
        type: 'Feature',
        properties: { mission: w.mission.id, color: isMaterial(label) ? MATERIAL_COLORS[label] : '#2a2a28' },
        geometry: { type: 'Polygon', coordinates: [cellRing(w.geo, x, y)] },
      })
      if (metal) detections.push({ type: 'Feature', properties: { kind: 'metal', weight: 1 }, geometry: { type: 'Point', coordinates: gridToLngLat(w.geo, x, y) } })
      if (voc) detections.push({ type: 'Feature', properties: { kind: 'voc', weight: 0.4 }, geometry: { type: 'Point', coordinates: gridToLngLat(w.geo, x, y) } })
    }
    const [[west, south], [east, north]] = cellBounds(w.geo, w.cells.map(([x, y]) => ({ x, y })))
    outlines.push({
      type: 'Feature',
      properties: { mission: w.mission.id },
      geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
    })
  }
  const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })
  return { cells: fc(cells), detections: fc(detections), outlines: fc(outlines) }
}

function addMissionLayers(map: MapLibreMap) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  map.addSource('cells', { type: 'geojson', data: empty })
  map.addSource('detections', { type: 'geojson', data: empty })
  map.addSource('outlines', { type: 'geojson', data: empty })
  map.addLayer({
    id: 'cells', type: 'fill', source: 'cells', minzoom: 14,
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.6, 17.5, 0.92] },
  })
  map.addLayer({
    id: 'outlines', type: 'line', source: 'outlines', minzoom: 13,
    paint: { 'line-color': '#f2f2f0', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.5], 'line-width': 1, 'line-dasharray': [3, 3] },
  })
  map.addLayer({
    id: 'hotspots', type: 'heatmap', source: 'detections',
    paint: {
      'heatmap-weight': ['get', 'weight'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 1.2, 15, 2.2],
      'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 12, 13, 26, 16, 60, 18, 120],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(255,90,31,0)', 0.15, 'rgba(255,90,31,0.22)', 0.45, 'rgba(255,90,31,0.55)', 0.75, 'rgba(255,90,31,0.85)', 1, '#ffd2bd',
      ],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.9, 17.5, 0.3],
    },
  })
  map.addLayer({
    id: 'metal', type: 'circle', source: 'detections', minzoom: 15.5, filter: ['==', ['get', 'kind'], 'metal'],
    paint: { 'circle-color': SIGNAL, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 2.5, 18, 6], 'circle-stroke-color': '#0a0a0a', 'circle-stroke-width': 1 },
  })
  map.addLayer({
    id: 'voc', type: 'circle', source: 'detections', minzoom: 15.5, filter: ['==', ['get', 'kind'], 'voc'],
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 3, 18, 7], 'circle-stroke-color': '#f2f2f0', 'circle-stroke-width': 1.5 },
  })
}

/** Frames all missions (or the island when there are none), leaving room for the side panel. */
function flyToOverview(map: MapLibreMap, missions: WorldMission[]) {
  if (missions.length === 0) {
    map.flyTo({ ...OVERVIEW, duration: 2200, essential: true })
    return
  }
  const bounds = new LngLatBounds()
  for (const w of missions) {
    const [[west, south], [east, north]] = cellBounds(w.geo, w.cells.map(([x, y]) => ({ x, y })))
    bounds.extend([west, south]).extend([east, north])
  }
  const camera = map.cameraForBounds(bounds, { padding: { top: 160, bottom: 120, left: 420, right: 120 }, pitch: 55, bearing: OVERVIEW.bearing, maxZoom: 15 })
  map.flyTo({ ...(camera ?? OVERVIEW), pitch: 55, bearing: OVERVIEW.bearing, duration: 2400, essential: true })
}

function markerElement(w: WorldMission, onClick: () => void): HTMLElement {
  const el = document.createElement('button')
  el.className = 'world-marker'
  el.setAttribute('aria-label', `Focus ${w.mission.name}`)
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  el.innerHTML = '<span class="world-marker-label"><span class="dot"></span><span class="name"></span><span class="count"></span></span><span class="world-marker-stem"></span>'
  return el
}

function paintMarker(el: HTMLElement, w: WorldMission, focused: boolean) {
  const live = w.mission.status === 'live'
  el.dataset.focused = String(focused)
  el.dataset.status = w.mission.status
  const dot = el.querySelector('.dot') as HTMLElement
  dot.className = live ? 'dot pulse' : 'dot'
  ;(el.querySelector('.name') as HTMLElement).textContent = w.mission.name
  const count = el.querySelector('.count') as HTMLElement
  count.textContent = w.mission.stats.metal ? String(w.mission.stats.metal) : ''
}

export default function WorldMap({ missions, focused, layers, onFocus, overviewSignal }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const ready = useRef(false)
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>())
  const scouts = useRef(new Map<string, Marker>())
  const latest = useRef({ missions, focused, onFocus })
  latest.current = { missions, focused, onFocus }

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      ...OVERVIEW,
      maxPitch: 78,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right')
    map.on('load', () => {
      addMissionLayers(map)
      ready.current = true
      sync(map)
    })
    map.on('click', 'outlines', (e) => {
      const id = e.features?.[0]?.properties?.mission
      if (id) latest.current.onFocus(id)
    })
    mapRef.current = map
    const markerMap = markers.current
    const scoutMap = scouts.current
    return () => {
      ready.current = false
      markerMap.clear()
      scoutMap.clear()
      map.remove()
      mapRef.current = null
    }
  }, [])

  function sync(map: MapLibreMap) {
    if (!ready.current) return
    const { missions: list, focused: focusId } = latest.current
    const data = toGeoJSON(list)
    ;(map.getSource('cells') as GeoJSONSource).setData(data.cells)
    ;(map.getSource('detections') as GeoJSONSource).setData(data.detections)
    ;(map.getSource('outlines') as GeoJSONSource).setData(data.outlines)

    const seen = new Set<string>()
    for (const w of list) {
      const id = w.mission.id
      seen.add(id)
      const [[west], [east, north]] = cellBounds(w.geo, w.cells.map(([x, y]) => ({ x, y })))
      const anchor: [number, number] = [(west + east) / 2, north]
      let entry = markers.current.get(id)
      if (!entry) {
        const el = markerElement(w, () => latest.current.onFocus(id))
        entry = { el, marker: new Marker({ element: el, anchor: 'bottom' }).setLngLat(anchor).addTo(map) }
        markers.current.set(id, entry)
      }
      entry.marker.setLngLat(anchor)
      paintMarker(entry.el, w, id === focusId)

      if (w.mission.status === 'live' && w.current) {
        let scout = scouts.current.get(id)
        if (!scout) {
          const el = document.createElement('span')
          el.className = 'world-scout'
          scout = new Marker({ element: el }).setLngLat(gridToLngLat(w.geo, w.current.x, w.current.y)).addTo(map)
          scouts.current.set(id, scout)
        }
        scout.setLngLat(gridToLngLat(w.geo, w.current.x, w.current.y))
      }
    }
    for (const [id, entry] of markers.current) {
      if (seen.has(id)) continue
      entry.marker.remove()
      markers.current.delete(id)
    }
    for (const [id, scout] of scouts.current) {
      const w = list.find((m) => m.mission.id === id)
      if (w && w.mission.status === 'live') continue
      scout.remove()
      scouts.current.delete(id)
    }
  }

  useEffect(() => {
    if (mapRef.current) sync(mapRef.current)
  })

  // Frame every mission once the first data arrives.
  const framedOnce = useRef(false)
  useEffect(() => {
    const map = mapRef.current
    if (!map || framedOnce.current || missions.length === 0) return
    framedOnce.current = true
    flyToOverview(map, missions)
  }, [missions])

  // Fly to the focused mission, or back to the theatre overview.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const w = focused ? latest.current.missions.find((m) => m.mission.id === focused) : undefined
    if (!w) {
      flyToOverview(map, latest.current.missions)
      return
    }
    const [[west, south], [east, north]] = cellBounds(w.geo, w.cells.map(([x, y]) => ({ x, y })))
    const camera = map.cameraForBounds(new LngLatBounds([west, south], [east, north]), {
      padding: { top: 140, bottom: 140, left: 380, right: 480 },
      bearing: w.geo.heading_deg - 25,
      pitch: 58,
      maxZoom: 18.6,
    })
    if (camera) map.flyTo({ ...camera, pitch: 58, bearing: w.geo.heading_deg - 25, duration: 2800, essential: true })
  }, [focused, overviewSignal])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const satellite = layers.basemap === 'satellite'
      map.setLayoutProperty('satellite', 'visibility', satellite ? 'visible' : 'none')
      map.setLayoutProperty('relief', 'visibility', satellite ? 'none' : 'visible')
      map.setPaintProperty('hillshade', 'hillshade-exaggeration', satellite ? 0.25 : 0.7)
      if (!ready.current) return
      map.setLayoutProperty('hotspots', 'visibility', layers.hotspots ? 'visible' : 'none')
      for (const id of ['cells', 'outlines']) map.setLayoutProperty(id, 'visibility', layers.footprints ? 'visible' : 'none')
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [layers])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} aria-label="Theatre map" role="region" />
}
