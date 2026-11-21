/**
 * Ground navigation grid over the GameMap + A*. A nav cell is walkable when a mech standing on
 * its surface has `clearance` metres free of walls around it and headroom above. Edges respect
 * step-up/slope going uphill; going downhill is always allowed (falling).
 */
import type { GameMap } from "./map.ts"

export type NavOpts = { cell: number; clearance: number; stepUp: number; maxSlopeDeg: number; headroom: number; edgeMargin: number }
export const defaultNavOpts: NavOpts = { cell: 3, clearance: 2.3, stepUp: 1.2, maxSlopeDeg: 50, headroom: 9, edgeMargin: 4 }

export class Nav {
  readonly W: number
  readonly H: number
  readonly x0: number
  readonly y0: number
  readonly cell: number
  readonly free: Uint8Array
  readonly surf: Float32Array
  private readonly slopeTan: number
  private readonly stepUp: number
  // A* scratch
  private g: Float32Array
  private from: Int32Array
  private stamp: Uint32Array
  private closed: Uint32Array
  private gen = 0
  private heap: Int32Array
  private heapF: Float32Array

  constructor(readonly map: GameMap, o: NavOpts = defaultNavOpts) {
    const b = map.bounds
    this.cell = o.cell
    this.x0 = b.minX
    this.y0 = b.minY
    this.W = Math.ceil((b.maxX - b.minX) / o.cell)
    this.H = Math.ceil((b.maxY - b.minY) / o.cell)
    const n = this.W * this.H
    this.free = new Uint8Array(n)
    this.surf = new Float32Array(n)
    this.slopeTan = Math.tan((o.maxSlopeDeg * Math.PI) / 180)
    this.stepUp = o.stepUp
    const r = Math.ceil(o.clearance)
    for (let cy = 0; cy < this.H; cy++)
      for (let cx = 0; cx < this.W; cx++) {
        const k = cy * this.W + cx
        const x = this.x0 + (cx + 0.5) * o.cell, y = this.y0 + (cy + 0.5) * o.cell
        // surface: terrain, raised by any prism top within a step of it
        let s = map.groundAt(x, y)
        const c0 = map.cellOf(x, y)
        if (c0 >= 0)
          for (let changed = true; changed; ) {
            changed = false
            for (let q = map.ivStart[c0]; q < map.ivStart[c0 + 1]; q++) {
              const top = map.ivData[2 * q + 1], base = map.ivData[2 * q]
              if (top > s && top <= s + o.stepUp && base <= s + 0.1) (s = top), (changed = true)
            }
          }
        this.surf[k] = s
        if (x < b.minX + o.edgeMargin || x > b.maxX - o.edgeMargin || y < b.minY + o.edgeMargin || y > b.maxY - o.edgeMargin) continue
        let ok = true
        for (let dy = -r; dy <= r && ok; dy++)
          for (let dx = -r; dx <= r && ok; dx++) {
            if (dx * dx + dy * dy > o.clearance * o.clearance) continue
            const c = map.cellOf(x + dx, y + dy)
            if (c < 0) continue
            for (let q = map.ivStart[c]; q < map.ivStart[c + 1]; q++) {
              const base = map.ivData[2 * q], top = map.ivData[2 * q + 1]
              if (top > s + o.stepUp && base < s + o.headroom) {
                ok = false
                break
              }
            }
          }
        this.free[k] = ok ? 1 : 0
      }
    this.g = new Float32Array(n)
    this.from = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
    this.heap = new Int32Array(n * 2)
    this.heapF = new Float32Array(n * 2)
  }

  idx(x: number, y: number): number {
    const cx = Math.floor((x - this.x0) / this.cell), cy = Math.floor((y - this.y0) / this.cell)
    if (cx < 0 || cy < 0 || cx >= this.W || cy >= this.H) return -1
    return cy * this.W + cx
  }
  center(k: number): [number, number] {
    return [this.x0 + ((k % this.W) + 0.5) * this.cell, this.y0 + (Math.floor(k / this.W) + 0.5) * this.cell]
  }
  isFree(x: number, y: number): boolean {
    const k = this.idx(x, y)
    return k >= 0 && this.free[k] === 1
  }

  /** Nearest walkable cell to (x, y) within maxR metres (ring search), or -1. */
  nearestFree(x: number, y: number, maxR = 40): number {
    const k = this.idx(x, y)
    if (k >= 0 && this.free[k]) return k
    const cx = Math.floor((x - this.x0) / this.cell), cy = Math.floor((y - this.y0) / this.cell)
    const R = Math.ceil(maxR / this.cell)
    let best = -1, bd = Infinity
    for (let rr = 1; rr <= R; rr++) {
      for (let dy = -rr; dy <= rr; dy++)
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue
          const ax = cx + dx, ay = cy + dy
          if (ax < 0 || ay < 0 || ax >= this.W || ay >= this.H) continue
          const q = ay * this.W + ax
          if (!this.free[q]) continue
          const d = dx * dx + dy * dy
          if (d < bd) (bd = d), (best = q)
        }
      if (best >= 0) return best
    }
    return -1
  }

  private canStep(a: number, b: number, dist: number): boolean {
    const dh = this.surf[b] - this.surf[a]
    return dh <= Math.max(this.stepUp, this.slopeTan * dist)
  }

  /**
   * A* from (sx, sy) to (tx, ty). Returns world waypoints (cell centres, first one after the start)
   * ending at the goal point, or null if unreachable within maxExpand expansions (then the best
   * partial path toward the goal is returned when partial = true).
   */
  path(sx: number, sy: number, tx: number, ty: number, maxExpand = 30000, partial = true, deadline = Infinity): number[][] | null {
    const s = this.nearestFree(sx, sy, 15), t = this.nearestFree(tx, ty, 40)
    if (s < 0 || t < 0) return null
    if (s === t) return [[tx, ty]]
    const W = this.W
    const gen = ++this.gen
    const tcx = t % W, tcy = Math.floor(t / W)
    const h = (k: number) => {
      const dx = Math.abs((k % W) - tcx), dy = Math.abs(Math.floor(k / W) - tcy)
      return (Math.max(dx, dy) + 0.41421356 * Math.min(dx, dy)) * this.cell
    }
    let hn = 0
    const push = (k: number, f: number) => {
      let i = hn++
      while (i > 0) {
        const p = (i - 1) >> 1
        if (this.heapF[p] <= f) break
        this.heap[i] = this.heap[p]
        this.heapF[i] = this.heapF[p]
        i = p
      }
      this.heap[i] = k
      this.heapF[i] = f
    }
    const pop = (): number => {
      const top = this.heap[0]
      const k = this.heap[--hn], f = this.heapF[hn]
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= hn) break
        if (c + 1 < hn && this.heapF[c + 1] < this.heapF[c]) c++
        if (this.heapF[c] >= f) break
        this.heap[i] = this.heap[c]
        this.heapF[i] = this.heapF[c]
        i = c
      }
      this.heap[i] = k
      this.heapF[i] = f
      return top
    }
    this.g[s] = 0
    this.stamp[s] = gen
    this.from[s] = -1
    push(s, h(s))
    let best = s, bestH = h(s), expanded = 0, found = false
    const D = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1]
    while (hn > 0) {
      const k = pop()
      if (this.closed[k] === gen) continue
      this.closed[k] = gen
      if (k === t) {
        found = true
        break
      }
      const hk = h(k)
      if (hk < bestH) (bestH = hk), (best = k)
      if (++expanded > maxExpand) break
      if ((expanded & 255) === 0 && performance.now() > deadline) break // out of time: return the best partial path
      const kx = k % W, ky = Math.floor(k / W)
      for (let d = 0; d < 16; d += 2) {
        const nx = kx + D[d], ny = ky + D[d + 1]
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue
        const q = ny * W + nx
        if (!this.free[q] || this.closed[q] === gen) continue
        const diag = d >= 8
        if (diag && (!this.free[ky * W + nx] || !this.free[ny * W + kx])) continue
        const step = diag ? this.cell * 1.41421356 : this.cell
        if (!this.canStep(k, q, step)) continue
        const ng = this.g[k] + step
        if (this.stamp[q] === gen && ng >= this.g[q]) continue
        this.stamp[q] = gen
        this.g[q] = ng
        this.from[q] = k
        push(q, ng + h(q))
      }
    }
    if (!found && !partial) return null
    const end = found ? t : best
    const cells: number[] = []
    for (let k = end; k !== -1 && k !== s; k = this.from[k]) cells.push(k)
    cells.reverse()
    const pts = cells.map((k) => this.center(k) as number[])
    if (found) pts.push([tx, ty])
    return pts
  }

  /** Straight walk a→b stays on free cells (sampled every half cell). */
  lineFree(ax: number, ay: number, bx: number, by: number): boolean {
    const L = Math.hypot(bx - ax, by - ay)
    const n = Math.ceil(L / (this.cell * 0.5))
    for (let i = 1; i <= n; i++) {
      const f = i / n
      if (!this.isFree(ax + (bx - ax) * f, ay + (by - ay) * f)) return false
    }
    return true
  }
}
