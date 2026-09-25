import * as THREE from 'three'
import type { Cell, CellsResponse } from '../../api/types'
import { cellKey, isLowConfidence, latestObservation, type Layer } from '../../lib/cells'
import { isMaterial, type Material } from '../../lib/materials'
import { materialTexture, rng } from './textures'

export type ViewMode = '2d' | '3d'
export type HeightMetric = 'none' | 'uncertainty'
export type SceneOptions = { layer: Layer; view: ViewMode; metric: HeightMetric; selected: string | null }

const SIGNAL = 0xff5a1f
const REST_HEIGHT = 0.06
const WATER_HEIGHT = 0.025
const ROUGHNESS: Partial<Record<Material, number>> = {
  soil: 0.95, mud: 0.3, sand: 1, gravel: 0.85, grass_vegetation: 0.9,
  leaf_litter: 0.9, concrete: 0.9, asphalt: 0.95, tiles_pavers: 0.8,
}
const VIEW_ANGLES: Record<ViewMode, { phi: number; theta: number }> = {
  '2d': { phi: 0.02, theta: 0 },
  '3d': { phi: 0.92, theta: -0.6 },
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
/** Nearest equivalent of `target` to `current`, so the camera turns the short way round. */
const nearAngle = (target: number, current: number) =>
  target + Math.round((current - target) / (Math.PI * 2)) * Math.PI * 2

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

function buildDetails(kind: Material, density: number, seed: number): THREE.InstancedMesh | null {
  const spec = DETAILS[kind]
  if (!spec || density <= 0) return null
  const n = Math.round(spec.n * density)
  const r = rng(seed)
  const mesh = new THREE.InstancedMesh(spec.geo(), new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide }), n)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (let i = 0; i < n; i++) {
    dummy.position.set((r() - 0.5) * 0.94, spec.y + i * 0.00002, (r() - 0.5) * 0.94)
    dummy.rotation.set((r() - 0.5) * spec.tilt, r() * Math.PI * 2, (r() - 0.5) * spec.tilt)
    dummy.scale.setScalar(spec.scale[0] + r() * (spec.scale[1] - spec.scale[0]))
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    mesh.setColorAt(i, color.setHex(spec.colors[Math.floor(r() * spec.colors.length)]))
  }
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function flatColor(cell: Cell, layer: Layer): number {
  const sensor = layer === 'metal' ? cell.metal : cell.voc
  if (layer === 'metal' || layer === 'voc') {
    if (sensor === 'detected') return layer === 'metal' ? SIGNAL : 0xd9d9d4
    if (sensor === 'sensor_error') return 0x5a2410
    if (sensor === 'missing') return 0x121211
    return 0x1c1c1b
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

type CellView = {
  cell: Cell
  signature: string
  mesh: THREE.Mesh
  texMat: THREE.Material
  flatMat: THREE.MeshStandardMaterial
  details: THREE.InstancedMesh | null
  capture: THREE.Mesh
  captureUrl: string | null
  height: number
  target: number
  appear: number
  beacon: { beam: THREE.Mesh; ring: THREE.Mesh } | null
  cue: THREE.Mesh | null
}

/**
 * Imperative Three.js scene for one mission. React owns the options; this class owns geometry,
 * animation and disposal. Cells are updated in place as live data arrives, and new cells grow in.
 */
export class MissionScene {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 300)
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private views = new Map<string, CellView>()
  private frontier = new THREE.Group()
  private selBox: THREE.LineSegments
  private marker: THREE.Mesh
  private north: THREE.Mesh
  private sun: THREE.DirectionalLight
  private ripple = materialTexture('ripple').clone()
  private loader = new THREE.TextureLoader()
  private boxGeo = new THREE.BoxGeometry(1, 1, 1)
  private beamGeo = new THREE.CylinderGeometry(0.035, 0.035, 3, 10)
  private ringGeo = new THREE.RingGeometry(0.3, 0.34, 48)
  private cueGeo = new THREE.OctahedronGeometry(0.16)
  private options: SceneOptions = { layer: 'combined', view: '3d', metric: 'none', selected: null }
  private current = { x: 0, y: 0 }
  private target = new THREE.Vector3()
  private targetGoal = new THREE.Vector3()
  private cam = { phi: VIEW_ANGLES['3d'].phi, theta: VIEW_ANGLES['3d'].theta, r: 16 }
  private camGoal = { ...this.cam }
  private baseRadius = 16
  private zoom = 1
  private raf = 0
  private disposed = false
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(0x0a0a0a)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const scene = this.scene
    scene.fog = new THREE.Fog(0x0a0a0a, 18, 44)
    scene.add(new THREE.HemisphereLight(0xf4f2ea, 0x0a0a0a, 0.85))
    this.sun = new THREE.DirectionalLight(0xfff6e8, 1.7)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    Object.assign(this.sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 40 })
    scene.add(this.sun, this.sun.target)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 1 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    const grid = new THREE.GridHelper(120, 120, 0x242422, 0x191918)
    grid.position.set(0.5, 0.002, 0.5)
    scene.add(grid)
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

    this.ripple.repeat.set(2, 2)
    this.ripple.needsUpdate = true

    const loop = () => {
      if (this.disposed) return
      this.frame()
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / Math.max(1, height)
    this.camera.updateProjectionMatrix()
  }

  setOptions(next: SceneOptions) {
    const viewChanged = next.view !== this.options.view
    this.options = next
    for (const view of this.views.values()) this.applyLayer(view)
    const angles = VIEW_ANGLES[next.view]
    this.camGoal.phi = angles.phi
    if (viewChanged) this.camGoal.theta = nearAngle(angles.theta, this.cam.theta)
  }

  update(data: CellsResponse) {
    const seen = new Set<string>()
    for (const cell of data.cells) {
      const key = cellKey(cell)
      seen.add(key)
      const existing = this.views.get(key)
      if (!existing) this.views.set(key, this.createView(cell))
      else if (existing.signature !== signatureOf(cell)) this.rebuildView(existing, cell)
      else existing.cell = cell
    }
    for (const [key, view] of this.views) if (!seen.has(key)) this.removeView(key, view)
    for (const view of this.views.values()) this.applyLayer(view)
    this.current = data.current
    this.rebuildFrontier()
    this.frameBounds(data)
  }

  /** Returns the key of the cell under a viewport point, if any. */
  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect()
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(v, this.camera)
    const meshes = [...this.views.values()].map((view) => view.mesh)
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    return hit ? (hit.object.userData.key as string) : null
  }

  orbit(dx: number, dy: number) {
    if (this.options.view !== '3d') return
    this.camGoal.theta -= dx * 0.006
    this.camGoal.phi = Math.min(1.35, Math.max(0.25, this.camGoal.phi - dy * 0.005))
  }

  zoomBy(deltaY: number) {
    this.zoom = Math.min(2.4, Math.max(0.45, this.zoom * Math.exp(deltaY * 0.001)))
  }

  recenter() {
    const angles = VIEW_ANGLES[this.options.view]
    this.zoom = 1
    this.camGoal.phi = angles.phi
    this.camGoal.theta = nearAngle(angles.theta, this.cam.theta)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.renderer.dispose()
  }

  private createView(cell: Cell): CellView {
    const mesh = new THREE.Mesh(this.boxGeo)
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.key = cellKey(cell)
    mesh.position.set(cell.x, 0, -cell.y)
    mesh.scale.y = 0.001
    this.scene.add(mesh)
    const capture = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial())
    capture.rotation.x = -Math.PI / 2
    capture.visible = false
    this.scene.add(capture)
    const view: CellView = {
      cell, signature: '', mesh, capture, captureUrl: null,
      texMat: new THREE.MeshStandardMaterial(), flatMat: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      details: null, height: 0, target: REST_HEIGHT, appear: 0, beacon: null, cue: null,
    }
    this.rebuildView(view, cell)
    return view
  }

  private rebuildView(view: CellView, cell: Cell) {
    view.cell = cell
    view.signature = signatureOf(cell)
    view.texMat.dispose()
    view.texMat = this.groundMaterial(cell)
    if (view.details) {
      this.scene.remove(view.details)
      view.details.geometry.dispose()
      ;(view.details.material as THREE.Material).dispose()
    }
    const label = cell.material.label
    const density = cell.material.status !== 'succeeded' ? 0 : isLowConfidence(cell.material) ? 0.35 : 1
    view.details = isMaterial(label) ? buildDetails(label, density, cell.x * 7919 + cell.y * 104729) : null
    if (view.details) this.scene.add(view.details)

    const wantsBeacon = cell.metal === 'detected'
    if (wantsBeacon && !view.beacon) {
      const beam = new THREE.Mesh(this.beamGeo, new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true }))
      const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: SIGNAL, transparent: true, side: THREE.DoubleSide }))
      ring.rotation.x = -Math.PI / 2
      this.scene.add(beam, ring)
      view.beacon = { beam, ring }
    }
    const wantsCue = cell.voc === 'detected'
    if (wantsCue && !view.cue) {
      view.cue = new THREE.Mesh(this.cueGeo, new THREE.MeshBasicMaterial({ color: 0xf2f2f0 }))
      this.scene.add(view.cue)
    }

    const url = [...cell.observations].reverse().find((o) => o.image)?.image?.url ?? null
    if (url && url !== view.captureUrl) {
      view.captureUrl = url
      this.loader.load(url, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        // Square crop from the lower part of the frame, where the landing area is.
        texture.repeat.set(0.54, 0.72)
        texture.offset.set(0.23, 0)
        const material = view.capture.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.map = texture
        material.needsUpdate = true
      })
    }
  }

  private groundMaterial(cell: Cell): THREE.Material {
    const c = cell.material
    const label = c.label
    if (c.status !== 'succeeded' || !isMaterial(label)) {
      return new THREE.MeshStandardMaterial({ color: 0x161615, roughness: 1, emissive: 0x2a2a28 })
    }
    const r = rng(cell.x * 31 + cell.y * 977)
    const map = materialTexture(label).clone()
    map.needsUpdate = true
    let material: THREE.MeshStandardMaterial | THREE.MeshPhongMaterial
    if (label === 'water') {
      material = new THREE.MeshPhongMaterial({ map, specular: 0x9fb8c6, shininess: 120, bumpMap: this.ripple, bumpScale: 0.6, transparent: true, opacity: 0.94 })
    } else {
      map.offset.set(r(), r())
      map.center.set(0.5, 0.5)
      map.rotation = Math.floor(r() * 4) * (Math.PI / 2)
      material = new THREE.MeshStandardMaterial({ map, roughness: ROUGHNESS[label] ?? 0.9, metalness: label === 'mud' ? 0.12 : 0 })
    }
    if (isLowConfidence(c)) material.color.setHex(0x8f8f8a)
    return material
  }

  private applyLayer(view: CellView) {
    const { layer, view: mode, metric } = this.options
    const textured = layer === 'combined' || layer === 'material' || layer === 'captures'
    view.mesh.material = textured ? view.texMat : view.flatMat
    if (!textured) view.flatMat.color.setHex(flatColor(view.cell, layer))
    const c = view.cell.material
    const uncertainty = c.status === 'succeeded' && c.confidence != null ? 1 - c.confidence : 0.3
    const rest = c.label === 'water' && c.status === 'succeeded' ? WATER_HEIGHT : REST_HEIGHT
    view.target = mode === '2d' || metric === 'none' ? rest : 0.1 + uncertainty * 3.2
  }

  private removeView(key: string, view: CellView) {
    for (const object of [view.mesh, view.capture, view.details, view.beacon?.beam, view.beacon?.ring, view.cue]) {
      if (object) this.scene.remove(object)
    }
    this.views.delete(key)
  }

  private rebuildFrontier() {
    for (const child of [...this.frontier.children]) {
      this.frontier.remove(child)
      ;(child as THREE.LineLoop).geometry.dispose()
    }
    const material = new THREE.LineBasicMaterial({ color: 0x4a4a46, transparent: true, opacity: 0.55 })
    const done = new Set<string>()
    for (const view of this.views.values()) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = view.cell.x + dx
        const y = view.cell.y + dy
        const key = `${x},${y}`
        if (this.views.has(key) || done.has(key) || (x === 0 && y === 0)) continue
        done.add(key)
        const pts = [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]].map(([px, pz]) => new THREE.Vector3(x + px, 0.004, -y + pz))
        this.frontier.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), material))
      }
    }
  }

  private frameBounds(data: CellsResponse) {
    const { min_x, max_x, min_y, max_y } = data.bounds
    const cx = (min_x + max_x) / 2
    const cy = (min_y + max_y) / 2
    this.targetGoal.set(cx, 0, -cy)
    const span = Math.max(max_x - min_x + 1, max_y - min_y + 1, 4)
    this.baseRadius = 5 + span * 1.45
    this.north.position.set(cx, 0.005, -(max_y + 1.6))
    this.sun.position.set(cx + 5, 11, -cy + 6)
    this.sun.target.position.set(cx, 0, -cy)
  }

  private frame() {
    const t = this.clock.getElapsedTime()
    const { layer, selected } = this.options
    const textured = layer === 'combined' || layer === 'material' || layer === 'captures'
    const showMetal = layer === 'combined' || layer === 'metal' || layer === 'captures'
    const showVoc = layer === 'combined' || layer === 'voc' || layer === 'captures'

    for (const view of this.views.values()) {
      view.height = lerp(view.height, view.target, 0.08)
      view.appear = lerp(view.appear, 1, 0.12)
      const h = Math.max(0.001, view.height * view.appear)
      const { x, y } = view.cell
      view.mesh.scale.y = h
      view.mesh.position.y = h / 2
      if (view.cell.material.status === 'queued' || view.cell.material.status === 'retrying') {
        ;(view.texMat as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + 0.5 * Math.sin(t * 3)
      }
      if (view.details) {
        view.details.position.set(x, h, -y)
        view.details.visible = textured && layer !== 'captures' && view.appear > 0.6
      }
      const hasCapture = !!(view.capture.material as THREE.MeshBasicMaterial).map
      view.capture.visible = layer === 'captures' && hasCapture
      view.capture.position.set(x, h + 0.003, -y)
      if (view.beacon) {
        const p = (t * 0.7 + x * 0.37 + y * 0.11) % 1
        view.beacon.beam.visible = view.beacon.ring.visible = showMetal
        view.beacon.beam.position.set(x, h + 1.5 * view.appear, -y)
        view.beacon.beam.scale.y = view.appear
        ;(view.beacon.beam.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2 + x)
        view.beacon.ring.position.set(x, h + 0.02, -y)
        view.beacon.ring.scale.setScalar(1 + p * 1.6)
        ;(view.beacon.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9
      }
      if (view.cue) {
        view.cue.visible = showVoc
        view.cue.position.set(x, h + 0.75 + Math.sin(t * 2) * 0.08, -y)
        view.cue.rotation.y = t * 1.2
        view.cue.scale.setScalar(view.appear)
      }
    }

    const current = this.views.get(cellKey(this.current))
    this.marker.visible = !!current
    if (current) {
      this.marker.position.set(current.cell.x, current.height * current.appear + 0.03, -current.cell.y)
      ;(this.marker.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 2.4)
    }
    const sel = selected ? this.views.get(selected) : undefined
    this.selBox.visible = !!sel
    if (sel) {
      const h = Math.max(REST_HEIGHT, sel.height * sel.appear) + 0.04
      this.selBox.scale.y = h
      this.selBox.position.set(sel.cell.x, h / 2, -sel.cell.y)
    }
    this.ripple.offset.set(t * 0.03, t * 0.021)

    const c = this.cam
    const g = this.camGoal
    g.r = this.baseRadius * this.zoom * (this.options.view === '2d' ? 1.3 : 1)
    c.phi = lerp(c.phi, g.phi, 0.06)
    c.theta = lerp(c.theta, g.theta, 0.06)
    c.r = lerp(c.r, g.r, 0.08)
    this.target.lerp(this.targetGoal, 0.06)
    const tg = this.target
    this.camera.position.set(tg.x + c.r * Math.sin(c.phi) * Math.sin(c.theta), c.r * Math.cos(c.phi), tg.z + c.r * Math.sin(c.phi) * Math.cos(c.theta))
    this.camera.lookAt(tg)
    this.renderer.render(this.scene, this.camera)
  }
}

function signatureOf(cell: Cell): string {
  const c = cell.material
  const obs = latestObservation(cell)
  return [c.status, c.label, c.confidence, cell.metal, cell.voc, obs?.image?.sha256 ?? ''].join('|')
}
