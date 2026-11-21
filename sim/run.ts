/**
 * Batch runner: bun sim/run.ts [--n 20] [--seed 1] [--mode practice|ffa] [--svg out.svg] [--hunters 1] [--allHunt 300]
 * Prints mean placement points and diagnostics for our bot (slot 0).
 */
import { writeFileSync } from "node:fs"
import { Turtle } from "../src/main.ts"
import { MAP, Match, rng } from "./sim.ts"
import { P } from "../src/params.ts"

const args = Object.fromEntries(process.argv.slice(2).reduce((acc: string[][], a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []))
const N = Number(args.n ?? 20), SEED = Number(args.seed ?? 1), MODE = (args.mode ?? "practice") as "practice" | "ffa"
const realRandom = Math.random
// --b key=val,... : variant B bots (FFA head-to-head), --nb count (default 0)
const overB: any = {}
for (const kv of (args.b ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=")
  overB[k] = v === "true" ? true : v === "false" ? false : Number(v)
}
const nB = Number(args.nb ?? 0)
const ptsA: number[] = [], ptsB: number[] = []
// --set key=val,key2=val2 overrides bot params (A/B tests without code edits)
for (const kv of (args.set ?? "").split(",").filter(Boolean)) {
  const [k, v] = kv.split("=")
  ;(P as any)[k] = v === "true" ? true : v === "false" ? false : Number(v)
}

const agg: any = { pts: [], kills: [], deathT: [], deathBy: {}, dmgIn: {}, shots: {}, hits: {}, states: {}, stuck: [], ms: [], maxMs: 0, cubes: [], weapons: {} }
let traced: Match | null = null
const t0 = performance.now()
for (let k = 0; k < N; k++) {
  Math.random = rng(SEED * 7919 + k * 104729) // reproducible bot randomness
  const nOurs = MODE === "ffa" ? Number(args.ours ?? 4) : 1
  const m = new Match({ seed: SEED * 1000 + k, mode: MODE, bots: [...Array.from({ length: nOurs }, () => (h: any) => new Turtle(h)), ...Array.from({ length: nB }, () => (h: any) => new Turtle(h, overB))], huntersAtStart: Number(args.hunters ?? 1), allHuntT: Number(args.allHunt ?? 300), trace: !!args.svg && k === 0, idleEngage: Number(args.idle ?? 45), aimMul: Number(args.aim ?? 1), startWeapon: args.start || undefined })
  m.run()
  Math.random = realRandom
  if (k === 0) traced = m
  for (const me of m.mechs.filter((x) => x.bot)) {
    ;(me.id < nOurs ? ptsA : ptsB).push(16 - me.place)
    agg.pts.push(16 - me.place)
    agg.kills.push(me.kills)
    agg.deathT.push(me.alive ? m.t : me.log.deathT)
    const why = me.alive ? "survived" : me.log.deathBy
    agg.deathBy[why] = (agg.deathBy[why] ?? 0) + 1
    for (const [k2, v] of Object.entries(me.log.dmgIn)) agg.dmgIn[k2] = (agg.dmgIn[k2] ?? 0) + (v as number)
    for (const [k2, v] of Object.entries(me.log.shots)) agg.shots[k2] = (agg.shots[k2] ?? 0) + (v as number)
    for (const [k2, v] of Object.entries(me.log.hits)) agg.hits[k2] = (agg.hits[k2] ?? 0) + (v as number)
    for (const [k2, v] of Object.entries(me.log.states)) agg.states[k2] = (agg.states[k2] ?? 0) + (v as number)
    agg.stuck.push(me.log.stuck)
    agg.ms.push(...me.log.ms)
    agg.maxMs = Math.max(agg.maxMs, me.log.maxMs)
    agg.cubes.push(me.cubes)
    agg.laserT = agg.laserT ?? []
    agg.laserT.push(me.log.laserT || 999)
    const ws = me.weapons.filter((w) => w).map((w) => w!.kind).join("+")
    agg.weapons[ws] = (agg.weapons[ws] ?? 0) + 1
  }
}
const nOursG = MODE === "ffa" ? Number(args.ours ?? 4) : 1
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)
const sd = (a: number[]) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)))
agg.ms.sort((a: number, b: number) => a - b)
const totalT = Object.values(agg.states).reduce((s: number, x: any) => s + x, 0) as number
const fmt = (o: any, f = (v: number) => v.toFixed(0)) => Object.entries(o).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]) => `${k}=${f(v as number)}`).join("  ")
console.log(`mode=${MODE} matches=${N} seed=${SEED} wall=${((performance.now() - t0) / 1000).toFixed(1)}s`)
console.log(`POINTS mean ${mean(agg.pts).toFixed(2)} (sd ${sd(agg.pts).toFixed(2)}, se ${(sd(agg.pts) / Math.sqrt(agg.pts.length)).toFixed(2)})  kills ${mean(agg.kills).toFixed(2)}  death t ${mean(agg.deathT).toFixed(0)}s  cubes ${mean(agg.cubes).toFixed(1)}`)
const lt = (agg.laserT ?? []).slice().sort((a: number, b: number) => a - b)
console.log(`laser acquired: by 15s ${lt.filter((x: number) => x <= 15).length}%  by 30s ${lt.filter((x: number) => x <= 30).length}%  by 60s ${lt.filter((x: number) => x <= 60).length}%  ever ${lt.filter((x: number) => x < 999).length}%  (n=${lt.length})`)
console.log(`death by: ${fmt(agg.deathBy)}`)
if (nB) console.log(`HEAD2HEAD A(${nOursG}) ${mean(ptsA).toFixed(2)} (se ${(sd(ptsA) / Math.sqrt(ptsA.length)).toFixed(2)})  vs  B(${nB}) ${mean(ptsB).toFixed(2)} (se ${(sd(ptsB) / Math.sqrt(ptsB.length)).toFixed(2)})`)
console.log(`dmg taken (total): ${fmt(agg.dmgIn)}`)
console.log(`shots: ${fmt(agg.shots)}   hits: ${fmt(agg.hits)}   hit%: ${Object.keys(agg.shots).map((k) => `${k}=${((100 * (agg.hits[k] ?? 0)) / agg.shots[k]).toFixed(0)}%`).join(" ")}`)
console.log(`time in state: ${fmt(agg.states, (v) => ((100 * v) / totalT).toFixed(1) + "%")}`)
console.log(`stuck s/match: ${mean(agg.stuck).toFixed(1)}   end loadout: ${fmt(agg.weapons)}`)
console.log(`act ms p50 ${agg.ms[agg.ms.length >> 1]?.toFixed(2)} p99 ${agg.ms[Math.floor(agg.ms.length * 0.99)]?.toFixed(2)} max ${agg.maxMs.toFixed(1)}`)

if (args.svg && traced) {
  const b = MAP.bounds, W = b.maxX - b.minX, H = b.maxY - b.minY
  const X = (x: number) => (x - b.minX).toFixed(1), Y = (y: number) => (b.maxY - y).toFixed(1)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="background:#111">`
  for (const p of MAP.prisms) {
    const pts = []
    for (let k = 0; k < p.ring.length; k += 2) pts.push(`${X(p.ring[k])},${Y(p.ring[k + 1])}`)
    s += `<polygon points="${pts.join(" ")}" fill="#333" stroke="#555" stroke-width="0.5"/>`
  }
  const colors: Record<string, string> = { fight: "#ff4040", roam: "#40c0ff", loot: "#40ff80", hold: "#ffffff", rotate: "#ffd040", recover: "#c080ff", retreat: "#ff80c0", "reload-cover": "#ff9040", drop: "#00ffff", endgame: "#ffff00", roof: "#80ff00", "to-roof": "#80c000", climb: "#a0ff40" }
  const byId = new Map<number, any[]>()
  for (const tr of traced.trace) (byId.get(tr.id) ?? byId.set(tr.id, []).get(tr.id)!).push(tr)
  for (const [id, pts] of byId) {
    const ours = traced.mechs[id].bot
    for (let k = 1; k < pts.length; k++)
      s += `<line x1="${X(pts[k - 1].p[0])}" y1="${Y(pts[k - 1].p[1])}" x2="${X(pts[k].p[0])}" y2="${Y(pts[k].p[1])}" stroke="${ours ? colors[pts[k].st] ?? "#ccc" : "#a03030"}" stroke-width="${ours ? 3 : 1}" opacity="${ours ? 1 : 0.6}"/>`
    const last = pts[pts.length - 1]
    if (last && !traced.mechs[id].alive) s += `<text x="${X(last.p[0])}" y="${Y(last.p[1])}" fill="${ours ? "#fff" : "#f66"}" font-size="${ours ? 18 : 10}">✕${ours ? " us " + traced.mechs[id].log.deathBy + " @" + traced.mechs[id].log.deathT.toFixed(0) + "s" : ""}</text>`
  }
  let ly = 20
  for (const [k, c] of Object.entries(colors)) (s += `<text x="10" y="${ly}" fill="${c}" font-size="14">${k}</text>`), (ly += 16)
  s += `</svg>`
  writeFileSync(args.svg, s)
  console.log(`trace -> ${args.svg}`)
}
