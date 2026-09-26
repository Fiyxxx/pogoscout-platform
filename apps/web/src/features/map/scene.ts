import * as THREE from 'three'
import type { Cell, CellsResponse } from '../../api/types'
import { cellKey, isLowConfidence, latestObservation, type Layer } from '../../lib/cells'
import { strongest } from '../../lib/risk'
import { isMaterial, MATERIALS, type Material } from '../../lib/materials'
import { materialTexture, rng } from './textures'

export type ViewMode = '2d' | '3d'
export type HeightMetric = 'none' | 'uncertainty'
export type SceneOptions = { layer: Layer; view: ViewMode; metric: HeightMetric; selected: string | null }

const SIGNAL = 0xff5a1f
const REST_HEIGHT = 0.06
const WATER_HEIGHT = 0.025
const CAPTURE_LIMIT = 400
const DETAIL_BUDGET = 400
const ROUGHNESS: Partial<Record<Material, number>> = {
  soil: 0.95, mud: 0.3, sand: 1, gravel: 0.85, grass_vegetation: 0.9,
  leaf_litter: 0.9, concrete: 0.9, asphalt: 0.95, tiles_pavers: 0.8,
}
const VIEW_ANGLES: Record<ViewMode, { phi: number; theta: number }> = {
  '2d': { phi: 0.02, theta: 0 },
  '3d': { phi: 0.92, theta: -0.6 },
}

type Group = Material | 'pending'
const GROUPS: Group[] = [...MATERIALS, 'pending']

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** Nearest equivalent of `target` to `current`, so the camera turns the short way round. */
const nearAngle = (target: number, current: number) =>
  target + Math.round((current - target) / (Math.PI * 2)) * Math.PI * 2

/** Samples the ground texture in world space, so ground flows across cells instead of tiling per cell. */
function worldMapped<T extends THREE.Material>(material: T, scale: number): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundUv;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 groundWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          groundWorld = instanceMatrix * groundWorld;
        #endif
        groundWorld = modelMatrix * groundWorld;
        vGroundUv = vec2(groundWorld.x, -groundWorld.z) * ${scale.toFixed(3)};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundUv;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor *= texture2D(map, vGroundUv);\n#endif')
  }
  material.customProgramCacheKey = () => `ground-${scale}`
  return material
}

function groupMaterial(group: Group): THREE.Material {
  if (group === 'pending') return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0x2a2a28 })
  const map = materialTexture(group)
  if (group === 'water') {
    const ripple = materialTexture('ripple')
    return new THREE.MeshPhongMaterial({ map, specular: 0x9fb8c6, shininess: 120, bumpMap: ripple, bumpScale: 0.6, transparent: true, opacity: 0.94 })
  }
  return worldMapped(new THREE.MeshStandardMaterial({ map, roughness: ROUGHNESS[group] ?? 0.9, metalness: group === 'mud' ? 0.12 : 0 }), 0.37)
}

type DetailSpec = { n: number; geo: () => THREE.BufferGeometry; colors: number[]; y: number; tilt: number; scale: [number, number] }
const DETAILS: Partial<Record<Material, DetailSpec>> = {
  gravel: { n: 110, geo: () => new THREE.IcosahedronGeometry(0.028, 0), colors: [0x9a9993, 0x77766f, 0xb8b7b0, 0x5f5e59], y: 0.012, tilt: 3, scale: [0.6, 1.5] },
  grass_vegetation: {
    n: 320,
    geo: () => new THREE.ConeGeometry(0.011, 0.11, 3).translate(0, 0.055, 0),
    colors: [0x4f7f33, 0x3f6b2a, 0x6a9a44, 0x5b8a3a], y: 0, tilt: 0.4, scale: [0.6, 1.3],
  },
  leaf_litter: {
    n: 80,
    geo: () => new THREE.CircleGeometry(0.05, 7).rotateX(-Math.PI / 2).scale(1, 1, 0.5),
    colors: [0x8a5a26, 0xa0702e, 0x5e3d1d, 0xb08a3a, 0x6b4a22], y: 0.004, tilt: 0.25, scale: [0.7, 1.4],
  },
  soil: { n: 22, geo: () => new THREE.DodecahedronGeometry(0.022, 0), colors: [0x7a3f25, 0x6e3620, 0x9c5a36], y: 0.008, tilt: 3, scale: [0.6, 1.4] },
}

/** Risk layer colours: extremely high, high, medium, low, not assessed (U), no indication. */
const RISK_COLORS: Record<string, number> = { EH: 0xff3a14, H: 0xff7a2e, M: 0xe0a526, L: 0x4a4a46, U: 0x34353c }
const BASE = new THREE.Color(0x1c1c1b)
const mix = new THREE.Color()

function flatColor(cell: Cell, layer: Layer, risk: string | undefined): number {
  if (layer === 'risk') return risk ? RISK_COLORS[risk] : 0x1c1c1b
  if (layer === 'metal' || layer === 'voc') {
    const sensor = layer === 'metal' ? cell.metal : cell.voc
    if (sensor === 'sensor_error') return 0x5a2410
    if (sensor === 'missing') return 0x121211
    // Graded by signal strength: background stays dark, detections reach full colour.
    const value = strongest(cell, layer) ?? 0
    const t = Math.min(1, Math.max(0, (value - 0.1) / 0.6))
    return mix.copy(BASE).lerp(new THREE.Color(layer === 'metal' ? SIGNAL : 0xd9d9d4), t).getHex()
  }
  switch (cell.quality) {
    case 'complete': return 0x2c3a2f
    case 'low_confidence': return 0x8a6a24
    case 'pending': return 0x1a1a19
    case 'missing': return 0x121211
    case 'failed': return 0x5a2410
    case 'conflicting': return 0x7a2a12
  }
}

function groupOf(cell: Cell): Group {
  const c = cell.material
  return c.status === 'succeeded' && isMaterial(c.label) ? c.label : 'pending'
}

function signatureOf(cell: Cell): string {
  const c = cell.material
  return [c.status, c.label, c.confidence, cell.metal, cell.voc, strongest(cell, 'metal'), strongest(cell, 'voc'), cell.quality, latestObservation(cell)?.image?.sha256 ?? ''].join('|')
}

type CellState = {
  key: string
  cell: Cell
  signature: string
  lastHop: number
  height: number
  target: number
  appear: number
  group: Group
  groupIndex: number
  flatIndex: number
}

/** A resizable batch of box instances drawn in one call. */
class Batch {
  mesh: THREE.InstancedMesh
  keys: string[] = []
  private scene: THREE.Scene
  private geometry: THREE.BufferGeometry
  private material: THREE.Material

  constructor(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, capacity = 64) {
    this.scene = scene
    this.geometry = geometry
    this.material = material
    this.mesh = this.create(capacity)
  }

  private create(capacity: number) {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    mesh.count = 0
    mesh.setColorAt(0, new THREE.Color(0xffffff))
    this.scene.add(mesh)
    return mesh
  }

  /** Assigns keys to instance slots, growing the buffer when needed. */
  assign(keys: string[]) {
    if (keys.length > this.mesh.instanceMatrix.count) {
      const visible = this.mesh.visible
      this.scene.remove(this.mesh)
      this.mesh.dispose()
      this.mesh = this.create(Math.max(64, 2 ** Math.ceil(Math.log2(keys.length))))
      this.mesh.visible = visible
    }
    this.keys = keys
    this.mesh.count = keys.length
  }
}

/**
 * Imperative Three.js scene for one mission. React owns the options; this class owns geometry,
 * animation and disposal. Ground is batched per material so thousands of cells draw in a
 * handful of calls, and cells are updated in place as live data arrives.
 */
export class MissionScene {
  private canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 2000)
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private fog = new THREE.Fog(0x0a0a0a, 18, 44)
  private states = new Map<string, CellState>()
  private boxGeo = new THREE.BoxGeometry(1, 1, 1)
  private batches = new Map<Group, Batch>()
  private flat: Batch
  private details: THREE.InstancedMesh[] = []
  private detailsDirty = false
  private detailsBuiltAt = -1
  private frontier: THREE.LineSegments
  private captures = new Map<string, THREE.Mesh>()
  private captureTextures = new Map<string, THREE.Texture>()
  private loader = new THREE.TextureLoader()
  private beacons = new Map<string, { beam: THREE.Mesh; ring: THREE.Mesh }>()
  private cues = new Map<string, THREE.Mesh>()
  private beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 3, 10)
  private ringGeo = new THREE.RingGeometry(0.3, 0.34, 48)
  private cueGeo = new THREE.OctahedronGeometry(0.16)
  private selBox: THREE.LineSegments
  private marker: THREE.Mesh
  private north: THREE.Mesh
  private sun: THREE.DirectionalLight
  private options: SceneOptions = { layer: 'combined', view: '3d', metric: 'none', selected: null }
  private current = { x: 0, y: 0 }
  private risk = new Map<string, string>()
  private projected = new THREE.Vector3()
  /** Called after every rendered frame, e.g. to move HTML overlays with the camera. */
  onFrame: (() => void) | null = null
  private target = new THREE.Vector3()
  private targetGoal = new THREE.Vector3()
  private autoFrame = true
  private framed = false
  private cam = { phi: VIEW_ANGLES['3d'].phi, theta: VIEW_ANGLES['3d'].theta, r: 16 }
  private camGoal = { ...this.cam }
  private baseRadius = 16
  private zoom = 1
  private matrix = new THREE.Matrix4()
  private raf = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x0a0a0a)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    const scene = this.scene
    scene.fog = this.fog
    scene.add(new THREE.HemisphereLight(0xf4f2ea, 0x0a0a0a, 0.85))
    this.sun = new THREE.DirectionalLight(0xfff6e8, 1.7)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    scene.add(this.sun, this.sun.target)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const grid = new THREE.GridHelper(400, 400, 0x242422, 0x191918)
    grid.position.set(0.5, 0.002, 0.5)
    scene.add(grid)

    for (const group of GROUPS) this.batches.set(group, new Batch(scene, this.boxGeo, groupMaterial(group)))
    this.flat = new Batch(scene, this.boxGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }))

    this.frontier = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x4a4a46, transparent: true, opacity: 0.55 }))
    scene.add(this.frontier)

    const origin = [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]].map(([x, z]) => new THREE.Vector3(x, 0.005, z))
    scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(origin), new THREE.LineBasicMaterial({ color: 0x8a8a86 })))

    this.north = new THREE.Mesh(new THREE.CircleGeometry(0.28, 3), new THREE.MeshBasicMaterial({ color: 0x8a8a86 }))
    this.north.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
    scene.add(this.north)

    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.04, 1, 1.04)), new THREE.LineBasicMaterial({ color: 0xf2f2f0 }))
    this.selBox.visible = false
    scene.add(this.selBox)

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.36, 48),
      new THREE.MeshBasicMaterial({ color: 0xf2f2f0, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    )
    this.marker.rotation.x = -Math.PI / 2
    this.marker.visible = false
    scene.add(this.marker)

    const loop = () => {
      if (this.disposed) return
      // Schedule first: one failed frame (a lost GPU context) must not stop the loop for good.
      this.raf = requestAnimationFrame(loop)
      if (this.renderer.getContext().isContextLost()) return
      this.frame()
    }
    loop()
  }

  resize(width: number, height: number) {
    const zoom = width > 0 ? this.canvas.getBoundingClientRect().width / width : 1
    this.renderer.setPixelRatio(Math.min(3, (window.devicePixelRatio || 1) * (zoom || 1)))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  setOptions(next: SceneOptions) {
    const viewChanged = next.view !== this.options.view
    const colorsChanged = next.layer !== this.options.layer
    this.options = next
    for (const s of this.states.values()) s.target = this.targetHeight(s.cell)
    if (colorsChanged) this.paintFlat()
    this.applyVisibility()
    const angles = VIEW_ANGLES[next.view]
    this.camGoal.phi = angles.phi
    if (viewChanged) this.camGoal.theta = nearAngle(angles.theta, this.cam.theta)
  }

  update(data: CellsResponse) {
    let regroup = false
    const seen = new Set<string>()
    for (const cell of data.cells) {
      const key = cellKey(cell)
      seen.add(key)
      const lastHop = cell.hop_ids[cell.hop_ids.length - 1] ?? 0
      const existing = this.states.get(key)
      if (!existing) {
        this.states.set(key, { key, cell, signature: signatureOf(cell), lastHop, height: 0, target: this.targetHeight(cell), appear: 0, group: groupOf(cell), groupIndex: -1, flatIndex: -1 })
        regroup = true
      } else {
        existing.cell = cell
        existing.lastHop = lastHop
        existing.target = this.targetHeight(cell)
        const signature = signatureOf(cell)
        if (signature !== existing.signature) {
          existing.signature = signature
          existing.group = groupOf(cell)
          regroup = true
        }
      }
    }
    for (const key of [...this.states.keys()]) {
      if (!seen.has(key)) {
        this.states.delete(key)
        regroup = true
      }
    }
    if (regroup) {
      this.regroup()
      this.rebuildFrontier()
      this.syncMarkers()
      this.detailsDirty = true
    }
    this.current = data.current
    this.frameBounds(data)
  }

  /** Risk level per cell key (EH, H, M, L, or U for not assessed) for the risk layer. */
  setRisk(levels: Map<string, string>) {
    this.risk = levels
    if (this.options.layer === 'risk') this.paintFlat()
  }

  /** Where a grid point sits on screen, in CSS pixels from the canvas top left. */
  project(x: number, y: number): { left: number; top: number; visible: boolean } {
    const s = this.states.get(cellKey({ x: Math.round(x), y: Math.round(y) }))
    const h = s ? s.height * s.appear : REST_HEIGHT
    const v = this.projected.set(x, h + 0.02, -y).project(this.camera)
    const w = this.canvas.clientWidth
    const hgt = this.canvas.clientHeight
    return { left: ((v.x + 1) / 2) * w, top: ((1 - v.y) / 2) * hgt, visible: v.z < 1 && Math.abs(v.x) <= 1.05 && Math.abs(v.y) <= 1.05 }
  }

  /** Returns the key of the cell under a viewport point, if any. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(v, this.camera)
    const batches = this.texturedLayer() ? [...this.batches.values()] : [this.flat]
    const hit = this.raycaster.intersectObjects(batches.map((b) => b.mesh), false)[0]
    if (!hit || hit.instanceId === undefined) return null
    const batch = batches.find((b) => b.mesh === hit.object)
    return batch?.keys[hit.instanceId] ?? null
  }

  orbit(dx: number, dy: number) {
    if (this.options.view !== '3d') return
    this.camGoal.theta -= dx * 0.006
    this.camGoal.phi = Math.min(1.35, Math.max(0.25, this.camGoal.phi - dy * 0.005))
  }

  /** Slides the view across the ground, in screen directions. */
  pan(dx: number, dy: number) {
    const k = this.cam.r * 0.0016
    const theta = this.cam.theta
    const right = new THREE.Vector3(Math.cos(theta), 0, -Math.sin(theta))
    const forward = new THREE.Vector3(-Math.sin(theta), 0, -Math.cos(theta))
    this.targetGoal.addScaledVector(right, -dx * k).addScaledVector(forward, dy * k)
    this.autoFrame = false
  }

  zoomBy(deltaY: number) {
    this.zoom = Math.min(4, Math.max(0.06, this.zoom * Math.exp(deltaY * 0.001)))
  }

  /** Flies the camera to a cell and moves in close. */
  focus(key: string) {
    const s = this.states.get(key)
    if (!s) return
    this.targetGoal.set(s.cell.x, 0, -s.cell.y)
    this.zoom = Math.min(this.zoom, Math.max(0.06, 14 / this.baseRadius))
    this.autoFrame = false
  }

  recenter() {
    const angles = VIEW_ANGLES[this.options.view]
    this.zoom = 1
    this.autoFrame = true
    this.camGoal.phi = angles.phi
    this.camGoal.theta = nearAngle(angles.theta, this.cam.theta)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    for (const t of this.captureTextures.values()) t.dispose()
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.renderer.dispose()
    // Release the GPU context now: browsers cap live contexts and drop new ones past the limit.
    this.renderer.forceContextLoss()
  }

  private texturedLayer() {
    const l = this.options.layer
    return l === 'combined' || l === 'material' || l === 'captures'
  }

  private targetHeight(cell: Cell): number {
    const { view, metric } = this.options
    const c = cell.material
    const succeeded = c.status === 'succeeded' && c.confidence != null
    if (view === '2d' || metric === 'none') return succeeded && c.label === 'water' ? WATER_HEIGHT : REST_HEIGHT
    return 0.1 + (succeeded ? 1 - (c.confidence ?? 0) : 0.3) * 3.2
  }

  private regroup() {
    const members = new Map<Group, string[]>(GROUPS.map((g) => [g, []]))
    const all: string[] = []
    for (const s of this.states.values()) {
      const list = members.get(s.group)!
      s.groupIndex = list.length
      list.push(s.key)
      s.flatIndex = all.length
      all.push(s.key)
    }
    const color = new THREE.Color()
    for (const [group, keys] of members) {
      const batch = this.batches.get(group)!
      batch.assign(keys)
      keys.forEach((key, i) => {
        const low = isLowConfidence(this.states.get(key)!.cell.material)
        batch.mesh.setColorAt(i, color.setHex(low ? 0x8f8f8a : 0xffffff))
      })
      if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true
    }
    this.flat.assign(all)
    this.paintFlat()
    this.applyVisibility()
  }

  private paintFlat() {
    const color = new THREE.Color()
    this.flat.keys.forEach((key, i) => this.flat.mesh.setColorAt(i, color.setHex(flatColor(this.states.get(key)!.cell, this.options.layer, this.risk.get(key)))))
    if (this.flat.mesh.instanceColor) this.flat.mesh.instanceColor.needsUpdate = true
  }

  private applyVisibility() {
    const textured = this.texturedLayer()
    for (const b of this.batches.values()) b.mesh.visible = textured
    this.flat.mesh.visible = !textured
    const detailsOn = textured && this.options.layer !== 'captures' && (this.options.view === '2d' || this.options.metric === 'none')
    for (const d of this.details) d.visible = detailsOn
    if (this.options.layer === 'captures') this.syncCaptures()
    for (const m of this.captures.values()) m.visible = this.options.layer === 'captures'
  }

  private syncMarkers() {
    for (const s of this.states.values()) {
      if (s.cell.metal === 'detected' && !this.beacons.has(s.key)) {
        const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true }))
        const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, side: THREE.DoubleSide }))
        ring.rotation.x = -Math.PI / 2
        this.scene.add(beam, ring)
        this.beacons.set(s.key, { beam, ring })
      }
      if (s.cell.voc === 'detected' && !this.cues.has(s.key)) {
        const cue = new THREE.Mesh(this.cueGeo, new THREE.MeshBasicMaterial({ color: 0xf2f2f0 }))
        this.scene.add(cue)
        this.cues.set(s.key, cue)
      }
    }
    for (const [key, b] of this.beacons) {
      if (this.states.get(key)?.cell.metal !== 'detected') {
        this.scene.remove(b.beam, b.ring)
        this.beacons.delete(key)
      }
    }
    for (const [key, cue] of this.cues) {
      if (this.states.get(key)?.cell.voc !== 'detected') {
        this.scene.remove(cue)
        this.cues.delete(key)
      }
    }
  }

  /** Capture tiles for the most recently visited cells; beyond the budget cells keep their material. */
  private syncCaptures() {
    const recent = [...this.states.values()]
      .filter((s) => latestObservation(s.cell)?.image)
      .sort((a, b) => b.lastHop - a.lastHop)
      .slice(0, CAPTURE_LIMIT)
    const wanted = new Set(recent.map((s) => s.key))
    for (const [key, mesh] of this.captures) {
      if (!wanted.has(key)) {
        this.scene.remove(mesh)
        ;(mesh.material as THREE.Material).dispose()
        mesh.geometry.dispose()
        this.captureTextures.get(key)?.dispose()
        this.captureTextures.delete(key)
        this.captures.delete(key)
      }
    }
    for (const s of recent) {
      if (this.captures.has(s.key)) continue
      const url = latestObservation(s.cell)!.image!.url
      const material = new THREE.MeshBasicMaterial({ color: 0x1a1a19 })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), material)
      mesh.rotation.x = -Math.PI / 2
      this.scene.add(mesh)
      this.captures.set(s.key, mesh)
      this.loader.load(url, (texture) => {
        if (!this.captures.has(s.key)) return texture.dispose()
        texture.colorSpace = THREE.SRGBColorSpace
        // Square crop from the lower part of the frame, where the landing area is.
        texture.repeat.set(0.54, 0.72)
        texture.offset.set(0.23, 0)
        material.map = texture
        material.color.setHex(0xffffff)
        material.needsUpdate = true
        this.captureTextures.set(s.key, texture)
      })
    }
  }

  private rebuildDetails() {
    for (const d of this.details) {
      this.scene.remove(d)
      d.geometry.dispose()
      ;(d.material as THREE.Material).dispose()
    }
    this.details = []
    const factor = Math.min(1, Math.max(0.1, DETAIL_BUDGET / Math.max(1, this.states.size)))
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    for (const [label, spec] of Object.entries(DETAILS) as [Material, DetailSpec][]) {
      const cells = [...this.states.values()].filter((s) => s.group === label)
      if (!cells.length) continue
      const perCell = cells.map((s) => Math.round(spec.n * factor * (isLowConfidence(s.cell.material) ? 0.35 : 1)))
      const total = perCell.reduce((a, b) => a + b, 0)
      if (!total) continue
      const mesh = new THREE.InstancedMesh(spec.geo(), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), total)
      let i = 0
      cells.forEach((s, ci) => {
        const r = rng(s.cell.x * 7919 + s.cell.y * 104729)
        for (let k = 0; k < perCell[ci]; k++, i++) {
          dummy.position.set(s.cell.x + (r() - 0.5) * 0.94, REST_HEIGHT + spec.y, -s.cell.y + (r() - 0.5) * 0.94)
          dummy.rotation.set((r() - 0.5) * spec.tilt, r() * Math.PI * 2, (r() - 0.5) * spec.tilt)
          dummy.scale.setScalar(spec.scale[0] + r() * (spec.scale[1] - spec.scale[0]))
          dummy.updateMatrix()
          mesh.setMatrixAt(i, dummy.matrix)
          mesh.setColorAt(i, color.setHex(spec.colors[Math.floor(r() * spec.colors.length)]))
        }
      })
      mesh.castShadow = cells.length < 800
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.details.push(mesh)
    }
    this.applyVisibility()
  }

  private rebuildFrontier() {
    const points: number[] = []
    const done = new Set<string>()
    for (const s of this.states.values()) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = s.cell.x + dx
        const y = s.cell.y + dy
        const key = `${x},${y}`
        if (this.states.has(key) || done.has(key) || (x === 0 && y === 0)) continue
        done.add(key)
        const c = [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]].map(([px, pz]) => [x + px, 0.004, -y + pz])
        for (let i = 0; i < 4; i++) points.push(...c[i], ...c[(i + 1) % 4])
      }
    }
    this.frontier.geometry.dispose()
    this.frontier.geometry = new THREE.BufferGeometry()
    this.frontier.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  }

  private frameBounds(data: CellsResponse) {
    const { min_x, max_x, min_y, max_y } = data.bounds
    const cx = (min_x + max_x) / 2
    const cy = (min_y + max_y) / 2
    const span = Math.max(max_x - min_x + 1, max_y - min_y + 1, 4)
    this.baseRadius = 5 + span * 1.45
    if (this.autoFrame) {
      this.targetGoal.set(cx, 0, -cy)
      if (!this.framed) this.target.copy(this.targetGoal)
      this.framed = true
    }
    this.north.position.set(cx, 0.005, -(max_y + 1.6))
    const half = span / 2 + 4
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: span * 3 + 40 })
    this.sun.shadow.camera.updateProjectionMatrix()
    this.sun.position.set(cx + span * 0.35 + 5, span * 0.8 + 11, -cy + span * 0.4 + 6)
    this.sun.target.position.set(cx, 0, -cy)
  }

  private frame() {
    const t = this.clock.getElapsedTime()
    const { layer, selected } = this.options
    const showMetal = layer === 'combined' || layer === 'metal' || layer === 'captures'
    const showVoc = layer === 'combined' || layer === 'voc' || layer === 'captures'

    if (this.detailsDirty && t - this.detailsBuiltAt > 0.6) {
      this.detailsDirty = false
      this.detailsBuiltAt = t
      this.rebuildDetails()
    }

    for (const s of this.states.values()) {
      s.height = lerp(s.height, s.target, 0.08)
      s.appear = lerp(s.appear, 1, 0.12)
      const h = Math.max(0.001, s.height * s.appear)
      this.matrix.makeScale(1, h, 1).setPosition(s.cell.x, h / 2, -s.cell.y)
      const batch = this.batches.get(s.group)!
      if (s.groupIndex >= 0 && s.groupIndex < batch.mesh.count) batch.mesh.setMatrixAt(s.groupIndex, this.matrix)
      if (s.flatIndex >= 0 && s.flatIndex < this.flat.mesh.count) this.flat.mesh.setMatrixAt(s.flatIndex, this.matrix)
      const capture = this.captures.get(s.key)
      if (capture) capture.position.set(s.cell.x, h + 0.003, -s.cell.y)
    }
    for (const b of this.batches.values()) b.mesh.instanceMatrix.needsUpdate = true
    this.flat.mesh.instanceMatrix.needsUpdate = true
    const pending = this.batches.get('pending')!.mesh.material as THREE.MeshStandardMaterial
    pending.emissiveIntensity = 0.5 + 0.5 * Math.sin(t * 3)

    for (const [key, b] of this.beacons) {
      const s = this.states.get(key)
      if (!s) continue
      const h = s.height * s.appear
      const p = (t * 0.7 + s.cell.x * 0.37 + s.cell.y * 0.11) % 1
      b.beam.visible = b.ring.visible = showMetal
      b.beam.position.set(s.cell.x, h + 1.5 * s.appear, -s.cell.y)
      b.beam.scale.y = s.appear
      ;(b.beam.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2 + s.cell.x)
      b.ring.position.set(s.cell.x, h + 0.02, -s.cell.y)
      b.ring.scale.setScalar(1 + p * 1.6)
      ;(b.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9
    }
    for (const [key, cue] of this.cues) {
      const s = this.states.get(key)
      if (!s) continue
      cue.visible = showVoc
      cue.position.set(s.cell.x, s.height * s.appear + 0.75 + Math.sin(t * 2) * 0.08, -s.cell.y)
      cue.rotation.y = t * 1.2
      cue.scale.setScalar(s.appear)
    }

    const current = this.states.get(cellKey(this.current))
    this.marker.visible = !!current
    if (current) {
      this.marker.position.set(current.cell.x, current.height * current.appear + 0.03, -current.cell.y)
      ;(this.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2.4)
    }
    const sel = selected ? this.states.get(selected) : undefined
    this.selBox.visible = !!sel
    if (sel) {
      const h = Math.max(REST_HEIGHT, sel.height * sel.appear) + 0.04
      this.selBox.scale.y = h
      this.selBox.position.set(sel.cell.x, h / 2, -sel.cell.y)
    }
    materialTexture('ripple').offset.set(t * 0.03, t * 0.021)

    const c = this.cam
    const g = this.camGoal
    g.r = this.baseRadius * this.zoom * (this.options.view === '2d' ? 1.3 : 1)
    c.phi = lerp(c.phi, g.phi, 0.06)
    c.theta = lerp(c.theta, g.theta, 0.06)
    c.r = lerp(c.r, g.r, 0.08)
    this.target.lerp(this.targetGoal, 0.08)
    this.fog.near = c.r * 0.9
    this.fog.far = c.r * 2.6
    const tg = this.target
    this.camera.position.set(tg.x + c.r * Math.sin(c.phi) * Math.sin(c.theta), c.r * Math.cos(c.phi), tg.z + c.r * Math.sin(c.phi) * Math.cos(c.theta))
    this.camera.lookAt(tg)
    this.renderer.render(this.scene, this.camera)
    this.onFrame?.()
  }
}
