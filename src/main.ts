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

class Turtle {
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

  constructor(h: Hello) {
    this.cfg = h.config
    try {
      this.map = GameMap.load(h.map.dir)
      const m = h.config.mech
      this.nav = new Nav(this.map, { ...defaultNavOpts, stepUp: m.step_up ?? 1.2, maxSlopeDeg: m.max_slope_deg ?? 50 })
      // warm up the JIT on the hot paths while we still have the hello budget
      const b = this.map.bounds
      for (let k = 0; k < 60; k++) {
        const x1 = b.minX + ((k * 97) % 900), y1 = b.minY + ((k * 61) % 600)
        const x2 = b.minX + ((k * 53) % 900), y2 = b.minY + ((k * 89) % 600)
        this.nav.path(x1, y1, x2, y2, P.maxExpand, true)
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
    const stale = !r || hdist(r.goal, goal) > 6 || t - r.t > P.replanEvery || !r.pts.length || hdist(pos, r.pts[0]) > 12
    if (stale) {
      const pts = nav.path(pos[0], pos[1], goal[0], goal[1], P.maxExpand, true)
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

  /** Clear shot line from muzzle to point (true when no map). */
  clear(a: V3, b: V3): boolean {
    return !this.map || this.map.los(a, b)
  }

  act(obs: Observation): BotAction {
    const t0 = performance.now()
    const me = obs.self
    const t = obs.t
    const pos = me.pos
    const act: BotAction = { fire: [false, false] }

    // --- bookkeeping: events, sounds, mode detection ---
    let killsNow = 0
    for (const e of obs.events) {
      if (e.type === "damaged" && e.bearing != null) this.lastDamage = { t, bearing: e.bearing, by: e.by }
      if (e.type === "kill") killsNow++
    }
    this.kills += killsNow
    if (obs.alive < this.prevAlive - killsNow) this.ffa = true
    this.prevAlive = obs.alive
    for (const s of obs.sounds)
      if (s.kind !== "step" && s.kind !== "drop" && s.kind !== "crate" && s.dist !== "far" && s.age < 0.5)
        this.lastSound = { t, bearing: s.bearing }

    if (obs.offer) {
      const ids = obs.offer.choices.map((c) => c.id)
      let best = 0
      let bestRank = 1e9
      ids.forEach((id, i) => {
        const r = P.upgradeOrder.indexOf(id)
        const rank = r < 0 ? 999 : r
        if (rank < bestRank) (bestRank = rank), (best = i)
      })
      act.pick = best
    }

    // --- target selection ---
    const mechs = obs.mechs.filter((m) => m.kind === "mech")
    const npcs = obs.mechs.filter((m) => m.kind === "npc")
    let target: ActorObs | null = null
    const attacker = mechs.find((m) => m.id === this.lastDamage.by && t - this.lastDamage.t < 3)
    if (attacker) target = attacker
    else if (mechs.length) target = mechs.reduce((a, b) => (hdist(a.pos, pos) < hdist(b.pos, pos) ? a : b))
    const quiet = !target && t - this.lastDamage.t > 3
    let crateTarget: { id: number; pos: V3; hp?: number } | null = null
    if (!target) {
      const npcAttacker = npcs.find((n) => n.id === this.lastDamage.by && t - this.lastDamage.t < 3)
      const npcNear = npcs.filter((n) => hdist(n.pos, pos) < 80).sort((a, b) => hdist(a.pos, pos) - hdist(b.pos, pos))[0]
      target = npcAttacker ?? npcNear ?? null
    }
    if (!target && quiet) {
      const eye = [pos[0], pos[1], pos[2] + (me.stats.muzzle_height ?? 7)]
      crateTarget =
        obs.crates
          .filter((c) => hdist(c.pos, pos) < P.crateShootRange)
          .sort((a, b) => hdist(a.pos, pos) - hdist(b.pos, pos))
          .find((c) => this.clear(eye, [c.pos[0], c.pos[1], c.pos[2] + 1.2])) ?? null
    }

    // --- movement goal ---
    const z = obs.zone
    const nc = [z.next_center[0], z.next_center[1], pos[2]]
    const dCenter = hdist(pos, nc)
    let goal: V3 | null = null
    let state = "hold"
    if (z.next_radius <= P.endgameRadius) {
      if (dCenter > 1.5) goal = nc
      state = "endgame"
    } else if (dCenter > z.next_radius * P.zoneSafety || !me.in_zone) {
      goal = nc
      state = "rotate"
    } else if (quiet) {
      const loot = [
        ...obs.cubes.map((c) => ({ pos: c.pos, w: 1 })),
        ...obs.pickups.filter((p) => this.wantPickup(me.weapons, p.kind) > 0).map((p) => ({ pos: p.pos, w: 1.5 })),
      ]
        .filter((l) => hdist(l.pos, pos) < P.lootDetour && hdist(l.pos, nc) < z.next_radius)
        .sort((a, b) => hdist(a.pos, pos) / a.w - hdist(b.pos, pos) / b.w)[0]
      if (loot) {
        goal = loot.pos
        state = "loot"
      }
    }

    let mv = [0, 0]
    if (goal) mv = this.steer(pos, goal, t)
    if (target && target.kind === "mech") {
      // strafe perpendicular to the target, biased toward the goal
      if (t > this.strafeUntil) {
        this.strafeSign = Math.random() < 0.5 ? -1 : 1
        this.strafeUntil = t + P.strafeFlip * (0.6 + Math.random() * 0.8)
      }
      const ty = yawTo(pos, target.pos) + (this.strafeSign * Math.PI) / 2
      mv = [mv[0] * 0.6 + Math.cos(ty), mv[1] * 0.6 + Math.sin(ty)]
      state = state === "endgame" ? "endgame-fight" : "fight"
    }

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
    let boost = !me.in_zone || (state === "rotate" && t > z.shrink_start - 10 && dCenter > z.next_radius)
    if (t < this.unstickUntil) {
      act.jump = me.grounded
      if (!me.grounded && me.energy > 15) boost = true
      if (t < this.unstickUntil - 0.6) mv = [Math.cos(this.unstickYaw), Math.sin(this.unstickYaw)]
      state += "+unstick"
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
        } else if (w.kind === "lightning") {
          const cone = ((w.stats.cone_deg ?? 30) * Math.PI) / 360
          if (d < w.stats.range - 2 && Math.abs(wrap(yawTo(pos, center) - ayaw)) < cone * 0.8 && me.energy > P.lightningEnergyFloor)
            act.fire![i] = true
        } else if (w.kind === "laser" && target) {
          this.laser(act, i, w, aligned, d)
        } else if (w.kind === "mortar" && target && d > P.mortarMinRange) {
          const mp = ballisticPitch(hdist(pos, target.pos), target.pos[2] - (pos[2] + 9.5), w.stats.speed, w.stats.gravity)
          if (mp != null && !this.laserCharging(slots)) {
            // only override aim with the mortar pitch when the gun isn't mid-burst
            const gunBusy = gunSlot >= 0 && act.fire![gunSlot]
            if (!gunBusy && w.cooldown <= 0) {
              act.aim = [yawTo(pos, target.pos), mp]
              if (Math.abs(wrap(act.aim[0] - ayaw)) < 0.04 && Math.abs(mp - apitch) < 0.04) act.fire![i] = true
            }
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
      if (t - this.lastDamage.t < P.threatMemory) yaw = this.lastDamage.bearing
      else if (t - this.lastSound.t < 2) yaw = this.lastSound.bearing
      else if (n > 0.3) yaw = Math.atan2(mv[1], mv[0])
      else yaw = this.scanYaw += 0.12
      act.aim = [yaw, 0]
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
    if (other && other.kind !== "laser" && !(other.charge && other.charge > 0) && P.weaponScore[kind] > P.weaponScore[other.kind]) return 2
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

run((hello) => new Turtle(hello))
