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
  laserMemory: 60, // s to remember a laser pickup we saw
  laserDetour: 250,
  laserDetourEarly: 400, // m: in the first minute, go further for a laser
  laserScanSpin: 0.35, // rad per decision to spin the torso while unarmed and idle (0 = off)
  laserScanUntil: 150, // s // m: go fetch a remembered laser this far, even mid-fight
  lockBonus: 150, // target score bonus for staying on the current target (finish kills before they regen) // target score: hp + dist * this (lower = preferred)
  retreatHp: 0.35, // break line of sight below this hp fraction when the enemy has more hp
  gunRange: 130, // sim: 130 m beats 90 m by ~+0.5
  laserRange: 230, // sim sweep: 200-230 best (+0.3-0.5 over 150) // m: preferred distance when holding a laser // m: preferred fighting distance with gun/laser
  lightningRange: 130, // sim: closing in for lightning loses points; effectively disabled // m: preferred distance when lightning is charged up
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
