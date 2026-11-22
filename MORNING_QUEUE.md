# Mech Royale: morning submission queue

Repo for every entry: https://github.com/alexwilldev/mechroyale-bot (paste the full hash into the commit field).

**Scoring changed (Sun 1:00 AM, scorer builders-4):**
- Every practice run now plays 96 fresh random seeds, up from 48 fixed ones.
- Identical code keeps its first builders-4 score, so **re-submitting batch 31 does nothing**. The repeat controls are removed.
- The organizers are rescoring each team's picked or best entry automatically. Check the board for batch 31's new builders-4 score; that is the bar to beat.
- With 96 seeds, noise is about ±0.2 instead of ±0.3, so one run per variant is enough.

**Reality check:** we were 147th at 4.52, and the top-32 line is about 5.3. Only spend Mech Royale slots if Blast
Radius, Shopping and CAD have no better use for them. Each entry is batch 31 plus one idea, with batch 31's exact
settings restored automatically once a free-for-all is detected.

**Sunday batch (submit first):** the top board's practice ideas, written as our own code (b79a28c). The calibrated sim
gave g1 4.67 (12 matches); the batch 31 baseline sits around 3.6–4.1.

| # | Commit (full hash) | What it tests |
| --- | --- | --- |
| G6 | `dc7f5663f335aed2b557fa24b9bfe6217b00f84b` | G1 + close to 20 m on targets below 38% HP (when we're above 42%) |
| G8 | `293f3a63fd33fc6592f5d3cf5959273b5d9dfc2f` | G6 + wider looting (detour 150 m, hunt drones down to 35% HP) |
| G7 | `26c7c252daa9df6a1d658dd87c7736f9a517c3c6` | G1 + wider looting only |
| G1 | `fbdc8e2da8b9f4850cee10426c045d719ed51312` | **REAL 5.01 (new best, Sun 9:14)**. Everything: 1.5 s retreat pulses, mid-fight cubes, prefer low-HP and current target, lethal laser at 0.7, laser range 120, laser-first upgrades |
| G2 | `37f6e96e78187b9a35c723b24babb8fc9502bf55` | G1 + wider engagement (weak / aiming at us / closing) |
| G3 | `cf5ceb47f003d8be57dbc82a301e80f50d33153b` | **REAL 4.89.** G1 without the retreat pulses |
| G4 | `59c192ed29b7f72e657c63d8351e55376113a33b` | target choice + lethal laser only |
| G5 | `31027561de65df0b491aa53c0a301e0fd05d2e14` | retreat pulses + mid-fight cubes only |

| # | Commit (full hash) | What it tests | Codex's estimate |
| --- | --- | --- | --- |
| 1 | `ba8ca9fbbcbe613d0db3b767cf0f48d66bdefc2b` | c01: engage 45 m, finish below 20% HP, lethal partial laser | +0.35 |
| 2 | `5ea0f6fe6c50052b95b65e77d6ecd6d20ba52278` | c02: engage 45 m, finish below 20% HP | +0.25 |
| 3 | `043e3d3e9e314b7e6f901eea129150fa32306162` | c03: lethal partial laser only | +0.20 |
| 4 | `681661d0dc5fa3badfb8eb0c31b2a3ebda4e377d` | c04: less roaming and looting travel | +0.20 |
| 5 | `750507cbd8c6e0e472a4b25815efff95f4e33d8c` | Idea A: track awake hunters (branch codex-idea-a) | sim +0.1 (noise) |
| 6 | `9118da5ebd176d7d767346221eeb25976a534769` | c05: nearer targets, stickier lock, smaller backstab bonus | +0.15 |
| 7 | `aafb4c168668dfeb9dfb26e1b3fb18b5464519d1` | c06: endgame radius 40, wider covered-spot search | +0.15 |
| 8 | `0f53a10d6027cb5495e6d137d05d5b821ca8719a` | c07: wider laser-dodge trigger, faster strafe | +0.10 |
| 9 | `aaadfcfe0f300fe50812b1ae9adab2eeeca60578` | c08: shorter mid-fight laser detours | +0.10 |
| 10 | `122e4fb2585c82536dfd8c3ff80a87d856098234` | c09: retreat later (25% HP) | +0.05 |
| 11 | `de61eab2ea24a5cbe57977ec91ca8f59370f5455` | c10: more energy kept between boosts | +0.05 |

Batch 31 control (do **not** re-submit; it keeps its first builders-4 score): `efcac8c3ea9c9a103b415a905106df84f56d2607`.

**Rule of thumb:** pick whichever entry has the best builders-4 score as the final entry. If two ideas each beat
batch 31, ask Claude to combine them into one new commit (new code gets a fresh score).
