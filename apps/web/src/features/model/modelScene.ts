import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { DEFAULT_VARIANTS, PARTS, type PartId, type SlotId } from './parts'

const PAPER = 0xf4f4f1
const INK = 0x151515
const SIGNAL = 0xff5a1f
const INK_WIDTH = 1.25

type Piece = { obj: THREE.Object3D; base: THREE.Vector3; explode: THREE.Vector3 }

type PartBuild = {
  id: PartId
  group: THREE.Group
  pieces: Piece[]
  inks: LineMaterial[]
  fills: THREE.MeshBasicMaterial[]
  label: CSS2DObject
  swap?: { t: number; next: string; built: boolean }
}

/** A rounded rectangle footprint (x by z), centred. */
function roundedRect(w: number, d: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** Extrudes a footprint upwards by `h`, centred on the origin. */
function prism(shape: THREE.Shape, h: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 4 })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, -h / 2, 0)
  return geo
}

/** One tapered propeller blade from the hub outwards along +x. */
function blade(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(0.04, -0.025)
  s.quadraticCurveTo(0.28, -0.075, 0.56, -0.02)
  s.quadraticCurveTo(0.6, 0, 0.56, 0.02)
  s.quadraticCurveTo(0.28, 0.05, 0.04, 0.025)
  s.lineTo(0.04, -0.025)
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 6 })
  geo.rotateX(-Math.PI / 2)
  return geo
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/**
 * A light, CAD-style line drawing of the PogoScout: white faces hide back edges, black edges draw
 * the form. Parts pull apart for inspection and sensor modules swap in place.
 */
export class ModelScene {
  private renderer: THREE.WebGLRenderer
  private labels = new CSS2DRenderer()
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)
  private controls: OrbitControls
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private root = new THREE.Group()
  private parts = new Map<PartId, PartBuild>()
  private props: THREE.Object3D[] = []
  private spring: THREE.Object3D | null = null
  private variants: Record<SlotId, string> = { ...DEFAULT_VARIANTS }
  private selected: PartId | null = null
  private hovered: PartId | null = null
  private exploded = false
  private explodeT = 0
  private hopStart = -1
  private focusDistance = 7
  private raf = 0
  private disposed = false
  private container: HTMLElement
  private onSelect: (id: PartId | null) => void
  private onHover: (id: PartId | null) => void
  private resizeObserver: ResizeObserver
  private down = { x: 0, y: 0 }

  constructor(container: HTMLElement, onSelect: (id: PartId | null) => void, onHover: (id: PartId | null) => void) {
    this.container = container
    this.onSelect = onSelect
    this.onHover = onHover
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.setClearColor(PAPER)
    container.appendChild(this.renderer.domElement)
    this.labels.domElement.style.position = 'absolute'
    this.labels.domElement.style.inset = '0'
    this.labels.domElement.style.pointerEvents = 'none'
    container.appendChild(this.labels.domElement)

    this.camera.position.set(4.6, 3.4, 5.2)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.target.set(0, 1, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 2
    this.controls.maxDistance = 32
    this.controls.maxPolarAngle = Math.PI * 0.55
    this.controls.autoRotate = true
    this.controls.autoRotateSpeed = 0.6
    this.controls.addEventListener('start', () => (this.controls.autoRotate = false))

    const grid = new THREE.GridHelper(48, 96, 0xcfcfca, 0xe2e2dd)
    this.scene.add(grid)
    this.scene.add(this.root)
    this.build()

    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }))
    canvas.addEventListener('pointerup', (e) => {
      if (Math.abs(e.clientX - this.down.x) + Math.abs(e.clientY - this.down.y) > 4) return
      // Clicking the selected part again (or empty space) deselects, like the list.
      const hit = this.pick(e.clientX, e.clientY)
      const id = hit === this.selected ? null : hit
      this.select(id)
      this.onSelect(id)
    })
    canvas.addEventListener('pointermove', (e) => {
      const id = this.pick(e.clientX, e.clientY)
      if (id !== this.hovered) {
        this.hovered = id
        canvas.style.cursor = id ? 'pointer' : 'grab'
        this.onHover(id)
        this.paint()
      }
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    const loop = () => {
      if (this.disposed) return
      this.frame()
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  select(id: PartId | null) {
    this.selected = id
    if (id) this.exploded = true
    this.focusDistance = id ? 6.2 : 7
    this.paint()
  }

  setExploded(exploded: boolean) {
    this.exploded = exploded
    if (!exploded) this.select(null)
  }

  setVariant(slot: SlotId, variant: string) {
    if (this.variants[slot] === variant) return
    this.variants[slot] = variant
    const part = this.parts.get(slot)
    if (part) part.swap = { t: 0, next: variant, built: false }
  }

  hop() {
    this.setExploded(false)
    this.hopStart = this.clock.getElapsedTime()
  }

  setAutoRotate(on: boolean) {
    this.controls.autoRotate = on
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
      const m = mesh.material as THREE.Material | undefined
      m?.dispose?.()
    })
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.labels.domElement.remove()
  }

  // Building ------------------------------------------------------------------------------------

  private newPart(id: PartId): PartBuild {
    const group = new THREE.Group()
    group.userData.part = id
    this.root.add(group)
    const index = PARTS.findIndex((p) => p.id === id)
    const el = document.createElement('div')
    el.className = 'model-label'
    el.innerHTML = `<span class="num">${String(index + 1).padStart(2, '0')}</span><span class="txt"></span>`
    ;(el.querySelector('.txt') as HTMLElement).textContent = PARTS[index].name
    const label = new CSS2DObject(el)
    this.scene.add(label)
    const part: PartBuild = { id, group, pieces: [], inks: [], fills: [], label }
    this.parts.set(id, part)
    return part
  }

  private ink(part: PartBuild) {
    const m = new LineMaterial({ color: INK, linewidth: INK_WIDTH, transparent: true })
    part.inks.push(m)
    return m
  }

  private fill(part: PartBuild) {
    const m = new THREE.MeshBasicMaterial({ color: PAPER, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, transparent: true })
    part.fills.push(m)
    return m
  }

  /** A solid drawn as its edges: faces in paper colour hide what is behind. */
  private solid(part: PartBuild, geo: THREE.BufferGeometry, at: THREE.Vector3Tuple, rot: THREE.Vector3Tuple = [0, 0, 0], threshold = 20) {
    const g = new THREE.Group()
    const mesh = new THREE.Mesh(geo, this.fill(part))
    mesh.userData.part = part.id
    const edges = new LineSegments2(new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geo, threshold)), this.ink(part))
    g.add(mesh, edges)
    g.position.set(...at)
    g.rotation.set(...rot)
    return g
  }

  private polyline(part: PartBuild, points: THREE.Vector3[]) {
    const geo = new LineGeometry()
    geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]))
    return new Line2(geo, this.ink(part))
  }

  /** A circle in the horizontal plane at `centre`. */
  private circle(part: PartBuild, r: number, y: number, segments = 48, cx = 0, cz = 0) {
    const pts = Array.from({ length: segments + 1 }, (_, i) => {
      const a = (i / segments) * Math.PI * 2
      return new THREE.Vector3(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)
    })
    return this.polyline(part, pts)
  }

  /** A closed outline through the given points. */
  private outline(part: PartBuild, points: THREE.Vector3Tuple[]) {
    return this.polyline(part, [...points, points[0]].map((p) => new THREE.Vector3(...p)))
  }

  /** A slotted mounting hole drawn on a horizontal face. */
  private slot(part: PartBuild, cx: number, y: number, cz: number, length: number, r: number) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI
      pts.push(new THREE.Vector3(cx + length / 2 + Math.cos(a) * r, y, cz + Math.sin(a) * r))
    }
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI / 2 + (i / 12) * Math.PI
      pts.push(new THREE.Vector3(cx - length / 2 + Math.cos(a) * r, y, cz + Math.sin(a) * r))
    }
    pts.push(pts[0].clone())
    return this.polyline(part, pts)
  }

  /** A socket-head screw; `axis` is the direction its head faces. */
  private screw(part: PartBuild, at: THREE.Vector3Tuple, axis: 'x' | 'y' | 'z' = 'y', r = 0.022) {
    const rot: THREE.Vector3Tuple = axis === 'y' ? [0, 0, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0]
    return this.solid(part, new THREE.CylinderGeometry(r, r, 0.018, 8), at, rot, 1)
  }

  private piece(part: PartBuild, obj: THREE.Object3D, explode: THREE.Vector3Tuple) {
    part.group.add(obj)
    part.pieces.push({ obj, base: obj.position.clone(), explode: new THREE.Vector3(...explode) })
  }

  private build() {
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
    const cyl = (r: number, h: number, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg)

    // Core: rounded airframe with lid, vents, fasteners, status light and connector.
    const core = this.newPart('core')
    const body = new THREE.Group()
    body.add(this.solid(core, prism(roundedRect(1.3, 1.3, 0.2), 0.42), [0, 1.25, 0]))
    body.add(this.solid(core, prism(roundedRect(0.94, 0.94, 0.12), 0.05), [0, 1.485, 0]))
    for (const [x, z] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) body.add(this.screw(core, [x, 1.517, z]))
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const z = -0.24 + i * 0.12
        body.add(this.outline(core, [[s * 0.651, 1.2, z - 0.035], [s * 0.651, 1.2, z + 0.035], [s * 0.651, 1.34, z + 0.035], [s * 0.651, 1.34, z - 0.035]]))
      }
    }
    body.add(this.solid(core, cyl(0.035, 0.03, 12), [0.32, 1.25, 0.66], [Math.PI / 2, 0, 0], 1))
    body.add(this.outline(core, [[-0.12, 1.3, 0.651], [0.12, 1.3, 0.651], [0.12, 1.36, 0.651], [-0.12, 1.36, 0.651]]))
    body.add(this.solid(core, box(0.26, 0.09, 0.05), [0, 1.2, -0.67]))
    body.add(this.outline(core, [[-0.08, 1.18, -0.696], [0.08, 1.18, -0.696], [0.08, 1.22, -0.696], [-0.08, 1.22, -0.696]]))
    this.piece(core, body, [0, 0, 0])

    // Propulsion: arm with mount plate, motor stator and vented bell, shaped blades, guard.
    const prop = this.newPart('propulsion')
    const bladeGeo = blade()
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      const m = (d: number, y: number): THREE.Vector3Tuple => [dx * d, y, dz * d]
      const rotor = new THREE.Group()
      rotor.add(this.solid(prop, box(1.0, 0.07, 0.12), m(1.08, 1.36), [0, -a, 0]))
      rotor.add(this.screw(prop, m(0.72, 1.4)), this.screw(prop, m(0.86, 1.4)))
      rotor.add(this.solid(prop, cyl(0.2, 0.03, 16), m(1.6, 1.41), [0, 0, 0], 1))
      rotor.add(this.solid(prop, cyl(0.155, 0.09, 16), m(1.6, 1.47), [0, 0, 0], 1))
      rotor.add(this.solid(prop, cyl(0.145, 0.1, 16), m(1.6, 1.56), [0, 0, 0], 1))
      for (let k = 0; k < 8; k++) {
        const b = (k / 8) * Math.PI * 2
        const [cx, , cz] = m(1.6, 0)
        rotor.add(this.polyline(prop, [new THREE.Vector3(cx + Math.cos(b) * 0.146, 1.53, cz + Math.sin(b) * 0.146), new THREE.Vector3(cx + Math.cos(b) * 0.146, 1.59, cz + Math.sin(b) * 0.146)]))
      }
      rotor.add(this.solid(prop, cyl(0.02, 0.06, 8), m(1.6, 1.63), [0, 0, 0], 1))
      const blades = new THREE.Group()
      blades.add(this.solid(prop, cyl(0.05, 0.04, 12), [0, 0, 0], [0, 0, 0], 1))
      for (const turn of [0, Math.PI]) {
        const bl = this.solid(prop, bladeGeo, [0, 0, 0], [0, turn, 0])
        blades.add(bl)
      }
      blades.position.set(...m(1.6, 1.66))
      this.props.push(blades)
      rotor.add(blades)
      const guard = new THREE.Group()
      guard.add(this.circle(prop, 0.74, 0), this.circle(prop, 0.74, 0.16), this.circle(prop, 0.7, 0.16))
      for (let k = 0; k < 10; k++) {
        const b = (k / 10) * Math.PI * 2
        guard.add(this.polyline(prop, [new THREE.Vector3(Math.cos(b) * 0.74, 0, Math.sin(b) * 0.74), new THREE.Vector3(Math.cos(b) * 0.74, 0.16, Math.sin(b) * 0.74)]))
      }
      guard.position.set(...m(1.6, 1.5))
      rotor.add(guard)
      rotor.add(this.solid(prop, box(0.3, 0.04, 0.06), m(0.98, 1.43), [0, -a, 0]))
      this.piece(prop, rotor, [dx * 0.9, 0.35, dz * 0.9])
    }

    // Pogo leg: slotted mounting plates, carriage frame with sensor board, U-bracket and arm,
    // guide rollers, rod with coil spring and a ball foot.
    const leg = this.newPart('leg')
    const L = new THREE.Group()
    L.add(this.solid(leg, box(0.62, 0.03, 0.46), [0, 1.005, 0]))
    L.add(this.solid(leg, box(0.56, 0.025, 0.42), [0, 0.978, 0]))
    for (const [x, z] of [[-0.2, -0.15], [0.2, -0.15], [-0.2, 0.15], [0.2, 0.15]]) L.add(this.slot(leg, x, 0.964, z, 0.06, 0.018))
    for (const s of [-1, 1]) L.add(this.solid(leg, box(0.03, 0.3, 0.28), [s * 0.135, 0.815, 0]))
    L.add(this.solid(leg, box(0.24, 0.2, 0.2), [0, 0.8, 0]))
    L.add(this.solid(leg, box(0.2, 0.15, 0.014), [0, 0.81, 0.107]))
    for (const [x, y] of [[-0.075, 0.865], [0.075, 0.865], [-0.075, 0.755], [0.075, 0.755]]) L.add(this.screw(leg, [x, y, 0.118], 'z', 0.014))
    L.add(this.outline(leg, [[-0.05, 0.79, 0.1145], [0.03, 0.79, 0.1145], [0.03, 0.83, 0.1145], [-0.05, 0.83, 0.1145]]))
    L.add(this.solid(leg, box(0.36, 0.025, 0.05), [0, 0.92, 0.13]))
    for (const s of [-1, 1]) L.add(this.solid(leg, box(0.025, 0.24, 0.05), [s * 0.17, 0.81, 0.13]))
    L.add(this.solid(leg, box(0.05, 0.02, 0.46), [0.17, 0.92, 0.37]))
    for (const x of [-0.05, 0.05]) for (const z of [-0.06, 0.06]) L.add(this.solid(leg, cyl(0.035, 0.05, 12), [x, 0.67, z], [0, 0, Math.PI / 2], 1))
    L.add(this.solid(leg, cyl(0.032, 0.56, 10), [0, 0.39, 0], [0, 0, 0], 1))
    L.add(this.solid(leg, cyl(0.07, 0.03, 14), [0, 0.64, 0], [0, 0, 0], 1))
    const turns = 11
    const helix = Array.from({ length: turns * 28 + 1 }, (_, i) => {
      const t = i / 28
      return new THREE.Vector3(Math.cos(t * Math.PI * 2) * 0.075, (i / (turns * 28)) * 0.44, Math.sin(t * Math.PI * 2) * 0.075)
    })
    const spring = new THREE.Group()
    spring.add(this.polyline(leg, helix))
    spring.position.set(0, 0.19, 0)
    this.spring = spring
    L.add(spring)
    L.add(this.solid(leg, cyl(0.06, 0.04, 14), [0, 0.17, 0], [0, 0, 0], 1))
    L.add(this.solid(leg, new THREE.IcosahedronGeometry(0.1, 1), [0, 0.1, 0], [0, 0, 0], 12))
    this.piece(leg, L, [0, -0.9, 0])

    // Battery on the lid: pack, strap, balance lead and power connector.
    const battery = this.newPart('battery')
    const pack = new THREE.Group()
    pack.add(this.solid(battery, prism(roundedRect(0.78, 0.4, 0.04), 0.16), [0, 1.59, -0.05]))
    pack.add(this.solid(battery, box(0.08, 0.172, 0.43), [-0.18, 1.59, -0.05]))
    pack.add(this.solid(battery, box(0.08, 0.172, 0.43), [0.18, 1.59, -0.05]))
    pack.add(this.outline(battery, [[-0.1, 1.671, -0.15], [0.1, 1.671, -0.15], [0.1, 1.671, 0.05], [-0.1, 1.671, 0.05]]))
    pack.add(this.solid(battery, box(0.1, 0.05, 0.06), [0.3, 1.6, 0.2]))
    pack.add(this.polyline(battery, [new THREE.Vector3(-0.39, 1.62, 0.05), new THREE.Vector3(-0.47, 1.6, 0.1), new THREE.Vector3(-0.44, 1.55, 0.2)]))
    pack.add(this.solid(battery, box(0.06, 0.03, 0.04), [-0.44, 1.54, 0.22]))
    this.piece(battery, pack, [0, 1.0, -0.6])

    // Module slots
    for (const slot of ['camera', 'metal', 'gas', 'datalink'] as SlotId[]) this.buildSlot(slot)
  }

  private slotExplode: Record<SlotId, THREE.Vector3Tuple> = {
    camera: [0, -0.45, 1.25],
    metal: [-1.25, -0.35, 0],
    gas: [1.25, 0.05, 0],
    datalink: [-0.55, 1.0, -0.55],
  }

  private buildSlot(slot: SlotId) {
    const part = this.parts.get(slot) ?? this.newPart(slot)
    for (const p of part.pieces) part.group.remove(p.obj)
    part.pieces = []
    const g = new THREE.Group()
    const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
    const cyl = (r: number, h: number, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg)
    const v = this.variants[slot]

    if (slot === 'camera') {
      g.position.set(0, 0.95, 0.52)
      g.add(this.solid(part, box(0.36, 0.03, 0.08), [0, 0.1, -0.02]))
      for (const s of [-1, 1]) g.add(this.screw(part, [s * 0.13, 0.117, -0.02]))
      if (v === 'rgb') {
        g.add(this.solid(part, prism(roundedRect(0.3, 0.24, 0.03), 0.18), [0, 0, 0]))
        g.add(this.solid(part, cyl(0.08, 0.04, 18), [0, -0.11, 0.02], [0, 0, 0], 1))
        g.add(this.solid(part, cyl(0.065, 0.05, 18), [0, -0.15, 0.02], [0, 0, 0], 1))
        g.add(this.circle(part, 0.04, -0.176, 24, 0, 0.02))
        g.add(this.solid(part, cyl(0.012, 0.01, 8), [0.1, -0.09, -0.07], [0, 0, 0], 1))
      } else if (v === 'thermal') {
        g.add(this.solid(part, prism(roundedRect(0.34, 0.3, 0.03), 0.2), [0, 0, 0]))
        g.add(this.solid(part, box(0.18, 0.05, 0.18), [0, -0.125, 0.02]))
        g.add(this.outline(part, [[-0.06, -0.151, -0.04], [0.06, -0.151, -0.04], [0.06, -0.151, 0.08], [-0.06, -0.151, 0.08]]))
        for (const x of [-0.12, -0.06, 0, 0.06, 0.12]) g.add(this.solid(part, box(0.012, 0.07, 0.26), [x, 0.135, 0]))
      } else {
        g.add(this.solid(part, prism(roundedRect(0.42, 0.32, 0.03), 0.16), [0, 0, 0]))
        for (const [x, z] of [[-0.1, -0.07], [0.1, -0.07], [-0.1, 0.09], [0.1, 0.09]]) {
          g.add(this.solid(part, cyl(0.05, 0.05, 14), [x, -0.1, z], [0, 0, 0], 1))
          g.add(this.circle(part, 0.03, -0.126, 16, x, z))
        }
      }
    } else if (slot === 'metal') {
      if (v === 'coil') {
        for (const [r, y] of [[0.46, 0.15], [0.46, 0.24], [0.4, 0.15], [0.4, 0.24]] as [number, number][]) g.add(this.circle(part, r, y))
        for (let k = 0; k < 6; k++) g.add(this.circle(part, 0.43, 0.165 + k * 0.012, 48))
        for (let k = 0; k < 3; k++) {
          const b = (k / 3) * Math.PI * 2 + 0.3
          g.add(this.solid(part, box(0.29, 0.02, 0.04), [Math.cos(b) * 0.25, 0.25, Math.sin(b) * 0.25], [0, -b, 0]))
        }
        g.add(this.solid(part, box(0.18, 0.04, 0.12), [0.24, 0.3, 0.14]))
        g.add(this.polyline(part, [new THREE.Vector3(0.24, 0.32, 0.2), new THREE.Vector3(0.2, 0.5, 0.18), new THREE.Vector3(0.12, 0.7, 0.12)]))
      } else if (v === 'magnetometer') {
        g.add(this.solid(part, box(0.06, 0.06, 1.1), [-0.62, 1.06, 0.62], [0, Math.PI / 4, 0]))
        for (const d of [0.35, 0.75]) g.add(this.solid(part, box(0.09, 0.09, 0.03), [-d * 0.707 - 0.24, 1.06, d * 0.707 + 0.24], [0, Math.PI / 4, 0]))
        g.add(this.solid(part, cyl(0.07, 0.26, 16), [-1.02, 1.06, 1.02], [Math.PI / 2, 0, Math.PI / 4], 1))
        g.add(this.solid(part, cyl(0.05, 0.04, 16), [-1.12, 1.06, 1.12], [Math.PI / 2, 0, Math.PI / 4], 1))
      } else {
        g.add(this.solid(part, prism(roundedRect(0.92, 0.64, 0.06), 0.045), [0, 0.2, 0]))
        for (const x of [-0.3, -0.1, 0.1, 0.3]) g.add(this.outline(part, [[x - 0.05, 0.2235, -0.24], [x + 0.05, 0.2235, -0.24], [x + 0.05, 0.2235, 0.24], [x - 0.05, 0.2235, 0.24]]))
        g.add(this.solid(part, box(0.2, 0.06, 0.14), [0.32, 0.25, -0.22]))
        for (const [x, z] of [[-0.42, -0.28], [0.42, -0.28], [-0.42, 0.28], [0.42, 0.28]]) g.add(this.screw(part, [x, 0.226, z]))
      }
    } else if (slot === 'gas') {
      g.position.set(0.8, 1.2, 0)
      g.add(this.solid(part, box(0.04, 0.2, 0.2), [-0.13, 0, 0]))
      for (const y of [-0.06, 0.06]) g.add(this.screw(part, [-0.105, y, 0.06], 'x', 0.016))
      if (v === 'voc') {
        g.add(this.solid(part, cyl(0.12, 0.3, 18), [0, -0.02, 0], [0, 0, 0], 1))
        for (const y of [-0.12, -0.07, -0.02, 0.03, 0.08]) g.add(this.circle(part, 0.123, y, 24))
        g.add(this.solid(part, cyl(0.1, 0.05, 18), [0, 0.155, 0], [0, 0, 0], 1))
        for (let k = 0; k < 6; k++) {
          const b = (k / 6) * Math.PI
          g.add(this.polyline(part, [new THREE.Vector3(Math.cos(b) * 0.09, 0.181, Math.sin(b) * 0.09), new THREE.Vector3(-Math.cos(b) * 0.09, 0.181, -Math.sin(b) * 0.09)]))
        }
      } else if (v === 'co2') {
        g.add(this.solid(part, cyl(0.09, 0.5, 18), [0.02, 0, 0], [Math.PI / 2, 0, 0], 1))
        for (const z of [-0.26, 0.26]) g.add(this.solid(part, cyl(0.1, 0.04, 18), [0.02, 0, z], [Math.PI / 2, 0, 0], 1))
        for (const z of [-0.14, 0, 0.14]) g.add(this.solid(part, box(0.2, 0.02, 0.02), [0.02, 0.09, z]))
      } else {
        g.add(this.solid(part, prism(roundedRect(0.22, 0.34, 0.03), 0.3), [0, 0, 0]))
        for (const z of [-0.1, 0, 0.1]) {
          g.add(this.solid(part, cyl(0.045, 0.05, 14), [0.13, 0.05, z], [0, 0, Math.PI / 2], 1))
          g.add(this.solid(part, cyl(0.03, 0.02, 14), [0.16, 0.05, z], [0, 0, Math.PI / 2], 1))
        }
        g.add(this.outline(part, [[0.111, -0.08, -0.12], [0.111, -0.08, 0.12], [0.111, -0.04, 0.12], [0.111, -0.04, -0.12]]))
      }
    } else {
      g.position.set(-0.42, 1.52, -0.42)
      g.add(this.solid(part, cyl(0.06, 0.02, 14), [0, 0.01, 0], [0, 0, 0], 1))
      g.add(this.solid(part, cyl(0.03, 0.06, 6), [0, 0.05, 0], [0, 0, 0], 1))
      if (v === 'video58') {
        g.add(this.solid(part, cyl(0.02, 0.5, 8), [0, 0.33, 0], [0, 0, 0], 1))
        g.add(this.solid(part, cyl(0.03, 0.08, 10), [0, 0.12, 0], [0, 0, 0], 1))
        g.add(this.solid(part, new THREE.IcosahedronGeometry(0.085, 0), [0, 0.63, 0], [0, 0, 0], 1))
      } else if (v === 'mesh') {
        g.add(this.solid(part, box(0.34, 0.04, 0.1), [0, 0.1, 0]))
        g.add(this.solid(part, cyl(0.02, 0.6, 8), [-0.13, 0.42, 0], [0, 0, 0], 1))
        g.add(this.solid(part, cyl(0.02, 0.44, 8), [0.13, 0.34, 0], [0, 0, 0], 1))
        for (const x of [-0.13, 0.13]) g.add(this.solid(part, cyl(0.03, 0.05, 10), [x, 0.14, 0], [0, 0, 0], 1))
      } else {
        g.add(this.solid(part, prism(roundedRect(0.22, 0.06, 0.025), 0.34), [0, 0.25, 0]))
        g.add(this.outline(part, [[-0.07, 0.15, 0.031], [0.07, 0.15, 0.031], [0.07, 0.36, 0.031], [-0.07, 0.36, 0.031]]))
        g.add(this.solid(part, box(0.12, 0.05, 0.12), [0, 0.06, 0]))
      }
    }
    this.piece(part, g, this.slotExplode[slot])
    this.paint()
  }

  // Interaction ---------------------------------------------------------------------------------

  private pick(clientX: number, clientY: number): PartId | null {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const v = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    this.raycaster.setFromCamera(v, this.camera)
    const meshes: THREE.Object3D[] = []
    this.root.traverse((o) => (o as THREE.Mesh).isMesh && meshes.push(o))
    const hit = this.raycaster.intersectObjects(meshes, false)[0]
    return (hit?.object.userData.part as PartId | undefined) ?? null
  }

  /** Ink colour and weight: selected part in signal orange, the rest faded while one is chosen. */
  private paint() {
    for (const part of this.parts.values()) {
      const isSel = part.id === this.selected
      const isHover = part.id === this.hovered
      const faded = this.selected !== null && !isSel
      for (const m of part.inks) {
        m.color.setHex(isSel ? SIGNAL : INK)
        m.linewidth = isSel ? 2.2 : isHover ? 2 : INK_WIDTH
        m.opacity = faded && !isHover ? 0.22 : 1
      }
      for (const f of part.fills) f.opacity = faded ? 0.55 : 1
      part.label.element.dataset.selected = String(isSel)
    }
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.labels.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    for (const part of this.parts.values()) for (const m of part.inks) m.resolution.set(w, h)
  }

  private frame() {
    const dt = Math.min(0.05, this.clock.getDelta())
    const t = this.clock.elapsedTime
    this.explodeT += ((this.exploded ? 1 : 0) - this.explodeT) * 0.08
    const k = ease(Math.min(1, Math.max(0, this.explodeT)))

    // Hop demo, three hops: a brief spring compression on contact, then straight back up on a
    // ballistic arc. Positions are set directly each frame so landing and take-off are crisp.
    let lift = 0
    let squash = 1
    if (this.hopStart >= 0) {
      const p = (t - this.hopStart) / 0.95
      if (p >= 3.08) this.hopStart = -1
      else {
        const c = p % 1
        const contact = 0.08
        if (c < contact || p >= 3) squash = 1 - 0.42 * Math.sin((Math.min(c, contact) / contact) * Math.PI)
        else {
          const u = (c - contact) / (1 - contact)
          lift = 4 * 1.3 * u * (1 - u)
          squash = 1 + 0.08 * Math.sin(u * Math.PI)
        }
      }
    }
    this.root.position.y = lift
    if (this.spring) this.spring.scale.y = squash
    for (const p of this.props) p.rotation.y += dt * (this.hopStart >= 0 ? 40 : 6)

    for (const part of this.parts.values()) {
      for (const piece of part.pieces) piece.obj.position.copy(piece.base).addScaledVector(piece.explode, k)
      if (part.swap) {
        part.swap.t += dt * 2.6
        const s = part.swap.t < 0.5 ? 1 - part.swap.t * 2 : (part.swap.t - 0.5) * 2
        if (part.swap.t >= 0.5 && !part.swap.built) {
          part.swap.built = true
          this.buildSlot(part.id as SlotId)
        }
        part.group.scale.setScalar(Math.max(0.001, Math.min(1, s)))
        if (part.swap.t >= 1) {
          part.group.scale.setScalar(1)
          part.swap = undefined
        }
      }
      const bounds = new THREE.Box3().setFromObject(part.group)
      const centre = bounds.getCenter(new THREE.Vector3())
      part.label.position.copy(centre).add(new THREE.Vector3(0, bounds.getSize(new THREE.Vector3()).y / 2 + 0.18, 0))
      part.label.element.style.opacity = String(k > 0.6 ? (this.selected && part.id !== this.selected ? 0.35 : 1) : 0)
    }

    // Glide the camera focus towards the chosen part.
    // Keep the whole drone in frame, leaning towards the chosen part.
    const home = new THREE.Vector3(0, 1 + this.root.position.y * 0.5, 0)
    const goal = this.selected
      ? home.lerp(new THREE.Box3().setFromObject(this.parts.get(this.selected)!.group).getCenter(new THREE.Vector3()), 0.6)
      : home
    this.controls.target.lerp(goal, 0.07)
    const offset = this.camera.position.clone().sub(this.controls.target)
    const dist = offset.length()
    if (!this.controls.autoRotate || this.selected) offset.setLength(dist + (this.focusDistance - dist) * 0.04)
    this.camera.position.copy(this.controls.target).add(offset)
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this.labels.render(this.scene, this.camera)
  }
}
