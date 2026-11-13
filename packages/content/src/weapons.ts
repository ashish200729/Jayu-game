export type WeaponSlot = 'sidearm' | 'primary' | 'heavy';
export type WeaponKind = 'hitscan' | 'projectile' | 'flame' | 'rail';

export interface ProjectileSpec {
  speed: number;
  gravity: number;
  radius: number;
  life: number;
  /** Explosion radius; 0 = no explosion (direct hit only). */
  explosionRadius: number;
  explosionDamage: number;
  knockback: number;
  /** Number of wall bounces before exploding/dying. */
  bounces: number;
  /** Explodes when fuse ends instead of on impact (grenade-launcher shells). */
  fuse: number;
  /** Damage on direct body hit (added to the explosion for rockets). */
  directDamage: number;
  /** Keeps flying after hitting a player. */
  pierce: boolean;
}

export interface WeaponDef {
  id: string;
  name: string;
  slot: WeaponSlot;
  kind: WeaponKind;
  /** Damage per pellet / per hit. */
  damage: number;
  headMult: number;
  /** Seconds between shots (or bursts). */
  fireInterval: number;
  auto: boolean;
  burst: number;
  burstInterval: number;
  pellets: number;
  /** Base spread half-angle in radians. */
  spread: number;
  /** Spread added per shot, decays at recoilRecover rad/s. */
  recoil: number;
  recoilMax: number;
  recoilRecover: number;
  range: number;
  falloffStart: number;
  minDamageMult: number;
  magSize: number;
  /** Reserve ammo given with the weapon; -1 = infinite. */
  reserve: number;
  reloadTime: number;
  zoom: number;
  dualWieldable: boolean;
  knockback: number;
  projectile?: ProjectileSpec;
  /** Cosmetic: tracer colour (0xRRGGBB) and sound family. */
  tracer: number;
  sound: 'light' | 'heavy' | 'shotgun' | 'sniper' | 'rocket' | 'launcher' | 'flame' | 'rail' | 'blade';
  /** Relative pickup weight in random weapon spawners. */
  spawnWeight: number;
}

const base = {
  headMult: 1.5,
  auto: false,
  burst: 1,
  burstInterval: 0,
  pellets: 1,
  recoil: 0,
  recoilMax: 0,
  recoilRecover: 0.6,
  falloffStart: 400,
  minDamageMult: 0.5,
  zoom: 1,
  dualWieldable: false,
  knockback: 30,
  spawnWeight: 1,
} as const;

export const WEAPONS: readonly WeaponDef[] = [
  {
    ...base,
    id: 'sparrow',
    name: 'Sparrow',
    slot: 'sidearm',
    kind: 'hitscan',
    damage: 18,
    fireInterval: 0.2,
    spread: 0.02,
    recoil: 0.03,
    recoilMax: 0.12,
    range: 900,
    magSize: 12,
    reserve: -1,
    reloadTime: 1.0,
    dualWieldable: true,
    tracer: 0xffe9a8,
    sound: 'light',
    spawnWeight: 0,
  },
  {
    ...base,
    id: 'thunderclap',
    name: 'Thunderclap',
    slot: 'sidearm',
    kind: 'hitscan',
    damage: 42,
    headMult: 1.6,
    fireInterval: 0.5,
    spread: 0.012,
    recoil: 0.09,
    recoilMax: 0.2,
    range: 1100,
    magSize: 6,
    reserve: 24,
    reloadTime: 1.4,
    dualWieldable: true,
    knockback: 90,
    tracer: 0xffd27a,
    sound: 'heavy',
    spawnWeight: 3,
  },
  {
    ...base,
    id: 'hornet',
    name: 'Hornet',
    slot: 'primary',
    kind: 'hitscan',
    damage: 11,
    auto: true,
    fireInterval: 0.075,
    spread: 0.05,
    recoil: 0.018,
    recoilMax: 0.14,
    range: 800,
    falloffStart: 320,
    magSize: 30,
    reserve: 120,
    reloadTime: 1.3,
    dualWieldable: true,
    tracer: 0xfff2b3,
    sound: 'light',
    spawnWeight: 5,
  },
  {
    ...base,
    id: 'kestrel',
    name: 'Kestrel',
    slot: 'primary',
    kind: 'hitscan',
    damage: 16,
    auto: true,
    fireInterval: 0.11,
    spread: 0.022,
    recoil: 0.014,
    recoilMax: 0.1,
    range: 1300,
    falloffStart: 600,
    magSize: 30,
    reserve: 90,
    reloadTime: 1.6,
    tracer: 0xffe08a,
    sound: 'heavy',
    spawnWeight: 5,
  },
  {
    ...base,
    id: 'triplet',
    name: 'Triplet',
    slot: 'primary',
    kind: 'hitscan',
    damage: 20,
    burst: 3,
    burstInterval: 0.06,
    fireInterval: 0.42,
    spread: 0.012,
    recoil: 0.01,
    recoilMax: 0.05,
    range: 1400,
    falloffStart: 700,
    magSize: 24,
    reserve: 72,
    reloadTime: 1.7,
    tracer: 0xbfe6ff,
    sound: 'heavy',
    spawnWeight: 4,
  },
  {
    ...base,
    id: 'mule',
    name: 'Mule',
    slot: 'primary',
    kind: 'hitscan',
    damage: 13,
    headMult: 1.25,
    fireInterval: 0.75,
    pellets: 8,
    spread: 0.16,
    range: 520,
    falloffStart: 160,
    minDamageMult: 0.25,
    magSize: 6,
    reserve: 24,
    reloadTime: 2.0,
    knockback: 70,
    tracer: 0xffc46b,
    sound: 'shotgun',
    spawnWeight: 4,
  },
  {
    ...base,
    id: 'heron',
    name: 'Heron',
    slot: 'primary',
    kind: 'hitscan',
    damage: 80,
    headMult: 1.6,
    fireInterval: 1.15,
    spread: 0.002,
    recoil: 0.1,
    recoilMax: 0.1,
    recoilRecover: 0.2,
    range: 2600,
    falloffStart: 2600,
    minDamageMult: 1,
    magSize: 5,
    reserve: 15,
    reloadTime: 2.2,
    zoom: 0.55,
    knockback: 140,
    tracer: 0xd7f7ff,
    sound: 'sniper',
    spawnWeight: 3,
  },
  {
    ...base,
    id: 'grizzly',
    name: 'Grizzly',
    slot: 'primary',
    kind: 'hitscan',
    damage: 15,
    auto: true,
    fireInterval: 0.085,
    spread: 0.04,
    recoil: 0.008,
    recoilMax: 0.12,
    recoilRecover: 0.4,
    range: 1200,
    falloffStart: 500,
    magSize: 80,
    reserve: 80,
    reloadTime: 3.2,
    tracer: 0xffd9a0,
    sound: 'heavy',
    spawnWeight: 3,
  },
  {
    ...base,
    id: 'comet',
    name: 'Comet',
    slot: 'heavy',
    kind: 'projectile',
    damage: 0,
    fireInterval: 1.0,
    spread: 0.004,
    range: 3000,
    magSize: 1,
    reserve: 4,
    reloadTime: 1.4,
    knockback: 0,
    projectile: {
      speed: 820,
      gravity: 0,
      radius: 5,
      life: 3,
      explosionRadius: 110,
      explosionDamage: 95,
      knockback: 900,
      bounces: 0,
      fuse: 0,
      directDamage: 25,
      pierce: false,
    },
    tracer: 0xff8a3d,
    sound: 'rocket',
    spawnWeight: 2,
  },
  {
    ...base,
    id: 'popper',
    name: 'Popper',
    slot: 'heavy',
    kind: 'projectile',
    damage: 0,
    fireInterval: 0.6,
    spread: 0.01,
    range: 3000,
    magSize: 4,
    reserve: 4,
    reloadTime: 2.1,
    knockback: 0,
    projectile: {
      speed: 640,
      gravity: 1100,
      radius: 6,
      life: 4,
      explosionRadius: 95,
      explosionDamage: 80,
      knockback: 750,
      bounces: 3,
      fuse: 1.6,
      directDamage: 0,
      pierce: false,
    },
    tracer: 0x9cff6b,
    sound: 'launcher',
    spawnWeight: 2,
  },
  {
    ...base,
    id: 'torchie',
    name: 'Torchie',
    slot: 'heavy',
    kind: 'flame',
    damage: 5,
    headMult: 1,
    auto: true,
    fireInterval: 0.05,
    spread: 0.12,
    range: 240,
    magSize: 120,
    reserve: 0,
    reloadTime: 2,
    knockback: 0,
    projectile: {
      speed: 520,
      gravity: -120,
      radius: 10,
      life: 0.42,
      explosionRadius: 0,
      explosionDamage: 0,
      knockback: 40,
      bounces: 0,
      fuse: 0,
      directDamage: 5,
      pierce: true,
    },
    tracer: 0xff6a1f,
    sound: 'flame',
    spawnWeight: 2,
  },
  {
    ...base,
    id: 'zapline',
    name: 'Zapline',
    slot: 'heavy',
    kind: 'rail',
    damage: 105,
    headMult: 1,
    fireInterval: 1.3,
    spread: 0,
    range: 3200,
    falloffStart: 3200,
    minDamageMult: 1,
    magSize: 4,
    reserve: 4,
    reloadTime: 2.2,
    zoom: 0.7,
    knockback: 260,
    tracer: 0x6ef3ff,
    sound: 'rail',
    spawnWeight: 2,
  },
  {
    ...base,
    id: 'buzzsaw',
    name: 'Buzzsaw',
    slot: 'heavy',
    kind: 'projectile',
    damage: 0,
    fireInterval: 0.7,
    spread: 0.005,
    range: 3000,
    magSize: 5,
    reserve: 5,
    reloadTime: 2.0,
    knockback: 0,
    projectile: {
      speed: 700,
      gravity: 0,
      radius: 9,
      life: 2.4,
      explosionRadius: 0,
      explosionDamage: 0,
      knockback: 300,
      bounces: 4,
      fuse: 0,
      directDamage: 60,
      pierce: true,
    },
    tracer: 0xd0d6e0,
    sound: 'blade',
    spawnWeight: 2,
  },
];

const byId = new Map(WEAPONS.map((w, i) => [w.id, i]));
export function weaponIndex(id: string): number {
  const i = byId.get(id);
  if (i === undefined) throw new Error(`Unknown weapon ${id}`);
  return i;
}
export function weaponDef(index: number): WeaponDef {
  return WEAPONS[index];
}
export const STARTING_SIDEARM = 'sparrow';
export const STARTING_PRIMARY = 'hornet';
