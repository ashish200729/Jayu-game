import type { ModeId } from '@game/content';
import type { Input } from './input';

export interface MatchConfig {
  mapId: string;
  mode: ModeId;
  seed: number;
  /** Seconds; 0 = no limit. */
  timeLimit: number;
  /** 0 = mode default. */
  scoreLimit: number;
  friendlyFire: boolean;
  lowGravity: boolean;
  /** Map weapon pickups on/off (sidearm + starter still given). */
  pickups: boolean;
  botDifficulty: 0 | 1 | 2;
  /** Bots the host adds at match start. */
  botCount: number;
  maxPlayers: number;
}

export function defaultConfig(partial: Partial<MatchConfig> = {}): MatchConfig {
  return {
    mapId: 'training-grounds',
    mode: 'ffa',
    seed: 1,
    timeLimit: 300,
    scoreLimit: 0,
    friendlyFire: false,
    lowGravity: false,
    pickups: true,
    botDifficulty: 1,
    botCount: 0,
    maxPlayers: 12,
    ...partial,
  };
}

/** Movement-only state: exactly what client-side prediction replays. */
export interface MoveState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  crouch: boolean;
  slideT: number;
  jetT: number;
  fuel: number;
  fuelDelay: number;
  facing: number;
  wall: number;
  jetting: boolean;
  medium: number;
  prevJet: boolean;
  /** Index of the moving platform being ridden, -1 if none. */
  ride: number;
  /** Ticks left of dropping through one-way platforms. */
  dropT: number;
}

export interface WeaponSlotState {
  wi: number;
  mag: number;
  reserve: number;
}

export interface Upgrades {
  damage: number;
  hp: number;
  fuel: number;
  reload: number;
  speed: number;
}

export interface Player extends MoveState {
  id: number;
  name: string;
  team: number;
  isBot: boolean;
  /** Training dummy: never acts. */
  dummy: boolean;
  /** Survival enemy drone. */
  drone: boolean;
  difficulty: number;
  /** Cosmetic indices into COSMETICS: head, outfit, jetpack, skin, emote, pose */
  look: number[];
  alive: boolean;
  hp: number;
  maxHp: number;
  respawnT: number;
  protT: number;
  regenT: number;
  aim: number;
  slots: [WeaponSlotState, WeaponSlotState];
  active: number;
  reloadT: number;
  fireCd: number;
  burstLeft: number;
  burstCd: number;
  recoil: number;
  prevFire: boolean;
  grenades: number[];
  throwCd: number;
  meleeCd: number;
  meleeT: number;
  lastActions: number;
  dualT: number;
  burnT: number;
  burnBy: number;
  zoom: boolean;
  flaming: boolean;
  emote: number;
  emoteT: number;
  carrying: number;
  leader: boolean;
  bomb: boolean;
  eliminated: boolean;
  upgrades: Upgrades;
  pendingUpgrade: boolean;
  damageMult: number;
  // stats
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  damageDealt: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  objective: number;
  weaponKills: Record<string, number>;
  recentAttackers: { id: number; tick: number }[];
  lastDamageTick: number;
  checkpoint: number;
  courseStart: number;
  bestCourse: number;
  input: Input;
  /** Last input seq applied by the host; echoed to the owning client for reconciliation. */
  ack: number;
  hiddenUntil: number;
}

export interface Projectile {
  id: number;
  wi: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  bounces: number;
  fuse: number;
  hits: number[];
  /** Flames are host-only (clients draw a flame stream from the player's `flaming` flag). */
  flame: boolean;
}

export interface Grenade {
  id: number;
  kind: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fuse: number;
  /** -1 free, -2 stuck to the world, otherwise the player id it sticks to. */
  stuck: number;
  stuckDx: number;
  stuckDy: number;
  armT: number;
}

export interface Cloud {
  id: number;
  kind: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  r: number;
  life: number;
}

export interface PickupSpawner {
  index: number;
  kind: 'weapon' | 'heavy' | 'health' | 'grenade' | 'dual';
  x: number;
  y: number;
  /** Weapon index or grenade kind; -1 for health/dual. */
  item: number;
  available: boolean;
  timer: number;
}

export interface DroppedWeapon {
  id: number;
  wi: number;
  mag: number;
  reserve: number;
  x: number;
  y: number;
  vy: number;
  life: number;
}

export interface Flag {
  team: number;
  /** 0 home, 1 carried, 2 dropped */
  state: number;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  carrier: number;
  returnT: number;
}

export type Phase = 'countdown' | 'playing' | 'intermission' | 'ended';

export interface ModeState {
  phase: Phase;
  phaseT: number;
  /** Ticks remaining; -1 = no limit. */
  timeLeft: number;
  teamScores: [number, number];
  scoreLimit: number;
  flags: Flag[];
  zone: { index: number; x: number; y: number; w: number; h: number; t: number; owner: number; progress: number };
  bombT: number;
  passCd: number;
  wave: number;
  waveSpawned: number;
  waveTotal: number;
  winner: number;
  winnerTeam: number;
  leaders: [number, number];
}

export enum EventType {
  Shot = 1,
  Explode = 2,
  Hit = 3,
  Kill = 4,
  Pickup = 5,
  Throw = 6,
  Melee = 7,
  Reload = 8,
  Flag = 9,
  Zone = 10,
  Bomb = 11,
  Wave = 12,
  Chat = 13,
  Spawn = 14,
  Checkpoint = 15,
  Emote = 16,
  Bounce = 17,
  Deny = 18,
  Course = 19,
  Upgrade = 20,
}

/**
 * Events describe things that happened during a step, for effects/UI on clients.
 * `d` is a list of integers whose meaning depends on the type (see docs/PROTOCOL.md).
 */
export interface SimEvent {
  id: number;
  type: EventType;
  tick: number;
  d: number[];
}

/** Special "weapon" codes in kill events. */
export const KILL_MELEE = 100;
export const KILL_LAVA = 101;
export const KILL_WORLD = 102;
export const KILL_GRENADE = 110; // + grenade kind
export const KILL_BOMB = 120;
export const KILL_BURN = 121;
export const KILL_GAS = 122;
