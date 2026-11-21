# Mech Royale bot: tunable parameters and recorded effects

A brief for brainstorming parameter combinations. Everything below lives in `src/params.ts` (plus a few
flags the code reads that are currently unset, listed in their own section). Repo:
https://github.com/alexwilldev/mechroyale-bot

## The game, in brief

- 16-mech battle royale on a 3D campus map. Our bot pilots one mech, answering every 0.1 s.
- Score per match = 16 − place. The leaderboard shows the mean over 48 practice matches.
- **Practice board (what these scores are):** us against 15 house bots that act as one squad. They hunt us
  "weakest first": one hunter at the start, more as we kill them, all of them late. So practice points are
  roughly the number of house bots that die before we do. House bots never fight each other.
- **Evidence from top teams (read from their public repos):** idle house bots wake up and join the hunt
  when shot, or when we come within about 40–60 m. Shooting at range wakes extra hunters.
- **Qualifying and final:** free-for-all against other teams' bots, on new seeds. Practice only decides
  who gets in. The top-32 line was about 5.27–5.33 Saturday and rising; first place is about 6.31.
- **Weapons:**
  - gun: 45 per shot, 0.24 s, 252 m/s projectile, 230 m range
  - laser: hitscan, up to 315 damage after a 0.75 s charge, 280 m range, 1.65 s cooldown
  - lightning: 60 per shot, 45 m range, 30° cone, costs energy
  - mortar: ballistic, splash damage
  - Hits from behind do ×1.5. Cubes give +4% HP and damage each (max 10).

## How to read the evidence

- **REAL** = practice board score for that exact build (48 matches). Same-build noise is about ±0.3:
  batch 20 scored 4.13 and then 3.88, with identical code.
- **LIVE** = matches on the organizers' real engine (play.joinbuilders.org), free-for-all against house
  bots, 8 matches per arm. Unit = mean (16 − place). Noise is about ±1.5 at n=8.
- **SIM** = our local simulator. The current calibration (house bots wake when shot or approached,
  `--aim 1.6 --wakeR 40`) reproduces real gaps (batch 31 − batch 20: sim +0.52, real +0.5), but it sits
  about 0.6 below real. Earlier, uncalibrated sim results misled us badly on range and selective fighting:
  treat any "SIM (old)" result as weak evidence.

## Best build so far

**Batch 31 (commit 4e2a7d3): REAL 4.52 (best), LIVE free-for-all 11.75.** Its parameters are the current
`src/params.ts` values below. For comparison, the top public bots tested LIVE in free-for-all scored
10.62 (giddy, 6.00 in practice) and 9.88 (Jishnu, 5.81 in practice). Our free-for-all play is fine; the
gap is practice-only.

## Real score history (what moved the needle)

| Build | Change | REAL |
| --- | --- | --- |
| batch 0 | turtle: hold the zone centre | 2.38 / 2.71 |
| batch 1 | focus fire, loot seeking, cover while reloading, range keeping | 3.35 |
| batch 2 | + laser and mortar dodging | 3.48 |
| batch 9 | + per-tick time budget (late answers had been costing us) | 3.73 |
| batch 16 | **laser seeking even mid-fight** (sim: laser from start = +1.9) | 3.85 |
| batch 17 / 18 | laser range 230 / 255 m | 3.79 / 3.42 |
| batch 19 | laser 150 m | 3.60 |
| **batch 20** | **laser 110 m, gun 90 m** | **4.13** (re-run: 3.88, 4.17) |
| batch 21 / 22 | laser 80 / gun 70; laser 50 / gun 45 | 3.69 / 4.04 |
| batch 23 | lightning on (close in to 28 m) | 3.65 |
| batch 26 | duel one at a time + laser peek + pre-charge on footsteps | 3.71 |
| batch 27 | "predator" targeting: backstab, counters, zone victims, zone hold, drone lure | 4.25 |
| batch 28 / 29 | + silent walking (/ + doubled bonuses) | 3.58 / 3.54 |
| batch 30 | 27 with doubled predator bonuses | 3.83 |
| **batch 31** | **27 + selective fights (engage ≤60 m, attackers, targets below 30% HP)** | **4.52** |
| batch 32 | 31 + heal-to-full (no new fights from 55% HP until 95%) | 4.40 |
| batch 33 | 31 + giddy-style wide engagement, fight boost >40 energy, lethal partial laser, lock 200 | 3.79 |
| batch 34 | 33 in practice, 31 behaviour once a free-for-all is detected | 3.98 |
| batch 35 | 31 + flee when the fight-odds model gives P(win) < 0.45 | 4.19 |

## Parameters (current value = batch 31) and recorded effects

### Fight selection (biggest lever so far)

| Param | Value | Meaning | Evidence |
| --- | --- | --- | --- |
| engageRange | 60 | Only start fights with mechs this close (plus the exceptions below) | REAL 9999 → 60: 4.25 → **4.52**. SIM (calibrated) 40/85/110: 3.81/3.90/4.08 vs 3.87 (noise; 110 better on 1 of 2 seeds) |
| (attacker rule) | 6 s | Always engage anyone who damaged us in the last 6 s | Part of batch 31 |
| finishHp | 0.3 | Also engage any visible mech below this HP fraction | SIM 0.15/0.5: 3.74/3.83 (noise) |
| oddsEngage | 0 (off) | Also engage when fight-odds P(win) ≥ this, within oddsRange | SIM 0.7/0.8/0.9: −0.2 to −0.4 (wakes more bots) |
| oddsRange | 160 | Range for oddsEngage | |
| oddsFlee | 0 (off) | Retreat when P(win) for the current target < this (practice only) | REAL 0.45 → 4.19 (worse); SIM neutral |
| oddsW | fitted | Logistic coefficients: b0 1.778, lhp (log HP ratio) 1.775, cubes −0.657, weap (weapon-count diff) 1.162, others (other enemies with line of sight on us) −0.653, dist (/100 m) 0.078, back −0.133 | Own fit on 903 sim fights, 82% accuracy |
| ffaDeaths | 2 | Deaths we didn't cause before switching to free-for-all mode | Never fires in practice by design |
| ffaOverrides | {} | Params swapped in when free-for-all is detected | Batch 34 used it; practice 3.98 (confounded) |

### Target choice (score = hp + dist × targetDistW − bonuses; lowest wins; no line of sight +900)

| Param | Value | Evidence |
| --- | --- | --- |
| targetDistW | 4 | SIM (old) 2/8: noise |
| lockBonus | 150 | Bonus for keeping the current target. SIM (old) 400/600/1200: worse (3.11 at 1200). Batch 33 used 200 (confounded) |
| attackerBonus | 250 | Bonus for whoever hit us in the last 3 s. SIM (old) 600: noise |
| rearBonus | 0 | Bonus for whoever hit us in the back. SIM (old) 600/1500: noise |
| backstab | 300 | Bonus when the target faces away. REAL part of batch 27 (+0.25 bundle). Doubled (600): batch 30 3.83 |
| counterBonus | 200 | Laser vs mortar carrier, lightning vs laser carrier. In batch 27 bundle; doubled in batch 30 |
| zoneVictim | 250 | Bonus for targets standing outside the circle. In batch 27 bundle |

### Weapons and ranges

| Param | Value | Evidence |
| --- | --- | --- |
| weaponScore | laser 3, mortar 2, lightning 1 | SIM (old): starting with a laser +1.9, mortar +0.3, lightning −0.2. REAL batch 16 (laser seeking) +0.1–0.4 |
| laserRange | 110 m | Preferred fight distance with a laser. REAL: 255→3.42, 230→3.79, 150→3.85/3.60, **110→4.13**, 80→3.69, 50→4.04. SIM said longer is better: wrong |
| gunRange | 90 m | Preferred distance with the gun only. REAL tied to the laser range rows above |
| lightningRange | 130 (off) | 28 means close in for lightning. REAL batch 23 (28) 3.65 < 4.13 |
| laserLead | 0.1 s | Aim lead for the laser. SIM 0: noise |
| laserMemory | 60 s | How long to remember a seen laser pickup |
| laserDetour | 250 m | Fetch a remembered laser this far away, even mid-fight. SIM 150/400: noise |
| laserDetourEarly | 400 m | Same, in the first 60 s |
| laserScanSpin | 0.35 | Spin the torso while unarmed to spot lasers. SIM +0.08 (noise) |
| laserScanUntil | 150 s | |
| exploreUntil | 0 (off) | Explore unseen ground for a laser. SIM 200: −0.1 |
| mortarMinRange | 18 m | No mortar closer than this (splash) |
| lightningEnergyFloor | 12 | |
| reloadBelow | 0.5 | Reload when there's no shot and the magazine is below this. REAL batch 8, in noise |

### Movement in fights

| Param | Value | Evidence |
| --- | --- | --- |
| strafeFlip | 0.6 s | Strafe direction-change period, randomised ×0.6–1.4. SIM (old) 0.6 vs 0.9: +; 1.6: −0.1 |
| fightBoostOn / Off | 80 / 45 | Boost-strafe in fights above On energy until below Off. SIM (old) boost off: **−0.66**; 60/25: −0.3; 40/10: −0.1. Batch 33 used 40/35 (bundle 3.79). A top team found boost hurts in free-for-all |
| fightBoostPracticeOnly | unset (false) | Disable fight boost once a free-for-all is detected |
| retreatHp | 0.35 | Break line of sight below this HP fraction when the enemy has more HP. SIM (old) 0/0.5: noise; REAL 0.55 + heal-to-full = batch 32 (4.40) |
| spreadBackoff | 0 (off) | Back away when enemies are spread >90° around us. SIM 0.7/1.5: noise |
| isolate | false | Take cover from all but the target when 2+ enemies see us. REAL bundle 26: 3.71 |
| laserPeek | false | Hide while the laser charges, step out to fire. REAL bundle 26 |
| preCharge | false | Pre-charge the laser at unseen footsteps. REAL bundle 26 |
| laserDodgeYaw | 0.15 rad | Dodge a charging laser aimed this close to us. SIM 0.3: no data |
| dodgeEnergy | 20 | Energy kept back before boost-dodging. SIM 45: −0.1; 5: noise |

### Economy, healing, positioning

| Param | Value | Evidence |
| --- | --- | --- |
| healStart / healUntil | 0 (off) / 0.95 | Stop new fights below healStart until back above healUntil. REAL batch 32 (0.55/0.95): 4.40 < 4.52; calibrated SIM −0.23 |
| recoverHp | 0.6 | With no enemy in sight below this HP: hold still and regenerate. SIM 0/0.4/0.8/0.85: noise |
| npcHuntHp | 0.65 | Start fights with NPC drones only above this HP. SIM (old) 0.95: −0.3; 0.4: noise |
| npcRange | 80 m | Engage drones this close. REAL 120 (in batch 10 farming bundle) worse |
| crateShootRange | 70 m | Shoot crates when no threat. REAL 110 (batch 10 bundle) worse |
| lootDetour | 80 m | Walk to visible cubes this close |
| pickupDetour | 160 m | Walk to wanted weapon pickups this close |
| farmCubes / farmUntilT | 0 (off) / 230 | Keep roaming to farm until N cubes or this time. REAL batch 10 (8 cubes): 3.56; batch 11: 3.17 |
| roamUntilT | 100 s | Roam for loot until then (or while slot 2 is empty) |
| silentWalk / silentFrac | false / 0.4 | Walk under 5 m/s (no footsteps) when no enemy is seen. REAL 3.58 / 3.54 → off |
| zoneHold | true | Never follow a target out of the circle. Batch 27 bundle |
| droneLure | true | When losing, retreat past a known drone. Batch 27 bundle |
| zoneSafety | 0.75 | Stay within this fraction of the next circle's radius |
| endgameRadius | 70 m | Once the next circle is this small, stand on its exact centre |
| useRoofs (+ roofMin 6, roofMax 40, roofArea 400, roofSearch 250, climbTimeout 5) | true | Camp on rooftops when idle. REAL batch 15: 3.52 (no help); SIM noise |
| holdSamples / holdSearch / holdRay | 12 / 45 / 50 | Covered hold-spot search |
| dropRange / dropLate | 170 m / 12 s | Go for supply drops when no enemy is in sight |
| threatMemory | 4 s | Keep facing the last damage bearing |
| upgradeOrder | plating, laser_damage, gun_damage, laser_charge, armor, ... | REAL defensive order (plating, armor, nanites first) on batch 20: 4.04 (noise) |

### Engine and timing (keep as they are)

replanEvery 1.5, minReplan 0.5, hardBudgetMs 20, softBudgetMs 8, maxExpand 5000. These fixed late answers
(batch 9: wait 0 ms, 3.73). The bot uses about 1–5 ms of its 50 ms budget per decision.

## Code paths currently unset (read by the code, all off at batch 31)

- **wideEngage** (with weakFrac 0.4, weakRange 160, aimRange 190, aimTol 0.25, approachRange 180,
  approachSpeed 1): also engage mechs that are approaching, weak and in range, or aiming at us. Part of
  batch 33 (3.79).
- **lethalLaser**: release a partial laser charge when it would already kill the target. Part of batch 33.

## Observations that constrain the search

1. **Waking house bots seems to be the main cost.** Anything that starts more fights at range (wider
   engagement, odds-based engagement, long-range kiting) has scored worse on the real board.
2. **Real house bots aim well at long range** (they hit a dodging target at about 150 m in the kit's
   recorded match), so distance doesn't protect us. Fighting at about 110 m or less scored best.
3. **Bundles of rules from top bots don't transplant.** Giddy's pieces made us worse (3.79/3.98), but its
   whole practice logic scores 6.00. Its practice settings, readable in its public repo: laser range 120,
   loot radius 150, always shoot crates, loot mid-fight within 70 m, farm only above about 35% HP,
   laser seek 240, finish weak foes at 20 m, stickiness 200, low-HP-target bonus 200, HP weight 0.18,
   plus a fitted P(win) model for opening and fleeing fights.
4. **What other top teams report** (their own notes): "never retreat" helped one 5.15 team, but not
   retreating cost another (5.58 → 5.17). Heal-to-full (retreat at 55%, re-engage at 95%) gave one team
   its best (5.27), but scored 4.40 for us. Selective engagement around 60 m scored 5.13 for another
   team, matching our batch 31.
5. **Practice and free-for-all differ:** fight boost and wide engagement help some teams in practice and
   hurt in free-for-all. A free-for-all detector (2 deaths we didn't cause) can switch profiles; it never
   fires in practice.
