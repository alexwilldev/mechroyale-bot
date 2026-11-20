import { describe, expect, test } from "bun:test"
import { GameMap } from "../src/world/map.ts"
import { Nav } from "../src/world/nav.ts"

const map = GameMap.load("kit/arena")
const nav = new Nav(map)

// a tall building and a point at its footprint centroid
const tall = map.prisms.find((p) => p.kind === "building" && p.top - p.base > 20 && p.holes.length === 0)!
const n = tall.ring.length / 2
let cx = 0, cy = 0
for (let k = 0; k < n; k++) (cx += tall.ring[2 * k]), (cy += tall.ring[2 * k + 1])
cx /= n
cy /= n

describe("GameMap", () => {
  test("terrain loads with plausible heights", () => {
    expect(map.ground.length).toBe(map.nx * map.ny)
    const h = map.groundAt(0, 0)
    expect(Math.abs(h)).toBeLessThan(5) // origin is the height datum
  })
  test("building is solid inside, empty above", () => {
    expect(map.solidAt(cx, cy, (tall.base + tall.top) / 2)).toBe(true)
    expect(map.solidAt(cx, cy, tall.top + 1)).toBe(false)
    expect(map.surfaceAt(cx, cy)).toBeCloseTo(tall.top, 1)
  })
  test("LOS blocked through a building, clear above it", () => {
    const z = tall.base + 4
    expect(map.los([cx - 150, cy, z], [cx + 150, cy, z])).toBe(false)
    expect(map.los([cx - 150, cy, tall.top + 3], [cx + 150, cy, tall.top + 3])).toBe(true)
  })
  test("LOS is fast", () => {
    const t = performance.now()
    for (let k = 0; k < 2000; k++) map.los([-200 + k * 0.1, -50, 8], [150, 60, 5])
    expect((performance.now() - t) / 2000).toBeLessThan(0.05) // < 50 µs each
  })
})

describe("Nav", () => {
  test("building footprint is not walkable", () => {
    expect(nav.isFree(cx, cy)).toBe(false)
  })
  test("path waypoints are all walkable and avoid the building", () => {
    const s = nav.center(nav.nearestFree(cx - 120, cy))
    const g = nav.center(nav.nearestFree(cx + 120, cy))
    const p = nav.path(s[0], s[1], g[0], g[1], 60000, false)
    expect(p).not.toBeNull()
    for (const w of p!.slice(0, -1)) expect(nav.isFree(w[0], w[1])).toBe(true)
  })
  test("nearestFree escapes a blocked point", () => {
    const k = nav.nearestFree(cx, cy, 200)
    expect(k).toBeGreaterThanOrEqual(0)
    expect(nav.free[k]).toBe(1)
  })
})
