# STATUS — Mech Royale bot (handoff file; new sessions read this + src/params.ts first)

Full plan: `~/.claude/plans/create-a-plan-to-vast-sifakis.md`. Cutoff **Sun 11:00 AM ET**.

## Current phase
PIVOT (user call): sim paused; shipping combat batches straight to the real scorer. No match replays are available, so the scorer is the only feedback.
Phase 0 + Phase 1 done → next: **Phase 2 (sandbox sim)**, then Phase 3 (combat core).

## Phase 1 (world model) — done
- `src/world/map.ts` `GameMap`: terrain (bilinear), prisms rasterized onto the 1 m grid as [base, top] intervals per cell, `solidAt`, `surfaceAt`, `los` (shots: prisms + terrain; trees ignored since they don't stop shots), `rayWall`. Loads in ~90 ms; LOS ~3 µs.
- `src/world/nav.ts` `Nav`: 3 m grid, clearance 2.3 m, step-up/slope, headroom 9 m, A* (binary heap, expansion cap, partial paths), `lineFree`, `nearestFree`. Builds in ~60 ms; A* p50 0.5 ms, p90 5 ms, worst ~26 ms uncapped (capped at 15k expansions in the bot).
- Validated against the recorded stream: grounded heights match the map within 6 mm.
- `main.ts`: movement follows A* routes (string-pulled, replan every 1.5 s or when the goal moves); walks straight when on a roof; gun/laser fire only with a clear shot line; crates only targeted with LOS; JIT warmup at hello; label shows ms per tick and max ms.
- `bun test` (test/world.test.ts): 7 pass.
- Known gaps: no rooftop routing (jump/jet edges), no vision/canopy model, unstick logic still the Phase 0 heuristic.

## Done
- Repo scaffold: `Dockerfile` (oven/bun:1.4.4-slim pinned), `src/mechfight.ts` (kit wrapper, unchanged), `kit/` (kit incl. map + check.py; excluded from image via .dockerignore).
- `src/main.ts` = Phase 0 "zone-centre turtle": holds 75% of next circle, stands exactly on next_center once next radius ≤ 70; loots cubes/pickups and shoots crates/NPCs when quiet; gun lead-aim with intercept solve; laser charge/release, lightning cone, mortar ballistic pitch; strafes vs mechs; faces last damage/sound bearing; stuck → jump/jet + sidestep; upgrade priority from `params.ts`; FFA-mode detector (telemetry only); debug label = telemetry.
- check.py PASS locally and in the scorer sandbox. Native container: max 6 ms/answer. Under amd64 emulation on the Mac, ~2/300 answers come late (emulation only; the scorer builds amd64 natively).

## Next 3 tasks
1. `sim/`: sandbox on top of `src/world` (tick loop, movement physics with wall slide, gun/laser/lightning/mortar, zone, crates/NPCs/cubes, loot) that spawns bot processes over stdin/stdout.
2. Scripted hunter squad (shared vision, weakest-first, ramps up over time) + batch runner printing mean 16-place, kills, cause of death, p99 tick ms.
3. Phase 3 combat: tracker, cover use (peek/shoot), facing the threat for rear armor, laser dodge.

## Submissions (commit → practice score)
| commit | what | score |
| --- | --- | --- |
| 17115f2/4414355 | Phase 0 turtle / Phase 1 map+nav | 2.38, 2.71 (17th; leader 4.77) |
| a1eebe1 | Combat batch 1: focus fire, loot seeking, roaming, cover on reload/low hp, range keeping | 3.35 (12th) |
| e3d7d85 | Combat batch 2: laser + mortar dodge, A* cap 8k (tick max 6 ms in 1-CPU sandbox) | 3.48 (12th) |
| 96f0333 | Combat batch 3: laser aims hitscan (no gun lead), mortar leads target by flight time, recover state (hold still to regen < 60% hp) | ? |
| (next) | Combat batch 4: face approaching footsteps/boost/jet sounds, capture supply drops when quiet, A* replan floor 0.5 s | ? |

Baseline to beat: 1.15.

## Commands
```sh
python3 kit/check/check.py -- bun src/main.ts
docker build --platform linux/amd64 -t mr-bot .
python3 kit/check/check.py --map-dir /arena -- docker run --rm -i --platform linux/amd64 --network none --cpus 1 --memory 512m --read-only --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/kit/arena:/arena:ro" mr-bot
```
