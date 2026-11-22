# Mech Royale: morning submission queue

Repo for every entry: https://github.com/alexwilldev/mechroyale-bot (paste the full hash into the commit field).

**Reality check:** we're 147th at 4.52, and the top-32 line is about 5.3 and rising. Only spend Mech Royale
slots if Blast Radius and Shopping have no better use for them. Each entry is batch 31 plus one idea, with
batch 31's exact settings restored automatically once a free-for-all is detected. Mixing in batch 31
re-runs measures noise, and any re-run can draw a luckier score.

Order follows Codex's testing plan: controls interleaved, the most-promising ideas tested twice.

| # | Commit (full hash) | What it tests | Codex's estimate |
| --- | --- | --- | --- |
| 1 | `efcac8c3ea9c9a103b415a905106df84f56d2607` | Batch 31 control (current best, 4.52) | – |
| 2 | `ba8ca9fbbcbe613d0db3b767cf0f48d66bdefc2b` | c01: engage 45 m, finish below 20% HP, lethal partial laser | +0.35 |
| 3 | `5ea0f6fe6c50052b95b65e77d6ecd6d20ba52278` | c02: engage 45 m, finish below 20% HP | +0.25 |
| 4 | `043e3d3e9e314b7e6f901eea129150fa32306162` | c03: lethal partial laser only | +0.20 |
| 5 | `681661d0dc5fa3badfb8eb0c31b2a3ebda4e377d` | c04: less roaming and looting travel | +0.20 |
| 6 | `efcac8c3ea9c9a103b415a905106df84f56d2607` | Batch 31 control again | – |
| 7 | (see below) | Idea A: track awake hunters (Codex is building it overnight) | ? |
| 8 | repeat the best of #2–#5 | Confirm | |
| 9 | `9118da5ebd176d7d767346221eeb25976a534769` | c05: nearer targets, stickier lock, smaller backstab bonus | +0.15 |
| 10 | `aafb4c168668dfeb9dfb26e1b3fb18b5464519d1` | c06: endgame radius 40, wider covered-spot search | +0.15 |
| 11 | `0f53a10d6027cb5495e6d137d05d5b821ca8719a` | c07: wider laser-dodge trigger, faster strafe | +0.10 |
| 12 | `aaadfcfe0f300fe50812b1ae9adab2eeeca60578` | c08: shorter mid-fight laser detours | +0.10 |
| 13 | `122e4fb2585c82536dfd8c3ff80a87d856098234` | c09: retreat later (25% HP) | +0.05 |
| 14 | `de61eab2ea24a5cbe57977ec91ca8f59370f5455` | c10: more energy kept between boosts | +0.05 |

**Idea A:** Codex is implementing it on branch `codex-idea-a`, in an isolated worktree at
/private/tmp/claude-501/wt-codex. Its progress is in ~/Developer/hackathon/CODEX_STATUS.md. Claude still
has to review it, run the checks and push it before it can be submitted; until then, skip #7.

**Simulator sanity check (interrupted, 2 runs each, calibrated sim):** batch 31 3.86, c01 3.87, c02 3.67.
Nothing is ruled out; the real board decides.

**Rule of thumb:** a candidate beating the batch 31 controls by +0.4 or more on two runs is worth
repeating. Anything below 4.2 twice can be dropped. Whatever has your best score when submissions close is
entered automatically.
