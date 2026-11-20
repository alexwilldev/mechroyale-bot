/**
 * Static world model: terrain heights, solid prisms rasterized onto the 1 m terrain grid,
 * and segment line-of-sight against prisms + terrain. Shared by the bot and the sandbox sim.
 *
 * Grid cell (i, j) is the 1 m square centred on the terrain vertex x = minX + i, y = minY + j.
 * Each cell stores the vertical [base, top] intervals of every prism covering its centre.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

export type Prism = { kind: string; base: number; top: number; ring: number[]; holes: number[][] }
export type Tree = { x: number; y: number; z: number; height: number; crownR: number; crownBase: number; trunkR: number; cx: number; cy: number }

export class GameMap {
  readonly nx: number
  readonly ny: number
  readonly minX: number
  readonly minY: number
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number }
  readonly ground: Float32Array // vertex heights, metres
  readonly prisms: Prism[]
  readonly trees: Tree[]
  /** per-cell interval list: ivData[2k], ivData[2k+1] = base, top for k in [ivStart[c], ivStart[c+1]) */
  readonly ivStart: Int32Array
  readonly ivData: Float32Array
  /** highest prism top in the cell, -Infinity if none (fast LOS rejection) */
  readonly maxTop: Float32Array

  constructor(world: any, terrain: ArrayBuffer) {
    const t = world.terrain
    this.nx = t.nx
    this.ny = t.ny
    this.minX = t.minX
    this.minY = t.minY
    this.bounds = world.bounds
    const raw = new Int16Array(terrain, 0, this.nx * this.ny)
    this.ground = new Float32Array(raw.length)
    for (let k = 0; k < raw.length; k++) this.ground[k] = raw[k] * (t.scale ?? 0.01)
    this.prisms = world.prisms.map((p: any) => ({ kind: p.kind, base: p.base, top: p.top, ring: p.ring, holes: p.holes ?? [] }))
    const f: string[] = world.trees.fields
    const d: number[] = world.trees.data
    const ix = (n: string) => f.indexOf(n)
    const [X, Y, Z, H, CR, CB, TR, CX, CY] = ["x", "y", "z", "height", "crownR", "crownBase", "trunkR", "crownX", "crownY"].map(ix)
    this.trees = []
    for (let o = 0; o + f.length <= d.length; o += f.length)
      this.trees.push({ x: d[o + X], y: d[o + Y], z: d[o + Z], height: d[o + H], crownR: d[o + CR], crownBase: d[o + CB], trunkR: d[o + TR], cx: CX >= 0 ? d[o + CX] : d[o + X], cy: CY >= 0 ? d[o + CY] : d[o + Y] })

    // two-pass rasterization: count, then fill
    const n = this.nx * this.ny
    const counts = new Uint16Array(n)
    this.prisms.forEach((p) => this.raster(p, (c) => counts[c]++))
    this.ivStart = new Int32Array(n + 1)
    for (let c = 0; c < n; c++) this.ivStart[c + 1] = this.ivStart[c] + counts[c]
    this.ivData = new Float32Array(this.ivStart[n] * 2)
    this.maxTop = new Float32Array(n).fill(-Infinity)
    const fill = new Int32Array(n)
    this.prisms.forEach((p) =>
      this.raster(p, (c) => {
        const k = this.ivStart[c] + fill[c]++
        this.ivData[2 * k] = p.base
        this.ivData[2 * k + 1] = p.top
        if (p.top > this.maxTop[c]) this.maxTop[c] = p.top
      }),
    )
  }

  static load(dir: string): GameMap {
    const world = JSON.parse(readFileSync(join(dir, "v2/world.json"), "utf8"))
    const buf = readFileSync(join(dir, "v2/terrain.i16"))
    return new GameMap(world, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  }

  /** Even-odd scanline fill of ring + holes onto cell centres. */
  private raster(p: Prism, visit: (cell: number) => void) {
    const polys = [p.ring, ...p.holes]
    let y0 = Infinity, y1 = -Infinity
    for (let k = 1; k < p.ring.length; k += 2) (y0 = Math.min(y0, p.ring[k])), (y1 = Math.max(y1, p.ring[k]))
    const j0 = Math.max(0, Math.ceil(y0 - this.minY)), j1 = Math.min(this.ny - 1, Math.floor(y1 - this.minY))
    const xs: number[] = []
    for (let j = j0; j <= j1; j++) {
      const y = this.minY + j
      xs.length = 0
      for (const r of polys) {
        const m = r.length / 2
        for (let a = 0, b = m - 1; a < m; b = a++) {
          const ya = r[2 * a + 1], yb = r[2 * b + 1]
          if (ya > y !== yb > y) xs.push(r[2 * a] + ((y - ya) * (r[2 * b] - r[2 * a])) / (yb - ya))
        }
      }
      xs.sort((u, v) => u - v)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil(xs[k] - this.minX)), i1 = Math.min(this.nx - 1, Math.floor(xs[k + 1] - this.minX))
        for (let i = i0; i <= i1; i++) visit(j * this.nx + i)
      }
    }
  }

  cellOf(x: number, y: number): number {
    const i = Math.round(x - this.minX), j = Math.round(y - this.minY)
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1
    return j * this.nx + i
  }

  /** Bilinear terrain height. */
  groundAt(x: number, y: number): number {
    let fx = x - this.minX, fy = y - this.minY
    fx = Math.min(Math.max(fx, 0), this.nx - 1.001)
    fy = Math.min(Math.max(fy, 0), this.ny - 1.001)
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j
    const g = this.ground, o = j * this.nx + i
    return g[o] * (1 - u) * (1 - v) + g[o + 1] * u * (1 - v) + g[o + this.nx] * (1 - u) * v + g[o + this.nx + 1] * u * v
  }

  /** Is the point inside a prism (solid)? */
  solidAt(x: number, y: number, z: number): boolean {
    const c = this.cellOf(x, y)
    if (c < 0 || z > this.maxTop[c]) return false
    for (let k = this.ivStart[c]; k < this.ivStart[c + 1]; k++) if (z >= this.ivData[2 * k] && z <= this.ivData[2 * k + 1]) return true
    return false
  }

  /** Highest standable surface at (x, y) not above zMax (terrain or a prism top). */
  surfaceAt(x: number, y: number, zMax = Infinity): number {
    let s = this.groundAt(x, y)
    const c = this.cellOf(x, y)
    if (c < 0) return s
    for (let k = this.ivStart[c]; k < this.ivStart[c + 1]; k++) {
      const top = this.ivData[2 * k + 1]
      if (top > s && top <= zMax) s = top
    }
    return s
  }

  /**
   * Line of sight for shots: true if the segment a→b clears prisms and terrain (trees ignored:
   * they do not stop shots). Samples every `step` metres; the first/last `skip` metres are ignored.
   */
  los(a: number[], b: number[], step = 0.5, skip = 0.5): boolean {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]
    const L = Math.hypot(dx, dy, dz)
    if (L < 1e-6) return true
    const n = Math.ceil(L / step)
    const k0 = Math.ceil((skip / L) * n), k1 = n - k0
    for (let k = k0; k <= k1; k++) {
      const f = k / n
      const x = a[0] + dx * f, y = a[1] + dy * f, z = a[2] + dz * f
      if (z < this.groundAt(x, y) - 0.05) return false
      const c = this.cellOf(x, y)
      if (c < 0 || z > this.maxTop[c]) continue
      for (let q = this.ivStart[c]; q < this.ivStart[c + 1]; q++) if (z >= this.ivData[2 * q] && z <= this.ivData[2 * q + 1]) return false
    }
    return true
  }

  /** Distance from a along a horizontal heading (fixed z) to the first wall, up to maxD. */
  rayWall(a: number[], yaw: number, maxD: number, step = 1): number {
    const cx = Math.cos(yaw), cy = Math.sin(yaw)
    for (let d = step; d <= maxD; d += step) if (this.solidAt(a[0] + cx * d, a[1] + cy * d, a[2])) return d
    return maxD
  }
}
