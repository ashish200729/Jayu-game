/**
 * Every movement and rules tuning number lives here. Reasoning is in docs/BALANCE.md.
 * Units: pixels, seconds. The sim runs at TICK_RATE steps per second.
 */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const TILE = 32;

export const PLAYER = {
  width: 20,
  height: 44,
  crouchHeight: 30,
  headHeight: 13,
  maxHp: 100,
  leaderHp: 200,
  runSpeed: 255,
  crouchSpeedMult: 0.45,
  waterSpeedMult: 0.6,
  groundAccel: 3200,
  iceAccel: 520,
  airAccel: 1900,
  groundFriction: 3400,
  iceFriction: 260,
  airDrag: 300,
  gravity: 1500,
  maxFall: 900,
  wallSlideMaxFall: 320,
  vineMaxFall: 110,
  waterGravityMult: 0.35,
  waterMaxFall: 160,
  lowGravMult: 0.35,
  /** Instant hop when the jetpack is pressed while standing. */
  hopImpulse: 300,
  jetAccel: 2950,
  jetMaxRise: 430,
  /** Thrust ramps from jetRampStart to 1 over jetRampTime seconds of holding. */
  jetRampStart: 0.4,
  jetRampTime: 0.16,
  fuelMax: 100,
  fuelDrain: 38,
  fuelRefill: 85,
  fuelRefillDelay: 0.35,
  ventLift: 2600,
  ventMaxRise: 520,
  slideSpeed: 420,
  slideTime: 0.42,
  slideFriction: 500,
  regenDelay: 4,
  regenRate: 12,
  spawnProtection: 2,
  respawnTime: 3,
  /** Fall speed (px/s) above which landing hurts. Large on purpose — jetpacks make falls survivable. */
  maxSpeed: 1250,
} as const;

export const COMBAT = {
  selfDamageMult: 0.4,
  headshotDefault: 1.5,
  /** 333 ms: covers ~200 ms ping + 100 ms interpolation + input buffer (see docs/DECISIONS.md). */
  lagCompMaxTicks: 20,
  meleeDamage: 45,
  meleeRange: 38,
  meleeCooldown: 0.4,
  meleeKnockback: 420,
  throwMinSpeed: 220,
  throwMaxSpeed: 820,
  throwCooldown: 0.5,
  maxGrenades: 3,
  dualWieldTime: 30,
  droppedWeaponLife: 15,
  burnDps: 10,
  burnTime: 1.2,
  assistWindow: 6,
  bombPassCooldown: 0.5,
} as const;

export const MATCH = {
  countdown: 3,
  endDelay: 6,
  defaultTimeLimit: 300,
  ffaScoreLimit: 20,
  tdmScoreLimit: 30,
  ctfScoreLimit: 3,
  leaderScoreLimit: 5,
  kothScoreLimit: 100,
  kothZoneDuration: 40,
  bombFuse: 15,
  flagReturnTime: 15,
  survivalIntermission: 12,
  maxPlayersPublic: 6,
  maxPlayersPrivate: 12,
} as const;
