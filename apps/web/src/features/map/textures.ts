import * as THREE from 'three'
import type { Material } from '../../lib/materials'

/** Deterministic PRNG (mulberry32) so every client paints the same ground. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Painter = (g: CanvasRenderingContext2D, r: () => number) => void

const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)]
const fill = (g: CanvasRenderingContext2D, color: string) => {
  g.fillStyle = color
  g.fillRect(0, 0, 256, 256)
}
function specks(g: CanvasRenderingContext2D, r: () => number, n: number, colors: string[], a: number, b: number) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(r, colors)
    const s = a + r() * (b - a)
    g.fillRect(r() * 256, r() * 256, s, s)
  }
}
function blobs(g: CanvasRenderingContext2D, r: () => number, n: number, colors: string[], a: number, b: number, alpha: number) {
  g.globalAlpha = alpha
  for (let i = 0; i < n; i++) {
    g.fillStyle = pick(r, colors)
    const rx = a + r() * (b - a)
    g.beginPath()
    g.ellipse(r() * 256, r() * 256, rx, rx * (0.45 + r() * 0.55), r() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1
}

// Visual cues follow the material model's prompt wording (colour, grain, sheen, pattern).
const PAINTERS: Record<Material | 'ripple', Painter> = {
  soil: (g, r) => {
    fill(g, '#8a4a2c')
    blobs(g, r, 70, ['#7a3f25', '#9c5a36', '#6e3620'], 4, 14, 0.55)
    specks(g, r, 4500, ['#6e3620', '#a4623c', '#8f4f30', '#5c2e1a'], 1, 2.5)
  },
  mud: (g, r) => {
    fill(g, '#4a2e20')
    g.lineCap = 'round'
    for (let i = 0; i < 46; i++) {
      g.strokeStyle = `rgba(${110 + r() * 40},${72 + r() * 20},50,${0.25 + r() * 0.3})`
      g.lineWidth = 3 + r() * 9
      g.beginPath()
      const x0 = r() * 256
      const y0 = r() * 256
      g.moveTo(x0, y0)
      g.quadraticCurveTo(x0 + (r() - 0.5) * 120, y0 + (r() - 0.5) * 60, x0 + (r() - 0.5) * 160, y0 + (r() - 0.5) * 80)
      g.stroke()
    }
    specks(g, r, 1500, ['#3a2218', '#5a3a28'], 1, 2)
  },
  sand: (g, r) => {
    fill(g, '#d3c29b')
    specks(g, r, 10000, ['#c9b68c', '#e2d4b0', '#bfae86', '#d8c8a4'], 1, 1.6)
    g.strokeStyle = 'rgba(150,130,90,.2)'
    g.lineWidth = 2
    for (let yy = 6; yy < 256; yy += 13) {
      g.beginPath()
      for (let xx = 0; xx <= 256; xx += 8) g.lineTo(xx, yy + Math.sin(xx / 22 + yy) * 3)
      g.stroke()
    }
  },
  gravel: (g, r) => {
    fill(g, '#6f6e69')
    blobs(g, r, 320, ['#9a9993', '#6a6964', '#b3b2ac', '#8a8983', '#c9c8c1'], 3, 9, 0.95)
    specks(g, r, 2000, ['#4f4e4a', '#c4c3bd'], 1, 2)
  },
  grass_vegetation: (g, r) => {
    fill(g, '#2f5224')
    g.lineCap = 'round'
    for (let i = 0; i < 2600; i++) {
      g.strokeStyle = pick(r, ['#3f6b2a', '#4f7f33', '#2a4a1f', '#5b8a3a', '#6a9a44'])
      g.lineWidth = 1 + r() * 2
      const x0 = r() * 256
      const y0 = r() * 256
      const a = (r() - 0.5) * 1.2
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x0 + Math.sin(a) * 9, y0 - Math.cos(a) * 9)
      g.stroke()
    }
  },
  leaf_litter: (g, r) => {
    fill(g, '#3d2a18')
    blobs(g, r, 240, ['#7a5228', '#a0702e', '#5e3d1d', '#b08a3a', '#4a3320', '#8a5a26'], 6, 16, 0.95)
  },
  concrete: (g, r) => {
    fill(g, '#b9b8b2')
    blobs(g, r, 40, ['#a9a8a2', '#c6c5bf', '#aeada5'], 20, 60, 0.25)
    specks(g, r, 3200, ['#a3a29c', '#cbcac4'], 1, 1.5)
    g.strokeStyle = 'rgba(70,70,68,.45)'
    g.lineWidth = 0.8
    for (let i = 0; i < 4; i++) {
      g.beginPath()
      let x0 = r() * 256
      let y0 = r() * 256
      g.moveTo(x0, y0)
      for (let k = 0; k < 8; k++) {
        x0 += (r() - 0.5) * 40
        y0 += (r() - 0.3) * 30
        g.lineTo(x0, y0)
      }
      g.stroke()
    }
  },
  asphalt: (g, r) => {
    fill(g, '#2f2f30')
    specks(g, r, 14000, ['#3d3d3e', '#252526', '#4a4a4b', '#1d1d1e', '#5a5a5e'], 1, 2)
  },
  tiles_pavers: (g, r) => {
    fill(g, '#4a4642')
    const colors = ['#a86a52', '#9aa0a3', '#b07458', '#8e9497', '#a0634c']
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? 32 : 0
      for (let col = -1; col < 5; col++) {
        g.fillStyle = pick(r, colors)
        g.fillRect(col * 64 + off + 2, row * 32 + 2, 60, 28)
      }
    }
    g.globalAlpha = 0.5
    specks(g, r, 3000, ['#5a4a40', '#c8a896', '#777c7f'], 1, 1.5)
    g.globalAlpha = 1
  },
  water: (g) => {
    const gradient = g.createLinearGradient(0, 0, 256, 256)
    gradient.addColorStop(0, '#2a4452')
    gradient.addColorStop(1, '#16252e')
    g.fillStyle = gradient
    g.fillRect(0, 0, 256, 256)
  },
  ripple: (g, r) => {
    fill(g, '#808080')
    blobs(g, r, 260, ['#707070', '#909090', '#7a7a7a', '#868686'], 4, 18, 0.6)
  },
}

const cache = new Map<string, THREE.CanvasTexture>()

/** A shared procedural texture per material; clone before changing offset or rotation. */
export function materialTexture(kind: Material | 'ripple'): THREE.CanvasTexture {
  const cached = cache.get(kind)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const g = canvas.getContext('2d')!
  PAINTERS[kind](g, rng(kind.length * 131 + kind.charCodeAt(0)))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = kind === 'ripple' ? THREE.NoColorSpace : THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  cache.set(kind, texture)
  return texture
}
