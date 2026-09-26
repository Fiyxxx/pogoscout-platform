import 'maplibre-gl/dist/maplibre-gl.css'
import { AttributionControl, type GeoJSONSource, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, ScaleControl, setWorkerUrl, type StyleSpecification } from 'maplibre-gl'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef } from 'react'
import type { WorldArea, WorldMission } from '../../api/types'
import { cellBounds, cellRing, gridToLngLat } from '../../lib/geo'
import { isMaterial, MATERIAL_COLORS } from '../../lib/materials'
import { LEVEL_NAMES, probText, VERDICT_NAMES } from '../../lib/risk'

export type HeatLayer = 'risk' | 'metal' | 'voc' | 'off'
export type WorldLayers = { heat: HeatLayer; areas: boolean; footprints: boolean }

type Props = {
  missions: WorldMission[]
  focused: string | null
  layers: WorldLayers
  onFocus: (id: string | null) => void
  onOpenMission: (id: string) => void
  overviewSignal: number
}

// Let Vite bundle MapLibre's module worker; its default lookup fails under the dev bundler.
setWorkerUrl(maplibreWorkerUrl)

const TERRAIN_EXAGGERATION = 1.5
const OVERVIEW = { center: [103.81, 1.318] as [number, number], zoom: 11.15, pitch: 50, bearing: -12 }
const SIGNAL = '#ff5a1f'
// Area markers appear once the map is close enough to tell them apart.
const AREA_MIN_ZOOM = 13.2

/** Absolute URL: MapLibre resolves tile templates in a worker, where relative paths do not work. */
function tileUrl(layer: 'imagery' | 'labels' | 'terrain'): string {
  return `${window.location.origin}/api/v1/tiles/${layer}/{z}/{x}/{y}`
}

const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    // Served by the platform's tile cache (see apps/api tiles/), which fetches upstream once.
    labels: { type: 'raster', tiles: [tileUrl('labels')], tileSize: 256, maxzoom: 19 },
    satellite: {
      type: 'raster',
      tiles: [tileUrl('imagery')],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    terrainDem: {
      type: 'raster-dem',
      tiles: [tileUrl('terrain')],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Elevation © Mapzen, AWS Terrain Tiles',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#0a0a0a' } },
    {
      id: 'satellite', type: 'raster', source: 'satellite',
      paint: { 'raster-saturation': -0.55, 'raster-brightness-max': 0.62, 'raster-contrast': 0.08 },
    },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.8 } },
  ],
  terrain: { source: 'terrainDem', exaggeration: TERRAIN_EXAGGERATION },
  sky: { 'sky-color': '#0a0a0a', 'horizon-color': '#1a1a19', 'fog-color': '#0a0a0a', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.7 },
}

function toGeoJSON(missions: WorldMission[]) {
  const cells: Feature[] = []
  const detections: Feature[] = []
  const outlines: Feature[] = []
  for (const w of missions) {
    for (const [x, y, label, metal, voc, risk] of w.cells) {
      cells.push({
        type: 'Feature',
        properties: { mission: w.mission.id, color: isMaterial(label) ? MATERIAL_COLORS[label] : '#2a2a28' },
        geometry: { type: 'Polygon', coordinates: [cellRing(w.geo, x, y)] },
      })
      const point = { type: 'Point' as const, coordinates: gridToLngLat(w.geo, x, y) }
      // Background readings (below 0.30) add no heat; stronger signals weigh by their strength.
      if (metal >= 0.3) detections.push({ type: 'Feature', properties: { kind: 'metal', weight: metal, hit: metal >= 0.5 }, geometry: point })
      if (voc >= 0.3) detections.push({ type: 'Feature', properties: { kind: 'voc', weight: voc, hit: voc >= 0.5 }, geometry: point })
      // Risk heat is the posterior probability of a hazard (half for an activity cue), so the
      // glow follows the evidence itself; not-assessed cells (-1) add none.
      if (risk > 0) detections.push({ type: 'Feature', properties: { kind: 'risk', weight: risk }, geometry: point })
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

const GROUPS = ['done', 'live'] as const
type GroupName = (typeof GROUPS)[number]
type LayerKind = 'cells' | 'outlines' | 'heat-risk' | 'heat-metal' | 'heat-voc' | 'metal' | 'voc'
const layerIds = (kind: LayerKind) => GROUPS.map((g) => `${g}-${kind}`)

const HEAT_COLORS: Record<Exclude<HeatLayer, 'off'>, unknown[]> = {
  risk: [0, 'rgba(255,196,0,0)', 0.12, 'rgba(255,196,0,0.28)', 0.35, 'rgba(255,140,20,0.55)', 0.65, 'rgba(255,90,31,0.82)', 0.9, '#ff3a14', 1, '#ffe0d2'],
  metal: [0, 'rgba(255,90,31,0)', 0.15, 'rgba(255,90,31,0.22)', 0.45, 'rgba(255,90,31,0.55)', 0.75, 'rgba(255,90,31,0.85)', 1, '#ffd2bd'],
  voc: [0, 'rgba(160,200,255,0)', 0.15, 'rgba(160,200,255,0.2)', 0.45, 'rgba(190,215,255,0.5)', 0.75, 'rgba(225,235,255,0.8)', 1, '#ffffff'],
}

/** Cheap change signature: cell counts, hops, detections and risk per mission. */
function signature(missions: WorldMission[]): string {
  return missions
    .map((w) => {
      const s = w.mission.stats
      const classified = Object.values(s.materials).reduce((a, b) => a + b, 0)
      const areas = w.risk.areas.map((a) => `${a.id}${a.level}${a.size}`).join('')
      return `${w.mission.id}:${w.cells.length}:${s.hops}:${s.metal}:${s.voc}:${classified}:${w.risk.verdict}:${areas}`
    })
    .join('|')
}

function addMissionLayers(map: MapLibreMap) {
  const empty: FeatureCollection = { type: 'FeatureCollection', features: [] }
  for (const g of GROUPS) {
    map.addSource(`${g}-cells`, { type: 'geojson', data: empty, buffer: 16, tolerance: 0.5 })
    map.addSource(`${g}-detections`, { type: 'geojson', data: empty })
    map.addSource(`${g}-outlines`, { type: 'geojson', data: empty })
  }
  for (const g of GROUPS) {
    map.addLayer({
      id: `${g}-cells`, type: 'fill', source: `${g}-cells`, minzoom: 14,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.6, 17.5, 0.92] },
    })
    map.addLayer({
      id: `${g}-outlines`, type: 'line', source: `${g}-outlines`, minzoom: 13,
      paint: { 'line-color': '#f2f2f0', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.5], 'line-width': 1, 'line-dasharray': [3, 3] },
    })
  }
  for (const g of GROUPS) {
    for (const kind of ['risk', 'metal', 'voc'] as const) {
      map.addLayer({
        id: `${g}-heat-${kind}`, type: 'heatmap', source: `${g}-detections`, filter: ['==', ['get', 'kind'], kind],
        layout: { visibility: kind === 'risk' ? 'visible' : 'none' },
        paint: {
          'heatmap-weight': ['get', 'weight'],
          // Broad glow for the overview, tight spots up close so the heat never smears across a
          // whole mission: at mission zoom the hazard areas and cells carry the detail.
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 13, 1.2, 16, 0.55, 18, 0.35],
          'heatmap-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 9, 12, 13, 22, 16, 30, 18, 56],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...HEAT_COLORS[kind]] as never,
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0.85, 17.5, 0.55],
        },
      })
    }
    map.addLayer({
      id: `${g}-metal`, type: 'circle', source: `${g}-detections`, minzoom: 15.5, layout: { visibility: 'none' }, filter: ['all', ['==', ['get', 'kind'], 'metal'], ['get', 'hit']],
      paint: { 'circle-color': SIGNAL, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 2.5, 18, 6], 'circle-stroke-color': '#0a0a0a', 'circle-stroke-width': 1 },
    })
    map.addLayer({
      id: `${g}-voc`, type: 'circle', source: `${g}-detections`, minzoom: 15.5, layout: { visibility: 'none' }, filter: ['all', ['==', ['get', 'kind'], 'voc'], ['get', 'hit']],
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15.5, 3, 18, 7], 'circle-stroke-color': '#f2f2f0', 'circle-stroke-width': 1.5 },
    })
  }
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
  count.textContent = VERDICT_NAMES[w.risk.verdict]
  count.dataset.verdict = w.risk.verdict
}

/** A pulsing hotspot for a hazard area: hover previews it, a click pins the full card. */
function areaElement(): HTMLElement {
  const el = document.createElement('button')
  el.className = 'area-marker'
  el.innerHTML = '<span class="ring"></span><span class="core"></span>'
  return el
}

function paintArea(el: HTMLElement, a: WorldArea) {
  el.dataset.level = a.level
  el.dataset.kind = a.kind
  el.setAttribute('aria-label', `${a.label}, ${LEVEL_NAMES[a.level]} risk`)
}

/** The area card. Built with textContent: no markup from data. */
function areaCard(w: WorldMission, a: WorldArea, pinned: boolean, onOpen: () => void, onClose: () => void): HTMLElement {
  const card = document.createElement('div')
  card.className = 'area-card'
  card.dataset.level = a.level
  const add = (parent: HTMLElement, tag: string, cls: string, text?: string) => {
    const node = document.createElement(tag)
    if (cls) node.className = cls
    if (text !== undefined) node.textContent = text
    parent.appendChild(node)
    return node
  }
  const head = add(card, 'div', 'area-card-head')
  add(head, 'span', 'area-card-level', `${LEVEL_NAMES[a.level]} risk`)
  add(head, 'span', 'area-card-id', `${w.mission.id} ${a.id}`)
  add(card, 'div', 'area-card-title', a.label)
  add(card, 'div', 'area-card-p', `P ${probText(a.p)} ${a.kind === 'explosive' ? 'of a hazard' : 'of recent activity'}`)
  if (!pinned) {
    add(card, 'div', 'area-card-hint', 'Click for details')
    return card
  }
  add(card, 'div', 'area-card-key', 'Evidence')
  const list = add(card, 'ul', 'area-card-why')
  for (const r of a.reasons) add(list, 'li', '', r)
  add(card, 'div', 'area-card-key', 'Action')
  add(card, 'div', 'area-card-action', a.action)
  const foot = add(card, 'div', 'area-card-foot')
  const open = add(foot, 'button', 'btn btn-sm', 'Open mission') as HTMLButtonElement
  open.addEventListener('click', onOpen)
  const close = add(foot, 'button', 'btn btn-sm', 'Close') as HTMLButtonElement
  close.addEventListener('click', onClose)
  return card
}

export default function WorldMap({ missions, focused, layers, onFocus, onOpenMission, overviewSignal }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const ready = useRef(false)
  const markers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>())
  const scouts = useRef(new Map<string, Marker>())
  const areaMarkers = useRef(new Map<string, { marker: Marker; el: HTMLElement }>())
  const card = useRef<{ key: string; pinned: boolean; marker: Marker } | null>(null)
  const sent = useRef<Record<GroupName, string | null>>({ done: null, live: null })
  const latest = useRef({ missions, focused, onFocus, onOpenMission, layers })
  latest.current = { missions, focused, onFocus, onOpenMission, layers }

  useEffect(() => {
    const map = new MapLibreMap({
      container: container.current!,
      style: STYLE,
      ...OVERVIEW,
      maxPitch: 78,
      fadeDuration: 120,
      maxTileCacheSize: 2048,
      refreshExpiredTiles: false,
      attributionControl: false,
      canvasContextAttributes: { antialias: true },
    })
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-left')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => {
      addMissionLayers(map)
      ready.current = true
      sync(map)
    })
    for (const id of layerIds('outlines')) {
      map.on('click', id, (e) => {
        const mission = e.features?.[0]?.properties?.mission
        if (mission) latest.current.onFocus(mission)
      })
    }
    map.on('zoom', () => showAreas(map))
    map.on('click', () => closeCard(false))
    mapRef.current = map
    const markerMap = markers.current
    const scoutMap = scouts.current
    const areaMap = areaMarkers.current
    const sentGroups = sent.current
    return () => {
      sentGroups.done = null
      sentGroups.live = null
      ready.current = false
      markerMap.clear()
      scoutMap.clear()
      areaMap.clear()
      card.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  function sync(map: MapLibreMap) {
    if (!ready.current) return
    const { missions: list, focused: focusId } = latest.current
    // Finished missions are sent once; the live group only when its data actually changed.
    for (const g of GROUPS) {
      const group = list.filter((w) => (w.mission.status === 'live') === (g === 'live'))
      const sig = signature(group)
      if (sent.current[g] === sig) continue
      sent.current[g] = sig
      const data = toGeoJSON(group)
      ;(map.getSource(`${g}-cells`) as GeoJSONSource).setData(data.cells)
      ;(map.getSource(`${g}-detections`) as GeoJSONSource).setData(data.detections)
      ;(map.getSource(`${g}-outlines`) as GeoJSONSource).setData(data.outlines)
    }

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

    const areasSeen = new Set<string>()
    for (const w of list) {
      for (const a of w.risk.areas) {
        const key = `${w.mission.id}/${a.id}`
        areasSeen.add(key)
        let entry = areaMarkers.current.get(key)
        if (!entry) {
          const el = areaElement()
          el.addEventListener('mouseenter', () => openCard(map, key, false))
          el.addEventListener('mouseleave', () => closeCard(true))
          el.addEventListener('click', (e) => {
            e.stopPropagation()
            openCard(map, key, true)
          })
          entry = { el, marker: new Marker({ element: el }).setLngLat(gridToLngLat(w.geo, a.centroid[0], a.centroid[1])).addTo(map) }
          areaMarkers.current.set(key, entry)
        }
        entry.marker.setLngLat(gridToLngLat(w.geo, a.centroid[0], a.centroid[1]))
        paintArea(entry.el, a)
      }
    }
    for (const [key, entry] of areaMarkers.current) {
      if (areasSeen.has(key)) continue
      entry.marker.remove()
      areaMarkers.current.delete(key)
      if (card.current?.key === key) closeCard(false)
    }
    showAreas(map)
  }

  function findArea(key: string): [WorldMission, WorldArea] | null {
    const [missionId, areaId] = key.split('/')
    const w = latest.current.missions.find((m) => m.mission.id === missionId)
    const a = w?.risk.areas.find((x) => x.id === areaId)
    return w && a ? [w, a] : null
  }

  function openCard(map: MapLibreMap, key: string, pinned: boolean) {
    // Hover never replaces a pinned card; a click always wins.
    if (!pinned && card.current?.pinned) return
    const found = findArea(key)
    if (!found) return
    const [w, a] = found
    card.current?.marker.remove()
    const el = areaCard(w, a, pinned, () => latest.current.onOpenMission(w.mission.id), () => closeCard(false))
    el.addEventListener('click', (e) => e.stopPropagation())
    const marker = new Marker({ element: el, anchor: 'bottom', offset: [0, -16] }).setLngLat(gridToLngLat(w.geo, a.centroid[0], a.centroid[1])).addTo(map)
    card.current = { key, pinned, marker }
    for (const [k, entry] of areaMarkers.current) entry.el.dataset.active = String(pinned && k === key)
  }

  function closeCard(hoverOnly: boolean) {
    if (!card.current || (hoverOnly && card.current.pinned)) return
    card.current.marker.remove()
    card.current = null
    for (const entry of areaMarkers.current.values()) entry.el.dataset.active = 'false'
  }

  function showAreas(map: MapLibreMap) {
    const visible = latest.current.layers.areas && map.getZoom() >= AREA_MIN_ZOOM
    for (const entry of areaMarkers.current.values()) entry.el.style.display = visible ? '' : 'none'
    if (!visible) closeCard(false)
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
      if (!ready.current) return
      for (const kind of ['risk', 'metal', 'voc'] as const)
        for (const id of layerIds(`heat-${kind}`)) map.setLayoutProperty(id, 'visibility', layers.heat === kind ? 'visible' : 'none')
      // Individual detections only on their own heat map; the risk view shows hazard areas instead.
      for (const kind of ['metal', 'voc'] as const)
        for (const id of layerIds(kind)) map.setLayoutProperty(id, 'visibility', layers.heat === kind ? 'visible' : 'none')
      for (const id of [...layerIds('cells'), ...layerIds('outlines')]) map.setLayoutProperty(id, 'visibility', layers.footprints ? 'visible' : 'none')
      showAreas(map)
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [layers])

  return <div ref={container} style={{ position: 'absolute', inset: 0 }} aria-label="Theatre map" role="region" />
}
