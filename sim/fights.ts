/**
 * Fight-outcome data + logistic fit, from the calibrated practice sim (house bots wake when shot/approached).
 *   bun sim/fights.ts [--n 300] [--seed 31]
 * For every engagement our bot opens (its target changes to a new mech), record features at that moment and
 * whether the target died before we did (win=1) or we died first (win=0); undecided after 30 s is dropped.
 * Prints fitted coefficients for: p(win) = 1 / (1 + exp(-(b0 + b·x))).
 */
import { Turtle } from "../src/main.ts"
import { P } from "../src/params.ts"
import { Match, rng } from "./sim.ts"

const args = Object.fromEntries(process.argv.slice(2).reduce((acc: string[][], a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1] ?? ""]] : acc), []))
const N = Number(args.n ?? 300), SEED = Number(args.seed ?? 31)
Object.assign(P, { engageRange: 9999 }) // engage widely so the data covers long-range openings too
const FEATS = ["lhp", "cubes", "weap", "others", "dist", "back"] as const
type Rec = Record<(typeof FEATS)[number], number> & { win: number }
const recs: Rec[] = []
const hd = (a: number[], b: number[]) => Math.hypot(b[0] - a[0], b[1] - a[1])
const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI

for (let k = 0; k < N; k++) {
  Math.random = rng(SEED * 7919 + k)
  const m = new Match({ seed: SEED * 1000 + k, mode: "practice", bots: [(h: any) => new Turtle(h)], aimMul: 1.6, wake: true, wakeR: 40 })
  const us = m.mechs[0]
  const bot = us.bot as any
  let open: { id: number; t: number; f: Omit<Rec, "win"> } | null = null
  let lastTgt = -1
  while (m.t < 480 && us.alive) {
    if (m.tick % 2 === 0) m.decide()
    m.physics()
    m.tick++
    m.t = m.tick / 20
    if (m.tick % 2 !== 0) continue
    // close an open engagement
    if (open) {
      const tg = m.mechs[open.id]
      if (!tg.alive) (recs.push({ ...open.f, win: 1 }), (open = null))
      else if (m.t - open.t > 30) open = null
    }
    const tid = bot.lastTarget
    if (tid !== lastTgt && tid >= 0 && tid < 16 && m.mechs[tid].alive && !open) {
      const tg = m.mechs[tid]
      const others = m.mechs.filter((o) => o.alive && o !== us && o !== tg && o.team !== us.team && hd(o.pos, us.pos) < 220 && m.sees(o, us.pos, us.h)).length
      const back = Math.abs(wrap(tg.aim[0] - Math.atan2(us.pos[1] - tg.pos[1], us.pos[0] - tg.pos[0]))) > Math.PI / 2 ? 1 : 0
      open = {
        id: tid,
        t: m.t,
        f: {
          lhp: Math.log(Math.max(us.hp, 1) / Math.max(tg.hp, 1)),
          cubes: (Math.min(us.cubes, 10) - Math.min(tg.cubes, 10)) / 10,
          weap: us.weapons.filter((w) => w).length - tg.weapons.filter((w) => w).length,
          others,
          dist: hd(us.pos, tg.pos) / 100,
          back,
        },
      }
    }
    lastTgt = tid
  }
  if (open && !us.alive) recs.push({ ...open.f, win: 0 })
}

// logistic regression by batch gradient descent (features are small and well scaled)
const X = recs.map((r) => FEATS.map((f) => r[f]))
const y = recs.map((r) => r.win)
let w = new Array(FEATS.length + 1).fill(0)
const sig = (z: number) => 1 / (1 + Math.exp(-z))
for (let it = 0; it < 4000; it++) {
  const g = new Array(w.length).fill(0)
  for (let i = 0; i < X.length; i++) {
    const z = w[0] + X[i].reduce((s, v, j) => s + v * w[j + 1], 0)
    const e = sig(z) - y[i]
    g[0] += e
    X[i].forEach((v, j) => (g[j + 1] += e * v))
  }
  w = w.map((wi, j) => wi - (0.5 * g[j]) / X.length - (j ? 0.001 * wi : 0))
}
const acc = X.filter((x, i) => (w[0] + x.reduce((s, v, j) => s + v * w[j + 1], 0) > 0 ? 1 : 0) === y[i]).length / X.length
console.log(`fights=${recs.length} winRate=${(y.reduce((a, b) => a + b, 0) / y.length).toFixed(2)} trainAcc=${acc.toFixed(2)}`)
console.log(`b0=${w[0].toFixed(3)} ` + FEATS.map((f, j) => `${f}=${w[j + 1].toFixed(3)}`).join(" "))
console.log(JSON.stringify({ b0: +w[0].toFixed(3), ...Object.fromEntries(FEATS.map((f, j) => [f, +w[j + 1].toFixed(3)])) }))
