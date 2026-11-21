/**
 * Local sandbox: runs our bot (in-process) against a scripted house squad on the real map.
 * Approximate physics/weapons from hello.config; the point is VISIBILITY into what our bot does
 * (states, stuck time, hit rates, damage sources, cause of death), not exact parity with the server.
 */
import { gunzipSync } from "node:zlib"
import { readFileSync } from "node:fs"
import { GameMap } from "../src/world/map.ts"
import { Nav } from "../src/world/nav.ts"
import { draw } from "../src/mechfight.ts"

type V3 = number[]
const TAU = Math.PI * 2
const wrap = (a: number) => ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI
const hd = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1])
const yawTo = (a: V3, b: V3) => Math.atan2(b[1] - a[1], b[0] - a[0])

export function rng(seed: number) {
  let s = seed >>> 0
  const f = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return f
}
export function gauss(R: () => number) {
  return Math.sqrt(-2 * Math.log(R() + 1e-12)) * Math.cos(TAU * R())
}

export const HELLO = JSON.parse(gunzipSync(readFileSync("kit/check/stream.jsonl.gz")).toString().split("\n")[0])
HELLO.map.dir = "kit/arena"
const C = HELLO.config
export const MAP = GameMap.load("kit/arena")
export const NAV = new Nav(MAP)

type W = { kind: string; cooldown: number; ammo: number; reload: number; charge: number; equip: number }
type Tier = { name: string; aimErr: number; fireP: number; strafe: number; range: number }
export const TIERS: Tier[] = [
  { name: "easy", aimErr: 0.05, fireP: 0.55, strafe: 0, range: 90 },
  { name: "medium", aimErr: 0.03, fireP: 0.75, strafe: 0.5, range: 90 },
  { name: "hard", aimErr: 0.018, fireP: 0.9, strafe: 1, range: 80 },
  { name: "expert", aimErr: 0.01, fireP: 1, strafe: 1, range: 70 },
]

export class Mech {
  pos: V3
  vel: V3 = [0, 0, 0]
  aim = [0, 0]
  cmd: any = {}
  hp: number
  maxHp: number
  energy: number
  spendT = -99
  dmgT = -99
  grounded = true
  cubes = 0
  alive = true
  place = 0
  stats: any
  wst: any
  weapons: (W | null)[] = [{ kind: "gun", cooldown: 0, ammo: C.weapons.gun.mag, reload: 0, charge: 0, equip: 0 }, null]
  upgrades: string[] = []
  offers: any[] = []
  offerQ = 0
  events: any[] = []
  sounds: any[] = []
  seen = new Map<number, number>()
  stepT = 0
  kills = 0
  shortUntil = 0
  tier?: Tier
  route: { pts: number[][]; t: number; goal: V3 } | null = null
  strafeSign = 1
  strafeT = 0
  log = { shots: {} as any, hits: {} as any, dmgIn: {} as any, dmgOut: 0, states: {} as any, stuck: 0, deathBy: "", deathT: 0, maxMs: 0, ms: [] as number[] }
  constructor(public id: number, public team: number, pos: V3, public bot: any) {
    this.pos = pos
    this.stats = { ...C.mech }
    this.wst = JSON.parse(JSON.stringify(C.weapons))
    this.hp = this.maxHp = C.mech.hp
    this.energy = C.mech.energy
  }
  get scale() {
    return 1 + C.cubes.size_per_cube * this.cubes
  }
  get r() {
    return this.stats.radius * this.scale
  }
  get h() {
    return this.stats.height * this.scale
  }
  dmgMult() {
    return 1 + C.cubes.damage_per_cube * Math.min(this.cubes, C.cubes.stat_cap)
  }
  has(k: string) {
    return this.weapons.some((w) => w?.kind === k)
  }
}

export type MatchOpts = { seed: number; mode: "practice" | "ffa"; bots: ((h: any) => any)[]; huntersAtStart?: number; allHuntT?: number; trace?: boolean; idleEngage?: number; aimMul?: number; startWeapon?: string }

export class Match {
  t = 0
  tick = 0
  R: () => number
  mechs: Mech[] = []
  npcs: any[] = []
  crates: any[] = []
  cubes: any[] = []
  pickups: any[] = []
  shots: any[] = []
  drops: any[] = []
  nextId = 0
  phases: any[] = []
  deadHouse = 0
  trace: { t: number; id: number; p: V3; st?: string }[] = []
  constructor(public o: MatchOpts) {
    this.R = rng(o.seed)
    const R = this.R
    let c = [...C.zone.start_center], r = C.zone.start_radius, t0 = 0
    for (const ph of C.zone.phases) {
      const maxOff = Math.max(0, r - ph.radius) * 0.8
      const a = R() * TAU, d = Math.sqrt(R()) * maxOff
      const nc = [c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d]
      this.phases.push({ c0: c, r0: r, c1: nc, r1: ph.radius, holdEnd: t0 + ph.hold_s, end: t0 + ph.hold_s + ph.shrink_s, dps: ph.dps })
      t0 += ph.hold_s + ph.shrink_s
      c = nc
      r = ph.radius
    }
    const spawns: V3[] = []
    let tries = 0
    while (spawns.length < 16) {
      const p = this.freePoint(C.zone.start_center, C.zone.start_radius * C.match.spawn_zone_fraction)
      if (spawns.every((s) => hd(s, p) > (++tries > 3000 ? 60 : C.match.spawn_min_separation))) spawns.push(p)
    }
    const nOurs = o.bots.length
    for (let i = 0; i < 16; i++) {
      const ours = i < nOurs
      const team = ours ? (o.mode === "ffa" ? 100 + i : 0) : o.mode === "ffa" ? 200 + i : 1
      const m = new Mech(i, team, spawns[i], null)
      if (ours) {
        const h = JSON.parse(JSON.stringify(HELLO))
        h.slot = i
        h.seed = Math.floor(R() * 1e9)
        m.bot = o.bots[i](h)
        if (o.startWeapon) m.weapons[1] = { kind: o.startWeapon, cooldown: 0, ammo: 0, reload: 0, charge: 0, equip: 0 }
      } else {
        const k = i - nOurs
        m.tier = TIERS[k < 4 ? 0 : k < 8 ? 1 : k < 12 ? 2 : 3]
      }
      m.aim = [R() * TAU, 0]
      this.mechs.push(m)
    }
    for (let k = 0; k < C.crates.count; k++) this.crates.push({ id: 1000 + k, pos: this.freePoint(C.zone.start_center, C.zone.start_radius * 0.9), hp: C.crates.hp })
    for (let k = 0; k < C.loot.floor_count; k++) this.addPickup(this.freePoint(C.zone.start_center, C.zone.start_radius * 0.9))
    for (let k = 0; k < C.npc.count; k++) {
      const p = this.freePoint(C.zone.start_center, C.zone.start_radius * 0.85)
      this.npcs.push({ id: 100 + k, pos: p, home: [...p], vel: [0, 0, 0], hp: C.npc.hp, target: -1, cd: 0, aim: [0, 0] })
    }
    for (const dt of C.drops.times) this.drops.push({ id: 20000 + this.drops.length, call: dt, pos: null, taken: false, holder: null, progress: 0 })
  }

  freePoint(c: number[], r: number): V3 {
    for (;;) {
      const a = this.R() * TAU, d = Math.sqrt(this.R()) * r
      const x = c[0] + Math.cos(a) * d, y = c[1] + Math.sin(a) * d
      if (NAV.isFree(x, y)) return [x, y, MAP.surfaceAt(x, y)]
    }
  }
  addPickup(p: V3, kind?: string) {
    const ks = ["mortar", "laser", "lightning"]
    this.pickups.push({ id: 8000 + this.nextId++, kind: kind ?? ks[Math.floor(this.R() * 3)], pos: [...p] })
  }
  zoneNow() {
    const ph = this.phases.find((p) => this.t < p.end) ?? this.phases[this.phases.length - 1]
    const f = this.t <= ph.holdEnd ? 0 : Math.min(1, (this.t - ph.holdEnd) / (ph.end - ph.holdEnd))
    const c = [ph.c0[0] + (ph.c1[0] - ph.c0[0]) * f, ph.c0[1] + (ph.c1[1] - ph.c0[1]) * f]
    return { center: c, radius: ph.r0 + (ph.r1 - ph.r0) * f, next_center: ph.c1, next_radius: ph.r1, shrink_start: ph.holdEnd, shrink_end: ph.end, dps: ph.dps }
  }
  alive() {
    return this.mechs.filter((m) => m.alive)
  }
  /** vision: near sensors any direction, else range within the yaw wedge; buildings block (trees ignored). */
  sees(m: Mech, p: V3, h: number): boolean {
    const d = hd(m.pos, p)
    const inWedge = d <= C.vision.range && Math.abs(wrap(yawTo(m.pos, p) - m.aim[0])) <= (C.vision.fov_deg * Math.PI) / 360
    if (d > C.vision.near_range && !inWedge) return false
    const e = [m.pos[0], m.pos[1], m.pos[2] + C.mech.eye_height * m.scale]
    return MAP.los(e, [p[0], p[1], p[2] + h / 2], 1) || MAP.los(e, [p[0], p[1], p[2] + h], 1)
  }
  sound(kind: string, p: V3, src: number) {
    const range = C.sound.range[kind] ?? 100
    for (const m of this.mechs) {
      if (!m.alive || !m.bot || m.id === src) continue
      const d = hd(m.pos, p)
      if (d > range) continue
      const noise = ((C.sound.bearing_noise_deg * Math.PI) / 180) * (m.stats.hearing ?? 1) * gauss(this.R)
      m.sounds.push({ kind, bearing: wrap(yawTo(m.pos, p) + noise), dist: d < C.sound.near ? "near" : d < C.sound.mid ? "mid" : "far", age: 0 })
    }
  }

  // ---------- damage ----------
  damage(target: Mech, amount: number, weapon: string, src: Mech | null, from: V3 | null) {
    if (!target.alive) return
    let dmg = amount
    let rear = false
    if (from) {
      rear = Math.abs(wrap(yawTo(target.pos, from) - target.aim[0])) > (C.mech.front_arc_deg * Math.PI) / 360
      if (rear && src) dmg *= C.mech.rear_mult
    }
    if (src) {
      dmg *= src.dmgMult()
      dmg *= 1 - (target.stats.armor ?? 0)
      if (src === target) dmg *= C.mech.self_damage_mult
    }
    target.hp -= dmg
    target.dmgT = this.t
    const key = weapon + (rear ? "(rear)" : "")
    target.log.dmgIn[key] = (target.log.dmgIn[key] ?? 0) + dmg
    if (src && src !== target) {
      src.dmgT = this.t
      src.log.dmgOut += dmg
      src.log.hits[weapon] = (src.log.hits[weapon] ?? 0) + 1
      src.events.push({ type: "hit", target: target.id, amount: dmg, weapon, rear })
    }
    target.events.push({ type: "damaged", amount: dmg, weapon, bearing: from ? yawTo(target.pos, from) : null, by: src ? src.id : null, rear })
    if (target.hp <= 0) this.kill(target, src, weapon)
  }
  kill(m: Mech, by: Mech | null, weapon: string) {
    m.alive = false
    m.hp = 0
    m.place = this.alive().length + 1
    m.log.deathBy = by ? `${weapon}:${by.tier?.name ?? "bot" + by.id}` : weapon
    m.log.deathT = this.t
    if (by && by !== m) {
      by.kills++
      by.events.push({ type: "kill", target: m.id })
    }
    if (m.team === 1) this.deadHouse++
    for (let k = 0; k < m.cubes + C.cubes.death_drop_extra; k++) this.cubes.push({ id: 5000 + this.nextId++, pos: [m.pos[0] + this.R() * 4 - 2, m.pos[1] + this.R() * 4 - 2, m.pos[2]] })
    for (const w of m.weapons) if (w && w.kind !== "gun") this.addPickup(m.pos, w.kind)
    this.sound("death", m.pos, m.id)
  }
  damageNpc(n: any, amount: number, src: Mech, weapon: string) {
    n.hp -= amount * src.dmgMult()
    n.target = src.id
    src.dmgT = this.t
    src.events.push({ type: "hit", target: n.id, amount, weapon })
    if (n.hp <= 0) {
      for (let k = 0; k < C.npc.cubes; k++) this.cubes.push({ id: 5000 + this.nextId++, pos: [...n.pos] })
      this.npcs = this.npcs.filter((x) => x !== n)
    }
  }
  damageCrate(c: any, amount: number, src: Mech, weapon: string) {
    c.hp -= amount * src.dmgMult()
    src.events.push({ type: "hit", target: c.id, amount, weapon })
    if (c.hp <= 0) {
      this.cubes.push({ id: 5000 + this.nextId++, pos: [...c.pos] })
      if (this.R() < C.loot.crate_weapon_chance) this.addPickup(c.pos)
      this.crates = this.crates.filter((x) => x !== c)
      this.sound("crate", c.pos, src.id)
    }
  }

  // ---------- main loop ----------
  run(): Match {
    while (this.t < C.match.duration_s) {
      if (this.tick % C.match.decide_every === 0) this.decide()
      this.physics()
      this.tick++
      this.t = this.tick / C.match.tick_hz
      const alive = this.alive()
      if (alive.length <= 1 || (this.o.mode === "practice" && this.mechs.filter((m) => m.bot).every((m) => !m.alive))) break
    }
    this.alive().sort((a, b) => b.hp - a.hp).forEach((m, i) => (m.place = i + 1))
    return this
  }

  decide() {
    const z = this.zoneNow()
    for (const m of this.mechs) {
      if (!m.alive) continue
      if (m.bot) {
        const obs = this.observe(m, z)
        const t0 = performance.now()
        draw.clear()
        let a: any = {}
        try {
          a = m.bot.act(obs) ?? {}
        } catch (e) {
          console.error("bot act() threw", e)
        }
        const ms = performance.now() - t0
        m.log.ms.push(ms)
        if (ms > m.log.maxMs) m.log.maxMs = ms
        const d = draw.take() as any
        const st = ((d?.label ?? "").split(" ")[1] ?? "?").replace(/\+.*/, "")
        m.log.states[st] = (m.log.states[st] ?? 0) + 0.1
        if (this.o.trace && this.tick % 10 === 0) this.trace.push({ t: this.t, id: m.id, p: [...m.pos], st })
        const mv = a.move ?? [0, 0]
        if (Math.hypot(mv[0], mv[1]) > 0.5 && Math.hypot(m.vel[0], m.vel[1]) < 1 && m.grounded) m.log.stuck += 0.1
        m.cmd = { ...m.cmd, ...a, fire: a.fire ?? [false, false] }
        m.events = []
        m.sounds = []
        this.applyOneShots(m)
      } else {
        this.houseAct(m, z)
        if (this.o.trace && this.tick % 10 === 0) this.trace.push({ t: this.t, id: m.id, p: [...m.pos] })
      }
    }
  }

  observe(m: Mech, z: any) {
    const seen: any[] = []
    for (const o of this.mechs) {
      if (o === m || !o.alive) continue
      if (this.sees(m, o.pos, o.h)) m.seen.set(o.id, this.t)
      const last = m.seen.get(o.id)
      if (last != null && this.t - last <= C.vision.memory_s)
        seen.push({ id: o.id, kind: "mech", pos: [...o.pos], vel: [...o.vel], aim: [...o.aim], hp: o.hp, max_hp: o.maxHp, cubes: o.cubes, weapons: o.weapons.filter((w) => w).map((w) => w!.kind), charging: o.weapons.some((w) => w?.kind === "laser" && w.charge > 0) })
    }
    for (const n of this.npcs) if (this.sees(m, n.pos, C.npc.height)) seen.push({ id: n.id, kind: "npc", pos: [...n.pos], vel: [...n.vel], aim: [...n.aim], hp: n.hp, max_hp: C.npc.hp })
    const vis = (p: V3) => hd(p, m.pos) < C.vision.range && this.sees(m, p, 1.5)
    return {
      type: "obs", tick: this.tick, t: this.t, alive: this.alive().length,
      self: {
        id: m.id, pos: [...m.pos], vel: [...m.vel], aim: [...m.aim], hp: m.hp, max_hp: m.maxHp, energy: m.energy, max_energy: m.stats.energy, grounded: m.grounded,
        cubes: m.cubes, upgrades: [...m.upgrades], in_zone: hd(m.pos, z.center) <= z.radius,
        weapons: m.weapons.map((w) => (w ? { kind: w.kind, cooldown: Math.max(w.cooldown, w.equip), ammo: w.ammo, reload: w.reload, charge: w.charge, stats: m.wst[w.kind] } : null)),
        stats: { ...m.stats, eye_height: C.mech.eye_height * m.scale, muzzle_height: C.mech.muzzle_height * m.scale },
      },
      mechs: seen,
      projectiles: this.shots.filter((s) => s.owner !== m.id && hd(s.pos, m.pos) < 150).map((s) => ({ id: s.id, kind: s.kind, pos: [...s.pos], vel: [...s.vel] })),
      crates: this.crates.filter((c) => vis(c.pos)).map((c) => ({ id: c.id, pos: [...c.pos], hp: c.hp })),
      cubes: this.cubes.filter((c) => vis(c.pos)).map((c) => ({ id: c.id, pos: [...c.pos] })),
      pickups: this.pickups.filter((c) => vis(c.pos)).map((c) => ({ id: c.id, kind: c.kind, pos: [...c.pos] })),
      sounds: m.sounds, beams: [], events: m.events,
      drops: this.drops.filter((d) => d.pos && !d.taken).map((d) => ({ id: d.id, pos: d.pos, radius: C.drops.radius, lands_in: Math.max(0, d.call + C.drops.fall_s - this.t), capture_s: C.drops.capture_s, progress: d.progress, holder: d.holder })),
      zone: z, offer: m.offers[0] ?? null,
    }
  }

  applyOneShots(m: Mech) {
    const a = m.cmd
    if (a.pick != null && m.offers.length) {
      this.applyUpgrade(m, m.offers[0].choices[a.pick]?.id ?? m.offers[0].choices[0].id)
      m.offers.shift()
    }
    a.pick = undefined
    if (a.reload) {
      const g = m.weapons.find((w) => w?.kind === "gun")
      if (g && !g.reload && g.ammo < m.wst.gun.mag) g.reload = m.wst.gun.reload
      a.reload = false
    }
    if (a.take != null) {
      const p = this.pickups.find((x) => x.id === a.take)
      if (p && hd(p.pos, m.pos) <= C.loot.pickup_radius && !m.has(p.kind)) {
        let slot = m.weapons.findIndex((w) => !w)
        if (slot < 0 && a.drop != null) {
          slot = a.drop
          this.addPickup(m.pos, m.weapons[slot]!.kind)
        }
        if (slot >= 0) {
          m.weapons[slot] = { kind: p.kind, cooldown: 0, ammo: m.wst.gun.mag, reload: 0, charge: 0, equip: Math.max(C.loot.equip_s, m.wst[p.kind].cooldown) }
          this.pickups = this.pickups.filter((x) => x !== p)
          m.events.push({ type: "took", id: p.id, kind: p.kind, slot })
        }
      }
      a.take = undefined
      a.drop = undefined
    }
  }
  applyUpgrade(m: Mech, id: string) {
    const u = C.upgrades.find((x: any) => x.id === id)
    if (!u) return
    m.upgrades.push(id)
    for (const e of u.effects) {
      const parts = e.path.split(".")
      const obj = parts[0] === "mech" ? m.stats : m.wst[parts[1]]
      const key = parts[parts.length - 1]
      if (e.mul != null) obj[key] *= e.mul
      if (e.add != null) obj[key] += e.add
    }
    this.refreshHp(m)
    m.events.push({ type: "upgrade", id })
  }
  refreshHp(m: Mech) {
    const newMax = m.stats.hp * (1 + C.cubes.hp_per_cube * Math.min(m.cubes, C.cubes.stat_cap))
    m.hp += Math.max(0, newMax - m.maxHp)
    m.maxHp = newMax
  }
  addCubes(m: Mech, n: number) {
    for (let k = 0; k < n; k++) {
      m.cubes++
      this.refreshHp(m)
      if (C.cubes.upgrade_thresholds.includes(m.cubes)) {
        const avail = C.upgrades.filter((u: any) => (!u.requires || m.has(u.requires)) && m.upgrades.filter((x) => x === u.id).length < u.max)
        const ch: any[] = []
        while (ch.length < 3 && avail.length) ch.push(avail.splice(Math.floor(this.R() * avail.length), 1)[0])
        if (!ch.length) continue
        if (m.bot) m.offers.push({ id: m.offerQ++, expires: this.t + 5, choices: ch.map((u) => ({ id: u.id, name: u.name, desc: u.desc })) })
        else this.applyUpgrade(m, (ch.find((u) => u.id === "plating") ?? ch[0]).id)
      }
    }
  }

  // ---------- house squad AI ----------
  houseAct(m: Mech, z: any) {
    const R = this.R
    const enemies = this.mechs.filter((o) => o.alive && o.team !== m.team)
    const squad = this.o.mode === "practice" ? this.mechs.filter((o) => o.alive && o.team === m.team) : [m]
    let target: Mech | null = null, td = Infinity
    for (const e of enemies) {
      const d = hd(m.pos, e.pos)
      if (d < td && squad.some((s) => hd(s.pos, e.pos) < 220 && this.sees(s, e.pos, e.h))) (td = d), (target = e)
    }
    let hunting = true
    if (this.o.mode === "practice") {
      const order = this.mechs.filter((o) => o.team === 1 && o.alive)
      const n = this.t >= (this.o.allHuntT ?? 300) ? 99 : (this.o.huntersAtStart ?? 1) + this.deadHouse
      hunting = order.indexOf(m) < n
    }
    const tier = m.tier!
    const a: any = { move: [0, 0], fire: [false, false], boost: false }
    let goal: V3 | null = null
    let strafe = [0, 0]
    if (target && (hunting || td < (this.o.idleEngage ?? 45))) {
      const d = td
      const mz = m.pos[2] + C.mech.muzzle_height
      const tc = [target.pos[0], target.pos[1], target.pos[2] + target.h / 2]
      const tf = d / m.wst.gun.speed
      const ap = [tc[0] + target.vel[0] * tf, tc[1] + target.vel[1] * tf, tc[2]]
      const err = tier.aimErr * (this.o.aimMul ?? 1)
      a.aim = [yawTo(m.pos, ap) + gauss(R) * err, Math.atan2(ap[2] - mz, d) + gauss(R) * err * 0.5]
      const clear = MAP.los([m.pos[0], m.pos[1], mz], tc, 1)
      const aligned = Math.abs(wrap(a.aim[0] - m.aim[0])) < 0.08
      if (clear && aligned && R() < tier.fireP) a.fire = [true, d < 45 || m.weapons[1]?.kind !== "lightning"]
      // laser: release on the next decision
      const lw = m.weapons[1]
      if (lw?.kind === "laser" && lw.charge > 0.7) a.fire[1] = false
      if (!clear || d > tier.range) goal = target.pos
      else if (d < tier.range * 0.4) goal = [m.pos[0] * 2 - target.pos[0], m.pos[1] * 2 - target.pos[1], 0]
      if (tier.strafe > 0) {
        if (this.t > m.strafeT) (m.strafeSign = R() < 0.5 ? -1 : 1), (m.strafeT = this.t + 0.8 + R() * 1.5)
        const py = yawTo(m.pos, target.pos) + (m.strafeSign * Math.PI) / 2
        strafe = [Math.cos(py) * tier.strafe, Math.sin(py) * tier.strafe]
      }
    } else if (hunting && this.o.mode === "practice") {
      const prey = enemies.sort((x, y) => x.hp - y.hp)[0]
      if (prey) goal = prey.pos
    } else if (hd(m.pos, z.next_center) > z.next_radius * 0.6) goal = [z.next_center[0], z.next_center[1], 0]
    let mv = strafe
    if (goal) {
      const g = this.houseSteer(m, goal)
      mv = [strafe[0] * 0.5 + g[0], strafe[1] * 0.5 + g[1]]
    }
    a.move = mv
    if (!target) a.aim = [Math.hypot(mv[0], mv[1]) > 0.1 ? Math.atan2(mv[1], mv[0]) : m.aim[0], 0]
    if (hd(m.pos, z.center) > z.radius) a.boost = true
    const g = m.weapons[0]
    if (g && g.ammo === 0 && !g.reload) a.reload = true
    if (!m.weapons[1] && this.t > 40 + m.id * 4) m.weapons[1] = { kind: ["laser", "lightning", "mortar"][m.id % 3], cooldown: 0, ammo: 0, reload: 0, charge: 0, equip: 0 }
    m.cmd = { ...m.cmd, ...a, jump: false }
    this.applyOneShots(m)
  }
  houseSteer(m: Mech, goal: V3): number[] {
    const direct = () => {
      const y = yawTo(m.pos, goal)
      return [Math.cos(y), Math.sin(y)]
    }
    if (NAV.lineFree(m.pos[0], m.pos[1], goal[0], goal[1])) return direct()
    if (!m.route || this.t - m.route.t > 2 || hd(m.route.goal, goal) > 15 || !m.route.pts.length) {
      const pts = NAV.path(m.pos[0], m.pos[1], goal[0], goal[1], 4000, true)
      m.route = pts && pts.length ? { pts, t: this.t, goal: [...goal] } : null
    }
    if (!m.route) return direct()
    while (m.route.pts.length > 1 && hd(m.pos, m.route.pts[0]) < 3) m.route.pts.shift()
    const y = yawTo(m.pos, m.route.pts[0])
    return [Math.cos(y), Math.sin(y)]
  }

  // ---------- physics ----------
  blocked(x: number, y: number, z: number, r: number, h: number, stepUp: number) {
    const b = MAP.bounds
    if (x < b.minX + 2 || x > b.maxX - 2 || y < b.minY + 2 || y > b.maxY - 2) return true
    for (let k = -1; k < 8; k++) {
      const px = k < 0 ? x : x + Math.cos((k * TAU) / 8) * r, py = k < 0 ? y : y + Math.sin((k * TAU) / 8) * r
      const c = MAP.cellOf(px, py)
      if (c < 0) return true
      for (let q = MAP.ivStart[c]; q < MAP.ivStart[c + 1]; q++) {
        const base = MAP.ivData[2 * q], top = MAP.ivData[2 * q + 1]
        if (top > z + stepUp && base < z + h) return true
      }
    }
    return false
  }

  physics() {
    const dt = 1 / C.match.tick_hz
    const z = this.zoneNow()
    for (const m of this.mechs) {
      if (!m.alive) continue
      const a = m.cmd
      const s = m.stats
      if (a.aim) {
        const dy = wrap(a.aim[0] - m.aim[0]), mx = s.turn_rate * dt
        m.aim[0] = wrap(m.aim[0] + Math.max(-mx, Math.min(mx, dy)))
        const tp = Math.max(s.min_pitch, Math.min(s.max_pitch, a.aim[1])), mp = s.pitch_rate * dt
        m.aim[1] += Math.max(-mp, Math.min(mp, tp - m.aim[1]))
      }
      let mv = a.move ?? [0, 0]
      const ml = Math.hypot(mv[0], mv[1])
      if (ml > 1) mv = [mv[0] / ml, mv[1] / ml]
      const charging = m.weapons.some((w) => w?.kind === "laser" && w.charge > 0)
      let spd = s.walk_speed
      let spent = false
      if (a.boost && m.grounded && ml > 0.1 && m.energy > 0) {
        spd = s.boost_speed
        m.energy -= s.boost_drain * dt
        spent = true
      }
      if (charging) spd *= C.mech.charge_move_mult
      const acc = (m.grounded ? s.ground_accel : s.air_accel) * dt
      for (let i = 0; i < 2; i++) m.vel[i] += Math.max(-acc, Math.min(acc, mv[i] * spd - m.vel[i]))
      if (a.jump && m.grounded) {
        m.vel[2] = s.jump_speed
        m.grounded = false
      }
      a.jump = false
      if (!m.grounded) {
        m.vel[2] -= s.gravity * dt
        if (a.boost && m.energy > 0) {
          m.vel[2] = Math.min(s.max_rise_speed, m.vel[2] + s.jet_accel * dt)
          m.energy -= s.jet_drain * dt
          spent = true
        }
      }
      if (spent) m.spendT = this.t
      else if (this.t - m.spendT > s.energy_regen_delay) m.energy = Math.min(s.energy, m.energy + s.energy_regen * dt)
      const nx = m.pos[0] + m.vel[0] * dt, ny = m.pos[1] + m.vel[1] * dt
      const su = m.grounded ? s.step_up : 0.05
      if (!this.blocked(nx, ny, m.pos[2], m.r, m.h, su)) (m.pos[0] = nx), (m.pos[1] = ny)
      else if (!this.blocked(nx, m.pos[1], m.pos[2], m.r, m.h, su)) (m.pos[0] = nx), (m.vel[1] = 0)
      else if (!this.blocked(m.pos[0], ny, m.pos[2], m.r, m.h, su)) (m.pos[1] = ny), (m.vel[0] = 0)
      else (m.vel[0] = 0), (m.vel[1] = 0)
      const surf = MAP.surfaceAt(m.pos[0], m.pos[1], m.pos[2] + (m.grounded ? s.step_up : 0.05))
      const nz = m.pos[2] + m.vel[2] * dt
      if (nz <= surf) (m.pos[2] = surf), (m.vel[2] = 0), (m.grounded = true)
      else if (m.grounded && m.pos[2] - surf < 0.3 && m.vel[2] <= 0) m.pos[2] = surf
      else (m.pos[2] = nz), (m.grounded = false)
      const hs = Math.hypot(m.vel[0], m.vel[1])
      if (m.grounded && hs > C.sound.step_speed && this.t > m.stepT) {
        this.sound(a.boost ? "boost" : "step", m.pos, m.id)
        m.stepT = this.t + C.sound.step_every
      }
      if (hd(m.pos, z.center) > z.radius) {
        m.hp -= z.dps * dt
        m.dmgT = this.t
        m.log.dmgIn.zone = (m.log.dmgIn.zone ?? 0) + z.dps * dt
        if (m.hp <= 0) this.kill(m, null, "zone")
      } else if (this.t - m.dmgT > s.regen_delay) m.hp = Math.min(m.maxHp, m.hp + s.regen_per_s * dt)
      if (m.alive) this.weapons(m, dt)
    }
    this.projectiles(dt)
    this.world(dt)
  }

  weapons(m: Mech, dt: number) {
    const fire = m.cmd.fire ?? [false, false]
    m.weapons.forEach((w, i) => {
      if (!w) return
      w.cooldown = Math.max(0, w.cooldown - dt)
      w.equip = Math.max(0, w.equip - dt)
      if (w.kind === "gun" && w.reload > 0) {
        w.reload -= dt
        if (w.reload <= 0) (w.reload = 0), (w.ammo = m.wst.gun.mag)
      }
      const ready = w.cooldown <= 0 && w.equip <= 0
      const st = m.wst[w.kind]
      const muzzle = [m.pos[0], m.pos[1], m.pos[2] + C.mech.muzzle_height * m.scale]
      const dir = [Math.cos(m.aim[1]) * Math.cos(m.aim[0]), Math.cos(m.aim[1]) * Math.sin(m.aim[0]), Math.sin(m.aim[1])]
      if (w.kind === "gun" && fire[i] && ready && w.ammo > 0 && w.reload <= 0) {
        const sp = (st.spread_deg * Math.PI) / 180
        const yaw = m.aim[0] + gauss(this.R) * sp, pit = m.aim[1] + gauss(this.R) * sp
        const d = [Math.cos(pit) * Math.cos(yaw), Math.cos(pit) * Math.sin(yaw), Math.sin(pit)]
        this.shots.push({ id: this.nextId++, kind: "gun", owner: m.id, pos: muzzle.map((v, k) => v + d[k] * 3), vel: d.map((v) => v * st.speed), dist: 0, range: st.range, origin: [...m.pos] })
        w.ammo--
        w.cooldown = st.cooldown
        if (w.ammo === 0) w.reload = st.reload
        m.log.shots.gun = (m.log.shots.gun ?? 0) + 1
        this.sound("gun", m.pos, m.id)
      } else if (w.kind === "mortar" && fire[i] && ready) {
        this.shots.push({ id: this.nextId++, kind: "mortar", owner: m.id, pos: [m.pos[0] + dir[0] * 3, m.pos[1] + dir[1] * 3, m.pos[2] + m.h + 0.5], vel: dir.map((v) => v * st.speed), dist: 0, ttl: st.ttl })
        w.cooldown = st.cooldown
        m.log.shots.mortar = (m.log.shots.mortar ?? 0) + 1
        this.sound("mortar", m.pos, m.id)
      } else if (w.kind === "lightning" && fire[i] && ready && m.energy >= st.energy) {
        m.energy -= st.energy
        m.spendT = this.t
        w.cooldown = st.cooldown
        m.log.shots.lightning = (m.log.shots.lightning ?? 0) + 1
        this.sound("lightning", m.pos, m.id)
        this.lightning(m, st, muzzle)
      } else if (w.kind === "laser") {
        if (this.t < m.shortUntil) w.charge = 0
        else if (fire[i] && ready) {
          w.charge += dt
          if (w.charge >= st.charge + st.hold_s) this.laserFire(m, w, st, muzzle, dir)
        } else if (w.charge > 0) {
          if (w.charge < st.min_charge) w.charge += dt
          else this.laserFire(m, w, st, muzzle, dir)
        }
      }
    })
  }
  laserFire(m: Mech, w: W, st: any, muzzle: V3, dir: V3) {
    const frac = st.min_frac + (1 - st.min_frac) * Math.min(1, w.charge / st.charge)
    w.charge = 0
    w.cooldown = st.cooldown
    m.log.shots.laser = (m.log.shots.laser ?? 0) + 1
    this.sound("laser", m.pos, m.id)
    for (let d = 3; d < st.range; d += 1) {
      const p = [muzzle[0] + dir[0] * d, muzzle[1] + dir[1] * d, muzzle[2] + dir[2] * d]
      if (MAP.solidAt(p[0], p[1], p[2]) || p[2] < MAP.groundAt(p[0], p[1])) return
      const hit = this.hitAt(p, m)
      if (hit) {
        let dmg = st.damage * frac
        if (hit.kind === "mech" && hit.e.has("mortar")) dmg *= 1 + st.cookoff
        this.applyHit(hit, dmg, m, "laser", muzzle)
        return
      }
    }
  }
  lightning(m: Mech, st: any, muzzle: V3) {
    const cone = (st.cone_deg * Math.PI) / 360
    const cands: any[] = []
    for (const o of this.mechs) if (o.alive && o.team !== m.team) cands.push({ kind: "mech", e: o, pos: o.pos, z: o.h / 2 })
    for (const n of this.npcs) cands.push({ kind: "npc", e: n, pos: n.pos, z: 1.75 })
    for (const c of this.crates) cands.push({ kind: "crate", e: c, pos: c.pos, z: 1.2 })
    let cur: any = null, fd = Infinity
    for (const c of cands) {
      const d = hd(m.pos, c.pos)
      if (d > st.range || d >= fd || Math.abs(wrap(yawTo(m.pos, c.pos) - m.aim[0])) > cone) continue
      if (!MAP.los(muzzle, [c.pos[0], c.pos[1], c.pos[2] + c.z], 1)) continue
      ;(fd = d), (cur = c)
    }
    let dmg = st.damage
    const done = new Set<any>()
    for (let k = 0; k <= st.chain && cur; k++) {
      done.add(cur.e)
      this.applyHit(cur, dmg, m, "lightning", k === 0 ? muzzle : cur.pos)
      if (cur.kind === "mech" && cur.e.has("laser")) cur.e.shortUntil = this.t + st.short_s
      dmg *= st.chain_falloff
      let nxt: any = null, nd = Infinity
      for (const c of cands) {
        const d = hd(cur.pos, c.pos)
        if (!done.has(c.e) && d < st.chain_range && d < nd) (nd = d), (nxt = c)
      }
      cur = nxt
    }
  }
  hitAt(p: V3, owner: Mech | null): any {
    for (const o of this.mechs) {
      if (!o.alive || (owner && (o === owner || o.team === owner.team))) continue
      if (hd(o.pos, p) <= o.r && p[2] >= o.pos[2] && p[2] <= o.pos[2] + o.h) return { kind: "mech", e: o }
    }
    if (owner) {
      for (const n of this.npcs) if (hd(n.pos, p) <= C.npc.radius && p[2] >= n.pos[2] && p[2] <= n.pos[2] + C.npc.height) return { kind: "npc", e: n }
      for (const c of this.crates) if (hd(c.pos, p) <= C.crates.radius && p[2] >= c.pos[2] && p[2] <= c.pos[2] + C.crates.height) return { kind: "crate", e: c }
    }
    return null
  }
  applyHit(hit: any, dmg: number, src: Mech, weapon: string, from: V3) {
    if (hit.kind === "mech") this.damage(hit.e, dmg, weapon, src, from)
    else if (hit.kind === "npc") this.damageNpc(hit.e, dmg, src, weapon)
    else this.damageCrate(hit.e, dmg, src, weapon)
  }
  projectiles(dt: number) {
    const keep: any[] = []
    for (const s of this.shots) {
      const owner = s.owner >= 0 ? this.mechs[s.owner] : null
      let done = false
      if (s.kind === "mortar") s.vel[2] -= C.weapons.mortar.gravity * dt
      const step = Math.hypot(s.vel[0], s.vel[1], s.vel[2]) * dt
      const n = Math.max(1, Math.ceil(step))
      for (let k = 1; k <= n && !done; k++) {
        const p = [s.pos[0] + (s.vel[0] * dt * k) / n, s.pos[1] + (s.vel[1] * dt * k) / n, s.pos[2] + (s.vel[2] * dt * k) / n]
        const wall = MAP.solidAt(p[0], p[1], p[2]) || p[2] < MAP.groundAt(p[0], p[1])
        const hit = this.hitAt(p, owner)
        if (hit || wall) {
          done = true
          if (s.kind === "gun" && hit && owner) this.applyHit(hit, owner.wst.gun.damage, owner, "gun", s.origin)
          else if (s.kind === "npc" && hit?.kind === "mech") this.damage(hit.e, C.npc.damage, "npc", null, s.origin)
          else if (s.kind === "mortar" && owner) this.explode(p, owner, hit)
        }
      }
      if (done) continue
      s.pos = [s.pos[0] + s.vel[0] * dt, s.pos[1] + s.vel[1] * dt, s.pos[2] + s.vel[2] * dt]
      s.dist += step
      if (s.kind === "mortar" ? (s.ttl -= dt) > 0 : s.dist < (s.range ?? 300)) keep.push(s)
    }
    this.shots = keep
  }
  explode(p: V3, owner: Mech, direct: any) {
    const st = owner.wst.mortar
    this.sound("explosion", p, -1)
    if (direct) this.applyHit(direct, st.damage, owner, "mortar", p)
    for (const o of this.mechs) {
      if (!o.alive || (direct && direct.e === o) || (o.team === owner.team && o !== owner)) continue
      const d = Math.hypot(o.pos[0] - p[0], o.pos[1] - p[1], o.pos[2] + o.h / 2 - p[2])
      if (d > st.splash_radius + o.r) continue
      const f = 1 - (1 - st.splash_edge) * Math.min(1, d / st.splash_radius)
      this.damage(o, st.splash * f, "mortar", owner, p)
      o.energy = Math.max(0, o.energy - st.drain * f)
    }
  }
  world(dt: number) {
    for (const n of this.npcs) {
      n.cd -= dt
      let tgt = n.target >= 0 && this.mechs[n.target]?.alive ? this.mechs[n.target] : null
      if (tgt && hd(n.pos, tgt.pos) > C.npc.deaggro_range) (n.target = -1), (tgt = null)
      if (!tgt && this.tick % 4 === 0)
        for (const m of this.mechs)
          if (m.alive && hd(n.pos, m.pos) < C.npc.aggro_range && MAP.los([n.pos[0], n.pos[1], n.pos[2] + 3], [m.pos[0], m.pos[1], m.pos[2] + 4], 1)) (tgt = m), (n.target = m.id)
      if (tgt && n.cd <= 0) {
        const from = [n.pos[0], n.pos[1], n.pos[2] + 3]
        const tc = [tgt.pos[0], tgt.pos[1], tgt.pos[2] + tgt.h / 2]
        const d = Math.hypot(tc[0] - from[0], tc[1] - from[1], tc[2] - from[2])
        const yaw = yawTo(from, tc) + ((C.npc.spread_deg * Math.PI) / 180) * gauss(this.R), pit = Math.asin((tc[2] - from[2]) / d)
        const v = C.npc.projectile_speed
        this.shots.push({ id: this.nextId++, kind: "npc", owner: -1, pos: from, origin: from, vel: [Math.cos(pit) * Math.cos(yaw) * v, Math.cos(pit) * Math.sin(yaw) * v, Math.sin(pit) * v], dist: 0, range: 120 })
        n.cd = C.npc.cooldown
        this.sound("npc_gun", n.pos, -1)
      }
    }
    this.cubes = this.cubes.filter((c) => {
      let best: Mech | null = null, bd = C.cubes.pickup_radius
      for (const m of this.mechs) if (m.alive && Math.abs(m.pos[2] - c.pos[2]) < 4 && hd(m.pos, c.pos) <= bd) (bd = hd(m.pos, c.pos)), (best = m)
      if (!best) return true
      this.addCubes(best, 1)
      best.events.push({ type: "pickup", cubes: best.cubes })
      return false
    })
    const z = this.zoneNow()
    for (const d of this.drops) {
      if (d.taken || this.t < d.call) continue
      if (!d.pos) {
        d.pos = this.freePoint(z.next_center, z.next_radius * 0.7)
        this.sound("drop", d.pos, -1)
      }
      if (this.t < d.call + C.drops.fall_s) continue
      const inside = this.mechs.filter((m) => m.alive && hd(m.pos, d.pos) <= C.drops.radius)
      if (inside.length === 1) {
        if (d.holder !== inside[0].id) (d.holder = inside[0].id), (d.progress = 0)
        d.progress += dt
        if (d.progress >= C.drops.capture_s) {
          const m = inside[0]
          d.taken = true
          this.addCubes(m, C.drops.cubes)
          m.hp = m.maxHp
          m.energy = m.stats.energy
          m.events.push({ type: "drop", id: d.id, cubes: m.cubes })
        }
      } else if (inside.length === 0) (d.holder = null), (d.progress = 0)
    }
    for (const m of this.mechs)
      if (m.alive && m.offers.length && this.t > m.offers[0].expires) {
        this.applyUpgrade(m, m.offers[0].choices[0].id)
        m.offers.shift()
      }
  }
}
