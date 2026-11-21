/** All tunables in one place. Two profiles later (practice / ffa); Phase 0 uses one. */
export const P = {
  // Upgrade priority, first available wins. Ids from hello.config.upgrades.
  upgradeOrder: [
    // practice placement = hunters killed before we die, so offense ranks high; plating stays first (also wins the final-zone HP race)
    "plating", "laser_damage", "gun_damage", "laser_charge", "armor", "gun_rate", "lightning_efficiency",
    "mortar_reload", "nanites", "gun_mag", "gyros", "lightning_range", "gun_velocity", "lightning_chain",
    "mortar_velocity", "mortar_splash", "sensors", "laser_pierce", "reactor", "capacitor", "jets", "servos",
  ],
  // Weapon preference for the second slot (higher = better).
  weaponScore: { laser: 3, mortar: 2, lightning: 1, gun: 0 } as Record<string, number>, // sim: laser +1.9 pts, mortar +0.3, lightning -0.2
  lootDetour: 80, // m: walk to visible cubes this close when no threat
  pickupDetour: 160, // m: walk to wanted weapon pickups this close when no threat
  targetDistW: 4,
  ffaDeaths: 2, // unexplained deaths before we decide it's a free-for-all
  ffaOverrides: {} as Record<string, number>, // sim FFA h2h of engageRange=60 was +0.7, -0.84, 0.0 on 3 seed sets: no reliable edge, so no switch
  engageRange: 60, // top teams (5.1+): only fight mechs within ~60 m, attackers, or nearly dead ones (don't wake idle house bots)
  oddsW: { b0: 1.778, lhp: 1.775, cubes: -0.657, weap: 1.162, others: -0.653, dist: 0.078, back: -0.133 }, // own fit, sim/fights.ts (903 fights, 82% acc)
  oddsEngage: 0, // practice: start fights with predicted win prob >= this (0 = off). sim: 0.7/0.8/0.9 all -0.2..-0.4 (wakes more bots)
  oddsRange: 160, // ...within this range
  oddsFlee: 0, // REAL batch 35 (flee <0.45) 4.19 < batch 31 4.52 -> off
  finishHp: 0.3, // also engage any visible mech below this hp fraction
  healStart: 0, // heal-to-full: stop picking fights below this hp fraction (0 = off)
  healUntil: 0.95, // ...until back above this
  laserMemory: 60, // s to remember a laser pickup we saw
  laserDetour: 250,
  exploreUntil: 0, // s: explore for a laser until then (0 = off). sim: 200 -> -0.1, no gain
  laserDetourEarly: 400, // m: in the first minute, go further for a laser
  laserScanSpin: 0.35, // rad per decision to spin the torso while unarmed and idle (0 = off)
  laserScanUntil: 150, // s // m: go fetch a remembered laser this far, even mid-fight
  silentWalk: false, // REAL: batches 28/29 with silent walk scored 3.58/3.54 vs 4.25 without -> keep off
  silentFrac: 0.4, // move magnitude cap for silent walking (0.4 x 11.7 = 4.7 m/s)
  backstab: 300, // target bonus when the enemy faces away from us
  counterBonus: 200, // target bonus for weapon counters (laser vs mortar carrier, lightning vs laser carrier)
  zoneVictim: 250, // target bonus for enemies standing outside the circle
  zoneHold: true, // never follow a target out of the circle
  droneLure: true, // when losing, retreat past a known drone
  preCharge: false, // batch 26 idea (real: no gain)
  laserPeek: false, // batch 25 idea (real: no gain)
  isolate: false, // batch 24 idea (real: no gain)
  lockBonus: 150,
  attackerBonus: 250, // target bonus for whoever damaged us in the last 3 s
  rearBonus: 0, // extra target bonus for whoever hit us in the back in the last 2 s
  spreadBackoff: 0, // move away from the enemy centroid when they spread >90° around us (0 = off) // target score bonus for staying on the current target (finish kills before they regen) // target score: hp + dist * this (lower = preferred)
  retreatHp: 0.35, // break line of sight below this hp fraction when the enemy has more hp
  gunRange: 90, // batch 20
  laserRange: 110, // REAL best (batch 20: 4.13). 255->3.42 230->3.79 150->3.85/3.60 80->3.69 50->4.04
  lightningRange: 130, // REAL batch 23 (lightning on) 3.65 < batch 20: keep it off
  farmCubes: 0, // keep roaming for crates/drones/cubes until we hold this many cubes
  farmUntilT: 230, // ...or until this time
  npcRange: 80, // m: engage NPC drones this close (when healthy)
  roamUntilT: 100, // s: roam for loot until then (or while slot 1 is empty)
  crateShootRange: 70, // m: shoot crates when no threat
  zoneSafety: 0.75, // stay within this fraction of the next radius from next_center
  strafeFlip: 0.6, // s between strafe direction changes
  threatMemory: 4, // s to keep facing the last damage bearing
  mortarMinRange: 18, // m: no mortar closer than this (self splash)
  lightningEnergyFloor: 12,
  replanEvery: 1.5, // s between A* replans toward the same goal
  minReplan: 0.5, // s: hard floor between A* runs, whatever the reason
  hardBudgetMs: 20, // searches already running stop at this many ms into the tick
  softBudgetMs: 8, // past this many ms in a tick, skip optional work
  maxExpand: 5000, // A* expansion cap per plan (bounds worst-case tick time)
  laserLead: 0.1, // s: lead for hitscan laser (aim command latency)
  holdSamples: 12, // candidate spots tried when picking a covered hold position
  holdSearch: 45, // m: how far from current position to look for it
  holdRay: 50, // m: sight-line length used to measure exposure
  dropRange: 170, // m: go for supply drops this close when no enemy is in sight
  dropLate: 12, // s: still go if we arrive at most this long after it lands
  reloadBelow: 0.5, // reload when no clear shot and the magazine is below this fraction
  npcHuntHp: 0.65, // only start fights with NPC drones above this hp fraction
  recoverHp: 0.6, // below this hp fraction with no enemy in sight: hold still and regenerate
  laserDodgeYaw: 0.15, // rad: an enemy charging a laser aimed this close to us -> dodge sideways
  dodgeEnergy: 20,
  useRoofs: true, // camp on rooftops when idle
  roofMin: 6, // m: roof height above ground range considered
  roofMax: 40,
  roofArea: 400, // m²: minimum footprint
  roofSearch: 250, // m: only roofs this close
  climbTimeout: 5, // s: give up a climb (and blacklist that roof) after this
  fightBoostOn: 80, // start boost-strafing in fights above this energy
  fightBoostOff: 45, // stop below this (keeps a reserve for dodges) // keep this much energy before boosting to dodge
  endgameRadius: 70, // once the next circle is this small, stand on next_center exactly
}
