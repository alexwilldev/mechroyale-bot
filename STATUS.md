# STATUS — Mech Royale bot (handoff file; new sessions read this + src/params.ts first)

Full plan: `~/.claude/plans/create-a-plan-to-vast-sifakis.md`. Cutoff **Sun 11:00 AM ET**.

## Current phase
Phase 0 done → next: **Phase 1 (world model)**.

## Done
- Repo scaffold: `Dockerfile` (oven/bun:1.4.4-slim pinned), `src/mechfight.ts` (kit wrapper, unchanged), `kit/` (kit incl. map + check.py; excluded from image via .dockerignore).
- `src/main.ts` = Phase 0 "zone-centre turtle": holds 75% of next circle, stands exactly on next_center once next radius ≤ 70; loots cubes/pickups and shoots crates/NPCs when quiet; gun lead-aim with intercept solve; laser charge/release, lightning cone, mortar ballistic pitch; strafes vs mechs; faces last damage/sound bearing; stuck → jump/jet + sidestep; upgrade priority from `params.ts`; FFA-mode detector (telemetry only); debug label = telemetry.
- check.py PASS locally and in the scorer sandbox. Native container: max 6 ms/answer. Under amd64 emulation on the Mac, ~2/300 answers come late (emulation only; the scorer builds amd64 natively).

## Next 3 tasks
1. `src/world/map.ts`: load world.json + terrain.i16, prism grid index, heightAt (bilinear), segment LOS vs prisms (+canopy).
2. `src/world/nav.ts`: 4 m nav grid + A*, step-up/slope, roof access; use it for movement goals (replaces naive straight-line + unstick).
3. Fire gating by LOS (stop shooting into walls at memory-tracked mechs).

## Submissions (commit → practice score)
| commit | what | score |
| --- | --- | --- |
| 17115f2 | Phase 0 turtle | ? |

Baseline to beat: 1.15.

## Commands
```sh
python3 kit/check/check.py -- bun src/main.ts
docker build --platform linux/amd64 -t mr-bot .
python3 kit/check/check.py --map-dir /arena -- docker run --rm -i --platform linux/amd64 --network none --cpus 1 --memory 512m --read-only --tmpfs /tmp:rw,size=64m --user 65534:65534 -v "$PWD/kit/arena:/arena:ro" mr-bot
```
