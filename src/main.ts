/** Phase 0 "zone-centre turtle": hold the safe zone, farm cubes/loot when quiet, lead-aim and face threats. */
import { type ActorObs, type BotAction, draw, type Hello, log, type Observation, run, type WeaponObs } from "./mechfight.ts"
import { P } from "./params.ts"
import { GameMap } from "./world/map.ts"
import { defaultNavOpts, Nav } from "./world/nav.ts"

type V3 = number[]
const TAU = Math.PI * 2
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
const hdist = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1])
const yawTo = (a: V3, b: V3) => Math.atan2(b[1] - a[1], b[0] - a[0])

/** Time t>0 for a projectile of speed s from S to hit P+V·t, or null. */
function intercept(S: V3, Pp: V3, V: V3, s: number): number | null {
  const d = [Pp[0] - S[0], Pp[1] - S[1], Pp[2] - S[2]]
  const a = V[0] ** 2 + V[1] ** 2 + V[2] ** 2 - s * s
  const b = 2 * (d[0] * V[0] + d[1] * V[1] + d[2] * V[2])
  const c = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  if (Math.abs(a) < 1e-6) return c > 0 && b < 0 ? -c / b : null
  const disc = b * b - 4 * a * c
  if (disc < 0) return null
  const r = Math.sqrt(disc)
  const ts = [(-b - r) / (2 * a), (-b + r) / (2 * a)].filter((t) => t > 0)
  return ts.length ? Math.min(...ts) : null
}

/** Low-arc launch pitch to hit (horizontal d, height h) at speed v under gravity g. */
function ballisticPitch(d: number, h: number, v: number, g: number): number | null {
  const v2 = v * v
  const disc = v2 * v2 - g * (g * d * d + 2 * h * v2)
  if (disc < 0) return null
  return Math.atan2(v2 - Math.sqrt(disc), g * d)
}

export class Turtle {
  p: typeof P = P
  name = "mr-turtle"
  cfg: Hello["config"]
  strafeSign = 1
  strafeUntil = 0
  lastDamage = { t: -99, bearing: 0, by: -1 as number | null }
  lastSound = { t: -99, bearing: 0 }
  stuckT = 0
  unstickUntil = 0
  unstickYaw = 0
  scanYaw = 0
  prevAlive = 16
  ffa = false
  kills = 0
  map: GameMap | null = null
  nav: Nav | null = null
  route: { goal: V3; pts: number[][]; t: number } | null = null
  maxMs = 0
  lastTarget = -1
  lastPlanT = -99
  drones = new Map<number, { pos: V3; t: number }>()
  lastStep = { t: -99, bearing: 0 }
  peekPos: V3 | null = null
  peekCover: V3 | null = null
  peekCoverT = -99
  iso: V3 | null = null
  isoT = -99
  rearBy = { id: -1, t: -99 }
  visited = new Set<string>()
  explore: V3 | null = null
  exploreT = 0
  otherDeaths = 0
  lasers = new Map<number, { pos: V3; t: number }>()
  roofs: { id: number; cx: number; cy: number; top: number; launch: number[] }[] = []
  roofNow: { id: number; cx: number; cy: number; top: number; launch: number[] } | null = null
  badRoofs = new Set<number>()
  climbT = 0
  fightBoost = false
  t0 = 0
  cover: V3 | null = null
  coverT = -99
  /** Over the soft per-tick budget: skip optional work (replans, cover/hold searches). */
  late(ms = this.p.softBudgetMs) {
    return performance.now() - this.t0 > ms
  }
  hold: V3 | null = null
  holdUntil = 0
  dodgeSign = 1
  dodgeFlipT = 0
  roam: V3 | null = null
  roamUntil = 0

  constructor(h: Hello, over: Partial<typeof P> = {}) {
    this.p = { ...P, ...over }
    this.cfg = h.config
    try {
      this.map = GameMap.load(h.map.dir)
      const m = h.config.mech
      this.nav = new Nav(this.map, { ...defaultNavOpts, stepUp: m.step_up ?? 1.2, maxSlopeDeg: m.max_slope_deg ?? 50 })
      // candidate roofs to camp on: big enough, climbable, with a walkable launch point next to the wall
      this.map.prisms.forEach((p, id) => {
        if (p.kind !== "building") return
        const m = p.ring.length / 2
        let cx = 0, cy = 0, area = 0
        for (let a = 0, b = m - 1; a < m; b = a++) {
          cx += p.ring[2 * a]
          cy += p.ring[2 * a + 1]
          area += p.ring[2 * b] * p.ring[2 * a + 1] - p.ring[2 * a] * p.ring[2 * b + 1]
        }
        cx /= m
        cy /= m
        area = Math.abs(area) / 2
        const top = this.map!.surfaceAt(cx, cy), g = this.map!.groundAt(cx, cy)
        if (area < this.p.roofArea || top - g < this.p.roofMin || top - g > this.p.roofMax) return
        const k = this.nav!.nearestFree(cx, cy, 80)
        if (k < 0) return
        this.roofs.push({ id, cx, cy, top, launch: this.nav!.center(k) })
      })
      // warm up the JIT on the hot paths while we still have the hello budget
      const b = this.map.bounds
      for (let k = 0; k < 60; k++) {
        const x1 = b.minX + ((k * 97) % 900), y1 = b.minY + ((k * 61) % 600)
        const x2 = b.minX + ((k * 53) % 900), y2 = b.minY + ((k * 89) % 600)
        this.nav.path(x1, y1, x2, y2, this.p.maxExpand, true)
        this.nav.lineFree(x1, y1, x2, y2)
        this.map.los([x1, y1, 8], [x2, y2, 5])
      }
    } catch (e) {
      log("map/nav load failed, falling back to straight-line movement:", e)
    }
  }

  /** Direction to walk toward goal: follow an A* route, string-pulled to the farthest visible waypoint. */
  steer(pos: V3, goal: V3, t: number): number[] {
    const nav = this.nav
    const direct = () => {
      const y = yawTo(pos, goal)
      return [Math.cos(y), Math.sin(y)]
    }
    if (!nav) return direct()
    // on a roof or ledge (not on the ground grid): walk straight, we'll drop off
    const k = nav.idx(pos[0], pos[1])
    if (k < 0 || (!nav.free[k] && pos[2] > nav.surf[k] + 3)) return direct()
    if (nav.lineFree(pos[0], pos[1], goal[0], goal[1]) && hdist(pos, goal) < 60) {
      this.route = null
      return direct()
    }
    const r = this.route
    const stale = !r || hdist(r.goal, goal) > 6 || t - r.t > this.p.replanEvery || !r.pts.length || hdist(pos, r.pts[0]) > 12
    if (stale && t - this.lastPlanT >= this.p.minReplan && !this.late()) {
      this.lastPlanT = t
      const pts = nav.path(pos[0], pos[1], goal[0], goal[1], this.p.maxExpand, true, this.t0 + this.p.hardBudgetMs)
      this.route = pts && pts.length ? { goal: [...goal], pts, t } : null
    }
    const rt = this.route
    if (!rt) return direct()
    while (rt.pts.length > 1 && hdist(pos, rt.pts[0]) < 2.5) rt.pts.shift()
    let aimPt = rt.pts[0]
    for (let i = Math.min(rt.pts.length - 1, 8); i > 0; i--)
      if (nav.lineFree(pos[0], pos[1], rt.pts[i][0], rt.pts[i][1])) {
        aimPt = rt.pts[i]
        break
      }
    const y = yawTo(pos, aimPt)
    return [Math.cos(y), Math.sin(y)]
  }

  /** Waypoint toward the least-visited ground (50 m cells) inside the next circle. */
  explorePoint(pos: V3, t: number, nc: V3, nr: number): V3 {
    if (this.explore && t < this.exploreT && hdist(pos, this.explore) > 15) return this.explore
    const key = (x: number, y: number) => `${Math.round(x / 50)},${Math.round(y / 50)}`
    let best: V3 = nc, bestS = -Infinity
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * TAU, r = 60 + Math.random() * 180
      const x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
      if (hdist([x, y], nc) > nr * 0.85 || (this.nav && !this.nav.isFree(x, y))) continue
      let fresh = 0
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) if (!this.visited.has(key(x + dx * 50, y + dy * 50))) fresh++
      const s = fresh - r * 0.01
      if (s > bestS) (bestS = s), (best = [x, y, 0])
    }
    this.explore = best
    this.exploreT = t + 12
    return best
  }

  /** Target-score bonus for 'easy kills': backs turned, weapon counters, already bleeding in the zone. */
  predatorBonus(m: ActorObs, me: Observation["self"], pos: V3, obs: Observation): number {
    let b = 0
    // backstab: they are facing away from us (not shooting back, rear hits x1.5)
    if (this.p.backstab && Math.abs(wrap(m.aim[0] - yawTo(m.pos, pos))) > Math.PI / 2) b += this.p.backstab
    const ws = m.weapons ?? []
    const mine = me.weapons.map((w) => w?.kind)
    if (this.p.counterBonus) {
      if (mine.includes("laser") && ws.includes("mortar")) b += this.p.counterBonus // cook-off +60%
      if (mine.includes("lightning") && ws.includes("laser") && hdist(m.pos, pos) < 45) b += this.p.counterBonus // short
    }
    // zone victims: already losing hp every second
    const zc = obs.zone.center
    if (this.p.zoneVictim && hdist(m.pos, [zc[0], zc[1]]) > obs.zone.radius) b += this.p.zoneVictim
    return b
  }

  /** Point beyond a nearby drone (drone between us and the threat), so a pursuer crosses its 45 m zone. */
  droneLure(pos: V3, threat: V3, t: number): V3 | null {
    let best: V3 | null = null, bd = Infinity
    for (const [id, d] of this.drones) {
      if (t - d.t > 90) {
        this.drones.delete(id)
        continue
      }
      const dist = hdist(pos, d.pos)
      if (dist > 140 || dist < 20) continue
      const ay = yawTo(threat, d.pos)
      const p = [d.pos[0] + Math.cos(ay) * 40, d.pos[1] + Math.sin(ay) * 40, d.pos[2]]
      if (this.nav && !this.nav.isFree(p[0], p[1])) continue
      if (hdist(threat, d.pos) < dist) continue // drone must be on our side, not theirs
      if (dist < bd) (bd = dist), (best = p)
    }
    return best
  }

  /** Nearest usable roof whose centre is inside the safe circle. */
  pickRoof(pos: V3, center: V3, safeR: number) {
    let best = null, bd = Infinity
    for (const r of this.roofs) {
      if (this.badRoofs.has(r.id) || hdist([r.cx, r.cy], center) > safeR) continue
      const d = hdist(pos, [r.cx, r.cy])
      if (d < bd && d < this.p.roofSearch) (bd = d), (best = r)
    }
    return best
  }

  /** Walkable point near pos (inside the safe circle) with the fewest open sight lines around it. */
  findHoldSpot(pos: V3, center: V3, safeR: number): V3 | null {
    if (!this.map || !this.nav) return null
    let best: V3 | null = null, bestCost = Infinity
    for (let k = 0; k < this.p.holdSamples && !this.late(this.p.hardBudgetMs); k++) {
      const a = Math.random() * TAU, r = k === 0 ? 0 : 6 + Math.random() * this.p.holdSearch
      const x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
      if (hdist([x, y], center) > safeR || !this.nav.isFree(x, y)) continue
      const s = this.map.surfaceAt(x, y, pos[2] + 2)
      const eye = [x, y, s + 8]
      let open = 0
      for (let d = 0; d < 8; d++) {
        const b = (d / 8) * TAU
        if (this.map.los(eye, [x + Math.cos(b) * this.p.holdRay, y + Math.sin(b) * this.p.holdRay, s + 8], 1)) open++
      }
      const cost = open * 10 + r * 0.3
      if (cost < bestCost) (bestCost = cost), (best = [x, y, s])
    }
    return best
  }

  /** A supply drop worth going for: close enough to reach about when it lands, not held by someone else. */
  pickDrop(obs: Observation, pos: V3): { pos: V3; radius: number } | null {
    const speed = obs.self.stats.walk_speed ?? 11.7
    let best: { pos: V3; radius: number } | null = null, bd = Infinity
    for (const d of obs.drops ?? []) {
      const dist = hdist(pos, d.pos)
      if (dist > this.p.dropRange) continue
      if (d.holder != null && d.holder !== obs.self.id && d.progress > 0) continue
      if (dist / speed > d.lands_in + this.p.dropLate) continue // someone nearer will have it by then
      if (dist < bd) (bd = dist), (best = { pos: d.pos, radius: d.radius ?? 8 })
    }
    return best
  }

  /** Nearby walkable point hidden from every `others` threat, preferring spots that still see `target`. */
  findIsolation(pos: V3, others: V3[], target: V3): V3 | null {
    if (!this.map || !this.nav) return null
    let best: V3 | null = null, bestCost = Infinity
    for (const r of [8, 15, 24])
      for (let k = 0; k < 12 && !this.late(this.p.hardBudgetMs); k++) {
        const a = (k / 12) * TAU
        const x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
        if (!this.nav.isFree(x, y) || !this.nav.lineFree(pos[0], pos[1], x, y)) continue
        const zc = this.map.surfaceAt(x, y, pos[2] + 2)
        const c = [x, y, zc + 4.5]
        if (others.some((o) => this.map!.los([o[0], o[1], o[2] + 8], c))) continue
        const seesTarget = this.map.los([x, y, zc + 7], [target[0], target[1], target[2] + 4.5])
        const cost = r - (seesTarget ? 12 : 0)
        if (cost < bestCost) (bestCost = cost), (best = [x, y, zc])
      }
    return best
  }

  /** A nearby walkable point hidden from `threat` (by buildings), or null. */
  findCover(pos: V3, threat: V3): V3 | null {
    if (!this.map || !this.nav) return null
    const eye = [threat[0], threat[1], threat[2] + 8]
    const away = yawTo(threat, pos)
    let best: V3 | null = null, bestCost = Infinity
    for (const r of [10, 18, 28])
      for (let k = 0; k < 12 && !this.late(this.p.hardBudgetMs); k++) {
        const a = (k / 12) * TAU
        const x = pos[0] + Math.cos(a) * r, y = pos[1] + Math.sin(a) * r
        if (!this.nav.isFree(x, y) || !this.nav.lineFree(pos[0], pos[1], x, y)) continue
        const zc = this.map.surfaceAt(x, y, pos[2] + 2)
        if (this.map.los(eye, [x, y, zc + 4.5])) continue
        // prefer short moves that don't run toward the threat
        const cost = r + 15 * Math.abs(wrap(a - away))
        if (cost < bestCost) (bestCost = cost), (best = [x, y, zc])
      }
    return best
  }

  /** Clear shot line from muzzle to point (true when no map). */
  clear(a: V3, b: V3): boolean {
    return !this.map || this.map.los(a, b)
  }

  act(obs: Observation): BotAction {
    const t0 = performance.now()
    this.t0 = t0
    const me = obs.self
    const t = obs.t
    const pos = me.pos
    const act: BotAction = { fire: [false, false] }

    // --- bookkeeping: events, sounds, mode detection ---
    let killsNow = 0
    for (const e of obs.events) {
      if (e.type === "damaged" && e.bearing != null) {
        this.lastDamage = { t, bearing: e.bearing, by: e.by }
        if (e.rear && e.by != null) this.rearBy = { id: e.by, t }
      }
      if (e.type === "kill") killsNow++
    }
    this.kills += killsNow
    // FFA detection: mechs dying without our kills means others fight each other (practice house bots never do)
    if (obs.alive < this.prevAlive - killsNow) this.otherDeaths += this.prevAlive - killsNow - obs.alive
    if (!this.ffa && this.otherDeaths >= this.p.ffaDeaths) {
      this.ffa = true
      this.p = { ...this.p, ...this.p.ffaOverrides } // switch to the free-for-all survival profile
    }
    this.prevAlive = obs.alive
    // remember the most threatening recent sound: movement nearby (an approaching hunter) beats distant gunfire
    let bestPri = 0
    for (const s of obs.sounds) {
      if (s.kind === "drop" || s.kind === "crate" || s.kind === "npc_gun" || s.dist === "far" || s.age > 0.6) continue
      const pri = s.kind === "step" || s.kind === "boost" || s.kind === "jet" || s.kind === "laser_charge" ? 3 : s.dist === "near" ? 2 : 1
      if (pri > bestPri) (bestPri = pri), (this.lastSound = { t, bearing: s.bearing })
      if (s.kind === "step" || s.kind === "boost" || s.kind === "jet") this.lastStep = { t, bearing: s.bearing }
    }

    if (obs.offer) {
      const ids = obs.offer.choices.map((c) => c.id)
      let best = 0
      let bestRank = 1e9
      ids.forEach((id, i) => {
        const r = this.p.upgradeOrder.indexOf(id)
        const rank = r < 0 ? 999 : r
        if (rank < bestRank) (bestRank = rank), (best = i)
      })
      act.pick = best
    }

    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) this.visited.add(`${Math.round(pos[0] / 50) + dx},${Math.round(pos[1] / 50) + dy}`)
    // --- laser memory: the laser roughly doubles our kill rate, so remember every one we see ---
    const hasLaser = me.weapons.some((w) => w?.kind === "laser")
    for (const p of obs.pickups) if (p.kind === "laser") this.lasers.set(p.id, { pos: p.pos, t })
    for (const [id, l] of this.lasers)
      if (t - l.t > this.p.laserMemory || (hdist(pos, l.pos) < 6 && !obs.pickups.some((p) => p.id === id))) this.lasers.delete(id)
    let laserGoal: V3 | null = null
    if (!hasLaser && me.hp / me.max_hp > this.p.retreatHp) {
      let bd = t < 60 ? this.p.laserDetourEarly : this.p.laserDetour
      for (const l of this.lasers.values()) {
        const d = hdist(pos, l.pos)
        const zc = obs.zone.center, safe = hdist(l.pos, [zc[0], zc[1]]) < obs.zone.radius - 25 && hdist(l.pos, obs.zone.next_center) < obs.zone.next_radius + 40
        if (d < bd && safe && Math.abs(l.pos[2] - pos[2]) < 6) (bd = d), (laserGoal = l.pos)
      }
    }

    // --- target selection ---
    // engage only mechs within engageRange, plus anyone who shot us recently (FFA survival lever)
    const mechs = obs.mechs.filter(
      (m) => m.kind === "mech" && (hdist(m.pos, pos) <= this.p.engageRange || (m.id === this.lastDamage.by && t - this.lastDamage.t < 6)),
    )
    const npcs = obs.mechs.filter((m) => m.kind === "npc")
    let target: ActorObs | null = null
    if (mechs.length) {
      // focus fire: weakest reachable enemy, strongly preferring ones we can actually shoot
      const eyeP = [pos[0], pos[1], pos[2] + (me.stats.muzzle_height ?? 7)]
      const score = (m: ActorObs) =>
        (m.hp ?? 1400) +
        hdist(m.pos, pos) * this.p.targetDistW -
        (m.id === this.lastDamage.by && t - this.lastDamage.t < 3 ? this.p.attackerBonus : 0) -
        (m.id === this.rearBy.id && t - this.rearBy.t < 2 ? this.p.rearBonus : 0) -
        (m.id === this.lastTarget ? this.p.lockBonus : 0) -
        this.predatorBonus(m, me, pos, obs) +
        (this.clear(eyeP, [m.pos[0], m.pos[1], m.pos[2] + 4.5]) ? 0 : 900)
      target = mechs.reduce((a, b) => (score(a) <= score(b) ? a : b))
      this.lastTarget = target.id
    }
    const quiet = !target && t - this.lastDamage.t > 3
    let crateTarget: { id: number; pos: V3; hp?: number } | null = null
    if (!target) {
      const npcAttacker = npcs.find((n) => n.id === this.lastDamage.by && t - this.lastDamage.t < 3)
      // only pick fights with drones when healthy; always answer one that is shooting us
      const healthy = me.hp / me.max_hp >= this.p.npcHuntHp
      const npcNear = healthy
        ? npcs.filter((n) => hdist(n.pos, pos) < this.p.npcRange).sort((a, b) => hdist(a.pos, pos) - hdist(b.pos, pos))[0]
        : undefined
      target = npcAttacker ?? npcNear ?? null
    }
    if (!target && quiet) {
      const eye = [pos[0], pos[1], pos[2] + (me.stats.muzzle_height ?? 7)]
      crateTarget =
        obs.crates
          .filter((c) => hdist(c.pos, pos) < this.p.crateShootRange)
          .sort((a, b) => hdist(a.pos, pos) - hdist(b.pos, pos))
          .find((c) => this.clear(eye, [c.pos[0], c.pos[1], c.pos[2] + 1.2])) ?? null
    }

    // --- movement goal ---
    const z = obs.zone
    const nc = [z.next_center[0], z.next_center[1], pos[2]]
    const dCenter = hdist(pos, nc)
    let goal: V3 | null = null
    let state = "hold"
    let dropGoal: { pos: V3; radius: number } | null = null
    let lure: V3 | null = null
    for (const o of obs.mechs) if (o.kind === "npc") this.drones.set(o.id, { pos: o.pos, t })
    if (z.next_radius <= this.p.endgameRadius) {
      if (dCenter > 1.5) goal = nc
      state = "endgame"
    } else if (dCenter > z.next_radius * this.p.zoneSafety || !me.in_zone) {
      goal = nc
      state = "rotate"
    } else if (!hasLaser && t < this.p.exploreUntil && me.hp / me.max_hp > this.p.retreatHp) {
      // unarmed: head for a remembered laser, else explore unseen ground to find one (fights drift along)
      goal = laserGoal ?? this.explorePoint(pos, t, nc, z.next_radius)
      state = laserGoal ? "seek-laser" : "explore"
    } else if (quiet && (dropGoal = this.pickDrop(obs, pos))) {
      // supply drop in reach with nobody around: stand in its ring until captured (3 cubes, full hp/energy)
      goal = hdist(pos, dropGoal.pos) > dropGoal.radius - 2.5 ? dropGoal.pos : null
      state = "drop"
    } else if (quiet && me.hp / me.max_hp < this.p.recoverHp) {
      // hurt and nobody in sight: stand still (silent) and regenerate, facing where the damage came from
      state = "recover"
    } else if (quiet) {
      // early game the whole current circle is fair game; later only what is inside the next one
      const zc = [z.center[0], z.center[1], 0]
      const early = t < z.shrink_start - 10
      const inPlay = (p: V3) => (early ? hdist(p, zc) < z.radius * 0.9 : hdist(p, nc) < z.next_radius * 0.9)
      const loot = [
        ...obs.cubes.filter((c) => hdist(c.pos, pos) < this.p.lootDetour).map((c) => ({ pos: c.pos, w: 1.2 })),
        ...obs.pickups
          .filter((p) => this.wantPickup(me.weapons, p.kind) > 0 && hdist(p.pos, pos) < this.p.pickupDetour)
          .map((p) => ({ pos: p.pos, w: 1 + this.p.weaponScore[p.kind] })),
        ...(crateTarget && hdist(crateTarget.pos, pos) > 25 ? [{ pos: crateTarget.pos, w: 0.8 }] : []),
      ]
        .filter((l) => inPlay(l.pos) && Math.abs(l.pos[2] - pos[2]) < 6)
        .sort((a, b) => hdist(a.pos, pos) / a.w - hdist(b.pos, pos) / b.w)[0]
      if (loot) {
        goal = loot.pos
        state = "loot"
      } else if (!me.weapons[1] || t < this.p.roamUntilT || (me.cubes < this.p.farmCubes && t < this.p.farmUntilT)) {
        // roam inside the safe area to find weapons and crates
        if (!this.roam || t > this.roamUntil || hdist(pos, this.roam) < 8) {
          const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * z.next_radius * 0.6
          this.roam = [z.next_center[0] + Math.cos(a) * r, z.next_center[1] + Math.sin(a) * r, 0]
          this.roamUntil = t + 20
        }
        goal = this.roam
        state = "roam"
      } else {
        // nothing to do: camp on a roof near the circle centre if we can, else wait at a covered spot
        const ground = this.map ? this.map.groundAt(pos[0], pos[1]) : pos[2]
        const onRoof = me.grounded && pos[2] > ground + this.p.roofMin - 1
        const r = this.p.useRoofs ? (this.roofNow && onRoof ? this.roofNow : this.pickRoof(pos, nc, z.next_radius * this.p.zoneSafety)) : null
        if (r && onRoof) {
          this.roofNow = r
          state = "roof"
          if (hdist(pos, [r.cx, r.cy]) > 5) goal = [r.cx, r.cy, r.top]
        } else if (r) {
          this.roofNow = r
          state = "to-roof"
          goal = r.launch
        } else {
        // re-search at most every 10 s (a failed search must not retry every tick)
        if (t > this.holdUntil || (this.hold && hdist(this.hold, nc) > z.next_radius * this.p.zoneSafety)) {
          if (this.late()) this.holdUntil = t + 0.5 // out of time this tick: try again shortly
          else (this.hold = this.findHoldSpot(pos, nc, z.next_radius * this.p.zoneSafety)), (this.holdUntil = t + 10)
        }
        if (this.hold && hdist(pos, this.hold) > 3) goal = this.hold
        state = "hold"
        }
      }
    }

    let mv = [0, 0]
    if (goal) mv = this.steer(pos, goal, t)
    if (target && target.kind === "mech") {
      const d = hdist(pos, target.pos)
      const ty0 = yawTo(pos, target.pos)
      const slots0 = me.weapons
      const gun = slots0.find((w) => w?.kind === "gun")
      const lightning = slots0.find((w) => w?.kind === "lightning")
      const laser = slots0.find((w) => w?.kind === "laser")
      const gunDown = !gun || (gun.reload ?? 0) > 0 || (gun.ammo ?? 1) === 0
      const otherReady =
        (laser && laser.cooldown <= 0.2) || (lightning && d < lightning.stats.range && me.energy > this.p.lightningEnergyFloor)
      const losing = me.hp / me.max_hp < this.p.retreatHp && (target.hp ?? 1400) > me.hp * 1.1
      const needCover = (gunDown && !otherReady) || losing
      // reuse a recent cover point; search again at most every 0.5 s and only with time left this tick
      if (needCover && (t - this.coverT > 0.5 || !this.cover) && !this.late()) (this.cover = this.findCover(pos, target.pos)), (this.coverT = t)
      const cover = needCover ? this.cover : null
      // more than one enemy has a line on us: slip behind cover from all but the current target (duel one at a time)
      let iso: V3 | null = null
      if (this.p.isolate && this.map && state !== "endgame") {
        const others = mechs.filter(
          (o) => o.id !== target.id && hdist(o.pos, pos) < 220 && this.map!.los([o.pos[0], o.pos[1], o.pos[2] + 8], [pos[0], pos[1], pos[2] + 4.5]),
        )
        if (others.length) {
          if (t - this.isoT > 0.5 && !this.late()) (this.iso = this.findIsolation(pos, others.map((o) => o.pos), target.pos)), (this.isoT = t)
          iso = this.iso
        } else this.iso = null
      }
      // laser peek: hide while the laser cools/charges, step back out to the last firing spot when nearly charged
      let peek: V3 | null = null, peekState = ""
      if (this.p.laserPeek && laser && this.map && state !== "endgame") {
        const tgtC = [target.pos[0], target.pos[1], target.pos[2] + 4.5]
        const losNow = this.map.los([pos[0], pos[1], pos[2] + 7], tgtC)
        if (losNow) this.peekPos = [...pos]
        const ready = laser.cooldown <= 0 && (laser.charge ?? 0) >= (laser.stats.charge ?? 0.75) * 0.8
        if (!ready) {
          if (t - this.peekCoverT > 0.5 && !this.late()) (this.peekCover = this.findCover(pos, target.pos)), (this.peekCoverT = t)
          if (this.peekCover) (peek = this.peekCover), (peekState = "peek-hide")
        } else if (!losNow && this.peekPos) (peek = this.peekPos), (peekState = "peek-out")
      }
      if (iso) {
        mv = this.steer(pos, iso, t)
        state = "isolate"
      } else if (peek) {
        mv = this.steer(pos, peek, t)
        state = peekState
      } else if (laserGoal && !losing && state !== "endgame") {
        const g = this.steer(pos, laserGoal, t)
        const py = ty0 + (this.strafeSign * Math.PI) / 2
        mv = [g[0] + Math.cos(py) * 0.3, g[1] + Math.sin(py) * 0.3]
        state = "fight-laser"
      } else if (losing && this.p.droneLure && (lure = this.droneLure(pos, target.pos, t))) {
        // losing: run past a drone so it engages whoever chases us
        mv = this.steer(pos, lure, t)
        state = "lure"
      } else if (cover && state !== "endgame") {
        mv = this.steer(pos, cover, t)
        state = losing ? "retreat" : "reload-cover"
      } else {
        if (t > this.strafeUntil) {
          this.strafeSign = Math.random() < 0.5 ? -1 : 1
          this.strafeUntil = t + this.p.strafeFlip * (0.6 + Math.random() * 0.8)
        }
        // hold our weapon's best range: close in with lightning, keep gun/laser distance otherwise
        // laser outranges everything and can't miss: fight from far so their bullets have time to miss us
        const want = lightning && me.energy > 25 ? this.p.lightningRange : laser ? this.p.laserRange : this.p.gunRange
        const radial = Math.max(-1, Math.min(1, (d - want) / (want * 0.5)))
        const py = ty0 + (this.strafeSign * Math.PI) / 2
        mv = [mv[0] * 0.4 + Math.cos(py) + radial * Math.cos(ty0), mv[1] * 0.4 + Math.sin(py) + radial * Math.sin(ty0)]
        // several enemies spread around us: back away from them so they all fall inside our front arc
        if (this.p.spreadBackoff > 0 && mechs.length > 1) {
          let sx = 0, sy = 0, maxOff = 0
          for (const o of mechs) {
            const a = yawTo(pos, o.pos)
            sx += Math.cos(a)
            sy += Math.sin(a)
            maxOff = Math.max(maxOff, Math.abs(wrap(a - ty0)))
          }
          if (maxOff > Math.PI / 2) {
            const away = Math.atan2(-sy, -sx)
            mv = [mv[0] + Math.cos(away) * this.p.spreadBackoff, mv[1] + Math.sin(away) * this.p.spreadBackoff]
            state = "fight-spread"
          }
        }
        state = state === "endgame" ? "endgame-fight" : "fight"
      }
    }

    // --- dodging: charged lasers aimed at us, mortar shells landing near us ---
    let dodge = false
    for (const m of mechs) {
      if (!m.charging) continue
      const off = Math.abs(wrap(m.aim[0] - yawTo(m.pos, pos)))
      if (off < this.p.laserDodgeYaw) {
        const py = yawTo(m.pos, pos) + (this.dodgeSign * Math.PI) / 2
        mv = [Math.cos(py) * 1.5 + mv[0] * 0.3, Math.sin(py) * 1.5 + mv[1] * 0.3]
        dodge = true
        state += "+dodgeL"
        break
      }
    }
    if (!dodge) {
      const g = this.cfg.weapons.mortar.gravity ?? 22
      const splash = (this.cfg.weapons.mortar.splash_radius ?? 7) + 4
      for (const p of obs.projectiles) {
        if (p.kind !== "mortar") continue
        // time until the shell falls to our height: z + vz t - g t²/2 = pos.z
        const a = -g / 2, b = p.vel[2], c = p.pos[2] - (pos[2] + 1)
        const disc = b * b - 4 * a * c
        if (disc < 0) continue
        const tl = (-b - Math.sqrt(disc)) / (2 * a)
        if (tl <= 0 || tl > 3) continue
        const land = [p.pos[0] + p.vel[0] * tl, p.pos[1] + p.vel[1] * tl, pos[2]]
        if (hdist(land, pos) < splash) {
          const ay = yawTo(land, pos)
          mv = [Math.cos(ay) * 1.5, Math.sin(ay) * 1.5]
          dodge = true
          state += "+dodgeM"
          break
        }
      }
    }
    if (t > this.dodgeFlipT) (this.dodgeSign = -this.dodgeSign), (this.dodgeFlipT = t + 1.5 + Math.random())

    // --- stuck handling: commanded move but not moving -> jump/jet and sidestep ---
    const speed = Math.hypot(me.vel[0], me.vel[1])
    const wantMove = Math.hypot(mv[0], mv[1]) > 0.3
    if (wantMove && speed < 1.5 && me.grounded) this.stuckT += 0.1
    else if (speed > 3) this.stuckT = 0
    if (this.stuckT > 0.6 && t > this.unstickUntil) {
      this.unstickUntil = t + 1.2
      this.unstickYaw = Math.atan2(mv[1], mv[0]) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2)
      this.stuckT = 0
    }
    let boost =
      !me.in_zone || (state === "rotate" && t > z.shrink_start - 10 && dCenter > z.next_radius) || (dodge && me.energy > this.p.dodgeEnergy)
    // strafe at boost speed during fights, with hysteresis so energy is left for dodges
    if (state.startsWith("fight") || state.startsWith("endgame-fight")) {
      if (me.energy > this.p.fightBoostOn) this.fightBoost = true
      else if (me.energy < this.p.fightBoostOff) this.fightBoost = false
      if (this.fightBoost && me.grounded) boost = true
    } else this.fightBoost = false
    if (t < this.unstickUntil) {
      act.jump = me.grounded
      if (!me.grounded && me.energy > 15) boost = true
      if (t < this.unstickUntil - 0.6) mv = [Math.cos(this.unstickYaw), Math.sin(this.unstickYaw)]
      state += "+unstick"
    }
    // --- roof climb: at the launch point, jump and jet toward the roof centre ---
    const rr = this.roofNow
    if (rr && state === "to-roof" && (hdist(pos, rr.launch) < 4 || this.climbT > 0)) {
      const need = (rr.top - pos[2]) * 1.6 + 15
      if (this.climbT === 0 && me.energy < need) {
        mv = [0, 0] // wait at the wall for energy
        state = "to-roof(energy)"
      } else {
        if (this.climbT === 0) this.climbT = t
        const y = yawTo(pos, [rr.cx, rr.cy])
        mv = [Math.cos(y), Math.sin(y)]
        act.jump = me.grounded && pos[2] < rr.top - 1
        boost = !me.grounded && pos[2] < rr.top + 2 && me.energy > 2
        this.unstickUntil = 0
        state = "climb"
        if (t - this.climbT > this.p.climbTimeout) {
          this.badRoofs.add(rr.id)
          this.roofNow = null
          this.climbT = 0
        }
      }
    } else this.climbT = 0
    // --- edge guard: don't strafe off a roof unless we mean to leave ---
    if (this.map && me.grounded && !state.startsWith("rotate") && me.in_zone) {
      const gnd = this.map.groundAt(pos[0], pos[1])
      const mn = Math.hypot(mv[0], mv[1])
      if (pos[2] > gnd + this.p.roofMin - 1 && mn > 0.1) {
        const ax = pos[0] + (mv[0] / mn) * 4, ay = pos[1] + (mv[1] / mn) * 4
        if (this.map.surfaceAt(ax, ay, pos[2] + 1.2) < pos[2] - 1.5) mv = [0, 0]
      }
    }
    // zone discipline: don't follow anyone out of the circle (let the zone hurt them, not us)
    if (this.p.zoneHold && target && target.kind === "mech" && me.in_zone && !state.startsWith("rotate")) {
      const zc = obs.zone.center, zr = obs.zone.radius
      const ahead = [pos[0] + mv[0] * 6, pos[1] + mv[1] * 6]
      if (hdist(ahead, [zc[0], zc[1]]) > zr - 4) {
        const iy = Math.atan2(zc[1] - pos[1], zc[0] - pos[0])
        const out = -(mv[0] * Math.cos(iy) + mv[1] * Math.sin(iy)) // outward component
        if (out > 0) mv = [mv[0] + out * Math.cos(iy), mv[1] + out * Math.sin(iy)]
      }
    }
    // silence: no enemy in sight and no hurry -> walk under the footstep threshold (5 m/s)
    if (this.p.silentWalk && !target && me.in_zone && !boost && !dodge && !state.startsWith("rotate") && !state.startsWith("climb")) {
      const cap = this.p.silentFrac
      const mm = Math.hypot(mv[0], mv[1])
      if (mm > cap) (mv = [(mv[0] / mm) * cap, (mv[1] / mm) * cap]), (state += "+quiet")
    }
    const n = Math.hypot(mv[0], mv[1])
    act.move = n > 1 ? [mv[0] / n, mv[1] / n] : mv
    act.boost = boost

    // --- aiming & firing ---
    const muzzle = [pos[0], pos[1], pos[2] + (me.stats.muzzle_height ?? 7)]
    const [ayaw, apitch] = me.aim
    const slots = me.weapons
    const gunSlot = slots.findIndex((w) => w?.kind === "gun")
    let aimSet = false
    if (target || crateTarget) {
      const tp = target ? target.pos : crateTarget!.pos
      const tv = target ? target.vel : [0, 0, 0]
      const zOff = !target ? 1.2 : target.kind === "npc" ? 1.75 : 4.5 * (1 + 0.05 * (target.cubes ?? 0))
      const center = [tp[0], tp[1], tp[2] + zOff]
      const d = hdist(pos, center)
      const radius = !target ? 1.4 : target.kind === "npc" ? 1.8 : 2.5
      const tol = Math.atan2(radius * 0.8, Math.max(d, 1)) + 0.005

      // primary aim: gun lead
      const gs = gunSlot >= 0 ? slots[gunSlot]!.stats.speed : 252
      const ti = intercept(muzzle, center, tv, gs) ?? d / gs
      const aimP = [center[0] + tv[0] * ti, center[1] + tv[1] * ti, center[2] + tv[2] * ti]
      const yaw = yawTo(muzzle, aimP)
      const pitch = Math.atan2(aimP[2] - muzzle[2], hdist(muzzle, aimP))
      act.aim = [yaw, pitch]
      aimSet = true
      const lineOk = this.clear(muzzle, aimP)
      const aligned = lineOk && Math.abs(wrap(yaw - ayaw)) < tol && Math.abs(pitch - apitch) < tol + 0.02

      slots.forEach((w, i) => {
        if (!w) return
        if (w.kind === "gun") {
          if (aligned && d < w.stats.range && (w.ammo ?? 1) > 0) act.fire![i] = true
          if ((w.ammo ?? 1) === 0 && !w.reload) act.reload = true
          // no shot available right now: top up so the next exchange starts with a fuller magazine
          else if (!lineOk && !w.reload && (w.ammo ?? 99) < w.stats.mag * this.p.reloadBelow) act.reload = true
        } else if (w.kind === "lightning") {
          const cone = ((w.stats.cone_deg ?? 30) * Math.PI) / 360
          if (d < w.stats.range - 2 && Math.abs(wrap(yawTo(pos, center) - ayaw)) < cone * 0.8 && me.energy > this.p.lightningEnergyFloor)
            act.fire![i] = true
        } else if (w.kind === "laser" && target) {
          // hitscan: aim at where the target will be when the aim command lands (~1 decision), not the gun lead
          const full = (w.charge ?? 0) >= (w.stats.charge ?? 0.75) * 0.97
          const lp = [center[0] + tv[0] * this.p.laserLead, center[1] + tv[1] * this.p.laserLead, center[2]]
          const ly = yawTo(muzzle, lp), lpitch = Math.atan2(lp[2] - muzzle[2], hdist(muzzle, lp))
          const lAligned = this.clear(muzzle, lp) && Math.abs(wrap(ly - ayaw)) < tol && Math.abs(lpitch - apitch) < tol + 0.02
          if (full) act.aim = [ly, lpitch] // charged: the laser owns the aim
          this.laser(act, i, w, lAligned, d)
        } else if (w.kind === "mortar" && target && d > this.p.mortarMinRange && !this.laserCharging(slots)) {
          // lead the shell: solve pitch for the current spot, then re-solve for where the target will be on landing
          let tgt = target.pos
          let mp = ballisticPitch(hdist(pos, tgt), tgt[2] - (pos[2] + 9.5), w.stats.speed, w.stats.gravity)
          if (mp != null) {
            const tf = hdist(pos, tgt) / (w.stats.speed * Math.cos(mp))
            tgt = [tgt[0] + tv[0] * tf, tgt[1] + tv[1] * tf, tgt[2]]
            mp = ballisticPitch(hdist(pos, tgt), tgt[2] - (pos[2] + 9.5), w.stats.speed, w.stats.gravity)
          }
          // only take over the aim when the gun is not mid-burst
          const gunBusy = gunSlot >= 0 && act.fire![gunSlot]
          if (mp != null && !gunBusy && w.cooldown <= 0) {
            act.aim = [yawTo(pos, tgt), mp]
            if (Math.abs(wrap(act.aim[0] - ayaw)) < 0.04 && Math.abs(mp - apitch) < 0.04) act.fire![i] = true
          }
        }
      })
    } else {
      // top up the gun while nothing is around
      slots.forEach((w) => {
        if (w?.kind === "gun" && !w.reload && (w.ammo ?? 99) < w.stats.mag * 0.6 && quiet) act.reload = true
      })
    }
    if (!aimSet) {
      let yaw: number
      if (t - this.lastDamage.t < this.p.threatMemory) yaw = this.lastDamage.bearing
      else if (t - this.lastSound.t < 2) yaw = this.lastSound.bearing
      else if (!hasLaser && this.p.laserScanSpin > 0 && t < this.p.laserScanUntil) yaw = this.scanYaw += this.p.laserScanSpin // spin to spot lasers
      else if (n > 0.3) yaw = Math.atan2(mv[1], mv[0]) + Math.sin(t * 1.7) * 0.9 // sweep while walking
      else yaw = this.scanYaw += 0.12
      act.aim = [yaw, 0]
    }

    // --- first strike: an unseen mech is moving nearby -> pre-charge the laser so the first shot is full power ---
    if (this.p.preCharge && !aimSet) {
      const li = me.weapons.findIndex((w) => w?.kind === "laser")
      const lw = li >= 0 ? me.weapons[li]! : null
      if (lw) {
        const full = lw.stats.charge ?? 0.75, holdMax = full + (lw.stats.hold_s ?? 2) - 0.3
        const heard = t - this.lastStep.t < 3
        if (heard && lw.cooldown <= 0 && (lw.charge ?? 0) < holdMax) {
          act.fire![li] = true
          act.aim = [this.lastStep.bearing, 0]
          state += "+precharge"
        }
      }
    }

    // --- loot pickup (take within reach) ---
    const reach = this.cfg.loot.pickup_radius - 0.3
    for (const p of obs.pickups) {
      if (hdist(p.pos, pos) > reach || Math.abs(p.pos[2] - pos[2]) > 3.8) continue
      const want = this.wantPickup(slots, p.kind)
      if (want === 1) act.take = p.id
      else if (want === 2) (act.take = p.id), (act.drop = slots.findIndex((w) => w && w.kind !== "gun"))
      if (act.take != null) break
    }

    const ms = performance.now() - t0
    if (ms > this.maxMs) this.maxMs = ms
    draw.label(`${this.ffa ? "FFA" : "PRC"} ${state} hp${me.hp.toFixed(0)}/${me.max_hp.toFixed(0)} c${me.cubes} k${this.kills}${target ? ` tgt${target.id}` : ""} ${ms.toFixed(1)}/${this.maxMs.toFixed(0)}ms`)
    return act
  }

  /** 0 = no, 1 = take into empty slot, 2 = swap out our non-gun weapon. */
  wantPickup(slots: (WeaponObs | null)[], kind: string): number {
    if (kind === "gun" || slots.some((w) => w?.kind === kind)) return 0
    if (slots.some((w) => w === null)) return 1
    const other = slots.find((w) => w && w.kind !== "gun")
    if (other && other.kind !== "laser" && !(other.charge && other.charge > 0) && this.p.weaponScore[kind] > this.p.weaponScore[other.kind]) return 2
    return 0
  }

  laserCharging(slots: (WeaponObs | null)[]) {
    return slots.some((w) => w?.kind === "laser" && (w.charge ?? 0) > 0)
  }

  laser(act: BotAction, i: number, w: WeaponObs, aligned: boolean, d: number) {
    const charge = w.charge ?? 0
    const full = w.stats.charge ?? 0.75
    if (d > (w.stats.range ?? 280)) return
    if (charge <= 0) {
      if (w.cooldown <= 0) act.fire![i] = true // start charging
    } else if (charge < full * 0.97 || !aligned) {
      act.fire![i] = true // keep holding until full and on target
    } // else release: fire[i] stays false -> beam fires
  }
}

if (import.meta.main) run((hello) => new Turtle(hello))
