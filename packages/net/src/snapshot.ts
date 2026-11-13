import type { Cloud, DroppedWeapon, Grenade, ModeState, Phase, PickupSpawner, Player, Projectile, SimEvent, Upgrades } from '@game/sim';
import { ByteReader, ByteWriter, DecodeError } from './codec';
import { Msg } from './protocol';

/**
 * Player state is flattened into a fixed list of integers. Snapshots send, per player, a bitmask of
 * fields that changed since the client's last acknowledged snapshot plus zigzag-varint deltas.
 */
export const PF = {
  x: 0,
  y: 1,
  vx: 2,
  vy: 3,
  aim: 4,
  fuel: 5,
  hp: 6,
  maxHp: 7,
  team: 8,
  flags: 9,
  carrying: 10,
  slideT: 11,
  jetT: 12,
  fuelDelay: 13,
  dropT: 14,
  ride: 15,
  facing: 16,
  wall: 17,
  medium: 18,
  active: 19,
  s0wi: 20,
  s0mag: 21,
  s0res: 22,
  s1wi: 23,
  s1mag: 24,
  s1res: 25,
  reloadT: 26,
  grenades: 27,
  dualT: 28,
  protT: 29,
  respawnT: 30,
  emote: 31,
  emoteT: 32,
  meleeT: 33,
  burnT: 34,
  kills: 35,
  deaths: 36,
  assists: 37,
  score: 38,
  objective: 39,
  upgrades: 40,
  checkpoint: 41,
  bestCourse: 42,
  fireCd: 43,
} as const;
export const PF_COUNT = 44;
const LO_BITS = 22;

const F_ALIVE = 1;
const F_GROUND = 2;
const F_CROUCH = 4;
const F_JET = 8;
const F_ZOOM = 16;
const F_FLAME = 32;
const F_LEADER = 64;
const F_BOMB = 128;
const F_ELIM = 256;
const F_PREVJET = 512;
const F_UPGRADE = 1024;
const F_DUMMY = 2048;
const F_DRONE = 4096;
const F_BOT = 8192;

export function playerFields(p: Player, out: Int32Array): Int32Array {
  out[PF.x] = Math.round(p.x * 8);
  out[PF.y] = Math.round(p.y * 8);
  out[PF.vx] = Math.round(p.vx * 8);
  out[PF.vy] = Math.round(p.vy * 8);
  out[PF.aim] = p.aim;
  out[PF.fuel] = Math.round(p.fuel * 64);
  out[PF.hp] = p.hp;
  out[PF.maxHp] = p.maxHp;
  out[PF.team] = p.team;
  out[PF.flags] =
    (p.alive ? F_ALIVE : 0) |
    (p.onGround ? F_GROUND : 0) |
    (p.crouch ? F_CROUCH : 0) |
    (p.jetting ? F_JET : 0) |
    (p.zoom ? F_ZOOM : 0) |
    (p.flaming ? F_FLAME : 0) |
    (p.leader ? F_LEADER : 0) |
    (p.bomb ? F_BOMB : 0) |
    (p.eliminated ? F_ELIM : 0) |
    (p.prevJet ? F_PREVJET : 0) |
    (p.pendingUpgrade ? F_UPGRADE : 0) |
    (p.dummy ? F_DUMMY : 0) |
    (p.drone ? F_DRONE : 0) |
    (p.isBot ? F_BOT : 0);
  out[PF.carrying] = p.carrying;
  out[PF.slideT] = p.slideT;
  out[PF.jetT] = Math.min(p.jetT, 1000);
  out[PF.fuelDelay] = p.fuelDelay;
  out[PF.dropT] = p.dropT;
  out[PF.ride] = p.ride;
  out[PF.facing] = p.facing;
  out[PF.wall] = p.wall;
  out[PF.medium] = p.medium;
  out[PF.active] = p.active;
  out[PF.s0wi] = p.slots[0].wi;
  out[PF.s0mag] = p.slots[0].mag;
  out[PF.s0res] = p.slots[0].reserve;
  out[PF.s1wi] = p.slots[1].wi;
  out[PF.s1mag] = p.slots[1].mag;
  out[PF.s1res] = p.slots[1].reserve;
  out[PF.reloadT] = p.reloadT;
  let g = p.grenades.length & 3;
  for (let i = 0; i < Math.min(3, p.grenades.length); i++) g |= (p.grenades[i] & 7) << (2 + i * 3);
  out[PF.grenades] = g;
  out[PF.dualT] = p.dualT;
  out[PF.protT] = p.protT;
  out[PF.respawnT] = Math.min(p.respawnT, 100000);
  out[PF.emote] = p.emote;
  out[PF.emoteT] = p.emoteT;
  out[PF.meleeT] = p.meleeT;
  out[PF.burnT] = p.burnT;
  out[PF.kills] = p.kills;
  out[PF.deaths] = p.deaths;
  out[PF.assists] = p.assists;
  out[PF.score] = p.score;
  out[PF.objective] = p.objective;
  const u = p.upgrades;
  out[PF.upgrades] = (u.damage & 7) | ((u.hp & 7) << 3) | ((u.fuel & 7) << 6) | ((u.reload & 7) << 9) | ((u.speed & 7) << 12);
  out[PF.checkpoint] = p.checkpoint;
  out[PF.bestCourse] = p.bestCourse;
  out[PF.fireCd] = p.fireCd;
  return out;
}

/** Client-side view of a player decoded from snapshot fields. */
export interface PlayerView {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  fuel: number;
  hp: number;
  maxHp: number;
  team: number;
  alive: boolean;
  onGround: boolean;
  crouch: boolean;
  jetting: boolean;
  zoom: boolean;
  flaming: boolean;
  leader: boolean;
  bomb: boolean;
  eliminated: boolean;
  prevJet: boolean;
  pendingUpgrade: boolean;
  dummy: boolean;
  drone: boolean;
  isBot: boolean;
  carrying: number;
  slideT: number;
  jetT: number;
  fuelDelay: number;
  dropT: number;
  ride: number;
  facing: number;
  wall: number;
  medium: number;
  active: number;
  slots: [{ wi: number; mag: number; reserve: number }, { wi: number; mag: number; reserve: number }];
  reloadT: number;
  grenades: number[];
  dualT: number;
  protT: number;
  respawnT: number;
  emote: number;
  emoteT: number;
  meleeT: number;
  burnT: number;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  objective: number;
  upgrades: Upgrades;
  checkpoint: number;
  bestCourse: number;
  fireCd: number;
}

export function fieldsToView(id: number, f: Int32Array): PlayerView {
  const flags = f[PF.flags];
  const g = f[PF.grenades];
  const gc = g & 3;
  const grenades: number[] = [];
  for (let i = 0; i < gc; i++) grenades.push((g >> (2 + i * 3)) & 7);
  const u = f[PF.upgrades];
  return {
    id,
    x: f[PF.x] / 8,
    y: f[PF.y] / 8,
    vx: f[PF.vx] / 8,
    vy: f[PF.vy] / 8,
    aim: f[PF.aim],
    fuel: f[PF.fuel] / 64,
    hp: f[PF.hp],
    maxHp: f[PF.maxHp],
    team: f[PF.team],
    alive: (flags & F_ALIVE) !== 0,
    onGround: (flags & F_GROUND) !== 0,
    crouch: (flags & F_CROUCH) !== 0,
    jetting: (flags & F_JET) !== 0,
    zoom: (flags & F_ZOOM) !== 0,
    flaming: (flags & F_FLAME) !== 0,
    leader: (flags & F_LEADER) !== 0,
    bomb: (flags & F_BOMB) !== 0,
    eliminated: (flags & F_ELIM) !== 0,
    prevJet: (flags & F_PREVJET) !== 0,
    pendingUpgrade: (flags & F_UPGRADE) !== 0,
    dummy: (flags & F_DUMMY) !== 0,
    drone: (flags & F_DRONE) !== 0,
    isBot: (flags & F_BOT) !== 0,
    carrying: f[PF.carrying],
    slideT: f[PF.slideT],
    jetT: f[PF.jetT],
    fuelDelay: f[PF.fuelDelay],
    dropT: f[PF.dropT],
    ride: f[PF.ride],
    facing: f[PF.facing],
    wall: f[PF.wall],
    medium: f[PF.medium],
    active: f[PF.active],
    slots: [
      { wi: f[PF.s0wi], mag: f[PF.s0mag], reserve: f[PF.s0res] },
      { wi: f[PF.s1wi], mag: f[PF.s1mag], reserve: f[PF.s1res] },
    ],
    reloadT: f[PF.reloadT],
    grenades,
    dualT: f[PF.dualT],
    protT: f[PF.protT],
    respawnT: f[PF.respawnT],
    emote: f[PF.emote],
    emoteT: f[PF.emoteT],
    meleeT: f[PF.meleeT],
    burnT: f[PF.burnT],
    kills: f[PF.kills],
    deaths: f[PF.deaths],
    assists: f[PF.assists],
    score: f[PF.score],
    objective: f[PF.objective],
    upgrades: { damage: u & 7, hp: (u >> 3) & 7, fuel: (u >> 6) & 7, reload: (u >> 9) & 7, speed: (u >> 12) & 7 },
    checkpoint: f[PF.checkpoint],
    bestCourse: f[PF.bestCourse],
    fireCd: f[PF.fireCd],
  };
}

export interface ProjectileView {
  id: number;
  wi: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface GrenadeView {
  id: number;
  kind: number;
  owner: number;
  x: number;
  y: number;
  stuck: number;
  armed: boolean;
  fuse: number;
}
export interface CloudView {
  id: number;
  kind: number;
  x: number;
  y: number;
  r: number;
  life: number;
}
export interface DroppedView {
  id: number;
  wi: number;
  x: number;
  y: number;
}
export interface FlagView {
  team: number;
  state: number;
  x: number;
  y: number;
  carrier: number;
}
export interface ModeView {
  phase: Phase;
  phaseT: number;
  timeLeft: number;
  teamScores: [number, number];
  scoreLimit: number;
  flags: FlagView[];
  zone: { index: number; owner: number; t: number; x: number; y: number; w: number; h: number };
  bombT: number;
  wave: number;
  waveTotal: number;
  waveSpawned: number;
  leaders: [number, number];
  winner: number;
  winnerTeam: number;
}

export interface SnapshotData {
  matchId: number;
  tick: number;
  baseTick: number;
  ack: number;
  inputBuffer: number;
  rosterVersion: number;
  mode: ModeView;
  players: Map<number, Int32Array>;
  projectiles: ProjectileView[];
  grenades: GrenadeView[];
  clouds: CloudView[];
  dropped: DroppedView[];
  spawners: { available: boolean; item: number }[];
  events: SimEvent[];
}

const PHASES: Phase[] = ['countdown', 'playing', 'intermission', 'ended'];

export interface SnapshotSource {
  matchId: number;
  tick: number;
  mode: ModeState;
  players: Player[];
  projectiles: Projectile[];
  grenades: Grenade[];
  clouds: Cloud[];
  dropped: DroppedWeapon[];
  spawners: PickupSpawner[];
}

const w = new ByteWriter(8192);

/**
 * Encode a snapshot for one recipient.
 * `current` holds this tick's player fields; `base` the fields the client acknowledged (or null for full).
 */
export function encodeSnapshot(
  src: SnapshotSource,
  current: Map<number, Int32Array>,
  base: Map<number, Int32Array> | null,
  baseTick: number,
  ack: number,
  inputBuffer: number,
  rosterVersion: number,
  events: SimEvent[],
): Uint8Array {
  w.reset();
  w.u8(Msg.Snapshot);
  w.uv(src.matchId);
  w.uv(src.tick);
  w.uv(base ? baseTick : 0);
  w.uv(ack);
  w.u8(Math.min(255, inputBuffer));
  w.uv(rosterVersion);
  const m = src.mode;
  w.u8(PHASES.indexOf(m.phase));
  w.uv(Math.max(0, m.phaseT));
  w.sv(m.timeLeft);
  w.uv(m.teamScores[0]);
  w.uv(m.teamScores[1]);
  w.uv(m.scoreLimit);
  w.u8(m.flags.length);
  for (const f of m.flags) {
    w.u8(f.state);
    w.sv(Math.round(f.x));
    w.sv(Math.round(f.y));
    w.sv(f.carrier);
  }
  w.u8(m.zone.index);
  w.i8(m.zone.owner);
  w.uv(Math.max(0, m.zone.t));
  w.sv(Math.round(m.zone.x));
  w.sv(Math.round(m.zone.y));
  w.uv(m.zone.w);
  w.uv(m.zone.h);
  w.uv(Math.max(0, m.bombT));
  w.uv(m.wave);
  w.uv(m.waveTotal);
  w.uv(m.waveSpawned);
  w.sv(m.leaders[0]);
  w.sv(m.leaders[1]);
  w.sv(m.winner);
  w.sv(m.winnerTeam);

  w.u8(current.size);
  for (const [id, f] of current) {
    const b = base?.get(id);
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < PF_COUNT; i++) {
      const changed = b ? f[i] !== b[i] : f[i] !== 0;
      if (!changed) continue;
      if (i < LO_BITS) lo |= 1 << i;
      else hi |= 1 << (i - LO_BITS);
    }
    w.uv(id);
    w.uv(lo);
    w.uv(hi);
    for (let i = 0; i < PF_COUNT; i++) {
      const bit = i < LO_BITS ? lo & (1 << i) : hi & (1 << (i - LO_BITS));
      if (bit) w.sv(f[i] - (b ? b[i] : 0));
    }
  }

  const proj = src.projectiles.filter((p) => !p.flame);
  w.uv(proj.length);
  for (const p of proj) {
    w.uv(p.id);
    w.u8(p.wi);
    w.uv(p.owner);
    w.sv(Math.round(p.x * 8));
    w.sv(Math.round(p.y * 8));
    w.sv(Math.round(p.vx));
    w.sv(Math.round(p.vy));
  }
  w.uv(src.grenades.length);
  for (const g of src.grenades) {
    w.uv(g.id);
    w.u8(g.kind);
    w.uv(g.owner);
    w.sv(Math.round(g.x * 8));
    w.sv(Math.round(g.y * 8));
    w.sv(g.stuck);
    w.u8(g.armT === 0 ? 1 : 0);
    w.uv(Math.max(0, Math.min(g.fuse, 100000)));
  }
  w.uv(src.clouds.length);
  for (const c of src.clouds) {
    w.uv(c.id);
    w.u8(c.kind);
    w.sv(Math.round(c.x));
    w.sv(Math.round(c.y));
    w.uv(Math.round(c.r));
    w.uv(c.life);
  }
  w.uv(src.dropped.length);
  for (const d of src.dropped) {
    w.uv(d.id);
    w.u8(d.wi);
    w.sv(Math.round(d.x));
    w.sv(Math.round(d.y));
  }
  w.uv(src.spawners.length);
  let byte = 0;
  for (let i = 0; i < src.spawners.length; i++) {
    if (src.spawners[i].available) byte |= 1 << (i & 7);
    if ((i & 7) === 7 || i === src.spawners.length - 1) {
      w.u8(byte);
      byte = 0;
    }
  }
  for (const s of src.spawners) if (s.available) w.i8(s.item);

  w.uv(events.length);
  for (const e of events) {
    w.uv(e.id);
    w.u8(e.type);
    w.uv(e.tick);
    w.u8(e.d.length);
    for (const v of e.d) w.sv(v);
  }
  return w.finish();
}

/** Decode a snapshot; player fields are resolved against the stored baseline. */
export function decodeSnapshot(r: ByteReader, baselines: Map<number, Map<number, Int32Array>>): SnapshotData {
  const matchId = r.uv();
  const tick = r.uv();
  const baseTick = r.uv();
  const ack = r.uv();
  const inputBuffer = r.u8();
  const rosterVersion = r.uv();
  const phase = PHASES[r.u8()];
  if (!phase) throw new DecodeError('bad phase');
  const phaseT = r.uv();
  const timeLeft = r.sv();
  const teamScores: [number, number] = [r.uv(), r.uv()];
  const scoreLimit = r.uv();
  const nf = r.u8();
  const flags: FlagView[] = [];
  for (let i = 0; i < nf; i++) flags.push({ team: i, state: r.u8(), x: r.sv(), y: r.sv(), carrier: r.sv() });
  const zone = { index: r.u8(), owner: r.i8(), t: r.uv(), x: r.sv(), y: r.sv(), w: r.uv(), h: r.uv() };
  const mode: ModeView = {
    phase,
    phaseT,
    timeLeft,
    teamScores,
    scoreLimit,
    flags,
    zone,
    bombT: r.uv(),
    wave: r.uv(),
    waveTotal: r.uv(),
    waveSpawned: r.uv(),
    leaders: [r.sv(), r.sv()],
    winner: r.sv(),
    winnerTeam: r.sv(),
  };
  const base = baseTick ? baselines.get(baseTick) : undefined;
  if (baseTick && !base) throw new DecodeError('missing baseline');
  const np = r.u8();
  const players = new Map<number, Int32Array>();
  for (let k = 0; k < np; k++) {
    const id = r.uv();
    const lo = r.uv();
    const hi = r.uv();
    const b = base?.get(id);
    const f = b ? b.slice() : new Int32Array(PF_COUNT);
    for (let i = 0; i < PF_COUNT; i++) {
      const bit = i < LO_BITS ? lo & (1 << i) : hi & (1 << (i - LO_BITS));
      if (bit) f[i] = (b ? b[i] : 0) + r.sv();
    }
    players.set(id, f);
  }
  const projectiles: ProjectileView[] = [];
  const npj = r.uv();
  for (let i = 0; i < npj; i++) {
    projectiles.push({ id: r.uv(), wi: r.u8(), owner: r.uv(), x: r.sv() / 8, y: r.sv() / 8, vx: r.sv(), vy: r.sv() });
  }
  const grenades: GrenadeView[] = [];
  const ng = r.uv();
  for (let i = 0; i < ng; i++) {
    grenades.push({ id: r.uv(), kind: r.u8(), owner: r.uv(), x: r.sv() / 8, y: r.sv() / 8, stuck: r.sv(), armed: r.u8() === 1, fuse: r.uv() });
  }
  const clouds: CloudView[] = [];
  const nc = r.uv();
  for (let i = 0; i < nc; i++) clouds.push({ id: r.uv(), kind: r.u8(), x: r.sv(), y: r.sv(), r: r.uv(), life: r.uv() });
  const dropped: DroppedView[] = [];
  const nd = r.uv();
  for (let i = 0; i < nd; i++) dropped.push({ id: r.uv(), wi: r.u8(), x: r.sv(), y: r.sv() });
  const ns = r.uv();
  if (ns > 256) throw new DecodeError('too many spawners');
  const spawners: { available: boolean; item: number }[] = [];
  let byte = 0;
  for (let i = 0; i < ns; i++) {
    if ((i & 7) === 0) byte = r.u8();
    spawners.push({ available: (byte & (1 << (i & 7))) !== 0, item: -1 });
  }
  for (const s of spawners) if (s.available) s.item = r.i8();
  const ne = r.uv();
  if (ne > 2000) throw new DecodeError('too many events');
  const events: SimEvent[] = [];
  for (let i = 0; i < ne; i++) {
    const id = r.uv();
    const type = r.u8();
    const etick = r.uv();
    const n = r.u8();
    const d: number[] = [];
    for (let k = 0; k < n; k++) d.push(r.sv());
    events.push({ id, type, tick: etick, d });
  }
  return { matchId, tick, baseTick, ack, inputBuffer, rosterVersion, mode, players, projectiles, grenades, clouds, dropped, spawners, events };
}
