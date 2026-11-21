/** All tunables in one place. Two profiles later (practice / ffa); Phase 0 uses one. */
export const P = {
  // Upgrade priority, first available wins. Ids from hello.config.upgrades.
  upgradeOrder: [
    "plating", "armor", "nanites", "gun_damage", "laser_damage", "gun_rate", "laser_charge",
    "lightning_efficiency", "mortar_reload", "gyros", "gun_mag", "gun_velocity", "lightning_range",
    "lightning_chain", "mortar_velocity", "mortar_splash", "laser_pierce", "sensors", "reactor",
    "capacitor", "jets", "servos",
  ],
  // Weapon preference for the second slot (higher = better).
  weaponScore: { laser: 3, lightning: 2, mortar: 1, gun: 0 } as Record<string, number>,
  lootDetour: 80, // m: walk to visible cubes this close when no threat
  pickupDetour: 160, // m: walk to wanted weapon pickups this close when no threat
  targetDistW: 4, // target score: hp + dist * this (lower = preferred)
  retreatHp: 0.35, // break line of sight below this hp fraction when the enemy has more hp
  gunRange: 65, // m: preferred fighting distance with gun/laser
  lightningRange: 28, // m: preferred distance when lightning is charged up
  roamUntilT: 100, // s: roam for loot until then (or while slot 1 is empty)
  crateShootRange: 70, // m: shoot crates when no threat
  zoneSafety: 0.75, // stay within this fraction of the next radius from next_center
  strafeFlip: 1.4, // s between strafe direction changes
  threatMemory: 4, // s to keep facing the last damage bearing
  mortarMinRange: 18, // m: no mortar closer than this (self splash)
  lightningEnergyFloor: 12,
  replanEvery: 1.5, // s between A* replans toward the same goal
  maxExpand: 8000, // A* expansion cap per plan (bounds worst-case tick time)
  laserLead: 0.1, // s: lead for hitscan laser (aim command latency)
  recoverHp: 0.6, // below this hp fraction with no enemy in sight: hold still and regenerate
  laserDodgeYaw: 0.15, // rad: an enemy charging a laser aimed this close to us -> dodge sideways
  dodgeEnergy: 20, // keep this much energy before boosting to dodge
  endgameRadius: 70, // once the next circle is this small, stand on next_center exactly
}
