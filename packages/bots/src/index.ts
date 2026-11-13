import { GRENADES, PLAYER, TILE, WEAPONS } from '@game/content';
import { Tile, type MapData } from '@game/maps';
import {
  ACT_MELEE,
  ACT_RELOAD,
  ACT_SWAP,
  ACT_THROW,
  ANGLE_ONE,
  BTN_FIRE,
  BTN_JET,
  BTN_ZOOM,
  Rng,
  angleDiff,
  bodyHeight,
  bumpCounter,
  datan2,
  type Input,
  type Player,
  type Sim,
} from '@game/sim';

export interface DifficultyProfile {
  reaction: number;
  aimError: number;
  aimSpeed: number;
  fireCone: number;
  grenadeChance: number;
  viewRange: number;
}

/** Aim angles are 16-bit binary angles (65536 = full turn). */
const RAD = ANGLE_ONE / (2 * Math.PI);

export const DIFFICULTY: readonly DifficultyProfile[] = [
  { reaction: 26, aimError: 0.2 * RAD, aimSpeed: 900, fireCone: 0.24 * RAD, grenadeChance: 0.002, viewRange: 850 },
  { reaction: 15, aimError: 0.1 * RAD, aimSpeed: 1600, fireCone: 0.14 * RAD, grenadeChance: 0.004, viewRange: 1100 },
  { reaction: 8, aimError: 0.045 * RAD, aimSpeed: 2600, fireCone: 0.08 * RAD, grenadeChance: 0.007, viewRange: 1350 },
];

interface NavGrid {
  w: number;
  h: number;
  stand: Uint8Array;
  danger: Uint8Array;
}

const navCache = new WeakMap<MapData, NavGrid>();

function navFor(map: MapData): NavGrid {
  let g = navCache.get(map);
  if (g) return g;
  const { width: w, height: h, tiles } = map;
  const blocks = (t: number) => t === Tile.Solid || t === Tile.Ice || t === Tile.Lava;
  const stand = new Uint8Array(w * h);
  const danger = new Uint8Array(w * h);
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      stand[i] = !blocks(tiles[i]) && !blocks(tiles[i - w]) ? 1 : 0;
      // Cells within 2 tiles above lava are dangerous.
      for (let k = 0; k <= 2; k++) if (y + k < h && tiles[(y + k) * w + x] === Tile.Lava) danger[i] = 1;
    }
  }
  g = { w, h, stand, danger };
  navCache.set(map, g);
  return g;
}

/** BFS path on the body grid. Returns cell indices from start (exclusive) to goal (inclusive). */
function findPath(nav: NavGrid, sx: number, sy: number, gx: number, gy: number, maxNodes = 6000): number[] {
  const { w, h, stand, danger } = nav;
  const clampCell = (x: number, y: number) => {
    x = Math.max(0, Math.min(w - 1, x));
    y = Math.max(1, Math.min(h - 1, y));
    if (stand[y * w + x]) return y * w + x;
    for (let r = 1; r < 5; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 1 && nx < w && ny < h && stand[ny * w + nx]) return ny * w + nx;
        }
    return -1;
  };
  const start = clampCell(sx, sy);
  const goal = clampCell(gx, gy);
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [goal];
  const prev = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  let qh = 0;
  let qt = 0;
  queue[qt++] = start;
  prev[start] = start;
  let found = false;
  let n = 0;
  while (qh < qt && n++ < maxNodes) {
    const c = queue[qh++];
    if (c === goal) {
      found = true;
      break;
    }
    const x = c % w;
    const y = (c - x) / w;
    const nb = [c + 1, c - 1, c - w, c + w];
    const ok = [x + 1 < w, x > 0, y > 1, y + 1 < h];
    for (let k = 0; k < 4; k++) {
      if (!ok[k]) continue;
      const j = nb[k];
      if (prev[j] >= 0 || !stand[j] || danger[j]) continue;
      prev[j] = c;
      queue[qt++] = j;
    }
  }
  if (!found) return [];
  const path: number[] = [];
  let c = goal;
  while (c !== start) {
    path.push(c);
    c = prev[c];
  }
  path.reverse();
  return path;
}

export class BotBrain {
  readonly id: number;
  private rng: Rng;
  private profile: DifficultyProfile;
  private input: Input;
  private actions = 0;
  private path: number[] = [];
  private pathGoal = -1;
  private repath = 0;
  private target = -1;
  private seenFor = 0;
  private aimNoise = 0;
  private strafe = 0;
  private strafeT = 0;
  private goalX = 0;
  private goalY = 0;
  private stuckT = 0;
  private lastX = 0;
  private seq = 0;
  private wander = -1;
  private refuel = false;
  private progX = 0;
  private progY = 0;
  private escapeT = 0;
  private escapeDir = 1;

  constructor(id: number, difficulty: number, seed: number) {
    this.id = id;
    this.rng = new Rng((seed ^ Math.imul(id + 1, 0x9e3779b1)) >>> 0);
    this.profile = DIFFICULTY[Math.max(0, Math.min(2, difficulty))];
    this.input = { seq: 0, moveX: 0, moveY: 0, aim: 0, buttons: 0, actions: 0, throwPower: 0, signal: 0, viewTick: 0 };
  }

  /** Produce this tick's input for the bot's player. */
  think(sim: Sim): Input {
    const me = sim.getPlayer(this.id);
    const inp = this.input;
    inp.seq = ++this.seq;
    inp.viewTick = sim.tick;
    inp.buttons = 0;
    inp.moveX = 0;
    inp.moveY = 0;
    if (!me || !me.alive || me.dummy) return inp;
    const nav = navFor(sim.map);
    const sh = sim.shoulderOf(me);

    // ---- target selection
    if (sim.tick % 6 === this.id % 6 || this.target < 0) this.pickTarget(sim, me, sh);
    const tgt = this.target >= 0 ? sim.getPlayer(this.target) : undefined;
    const visible = !!tgt && tgt.alive && this.canSee(sim, sh.x, sh.y, tgt);
    this.seenFor = visible ? this.seenFor + 1 : 0;

    // ---- goal selection
    this.chooseGoal(sim, me, tgt, visible);

    // ---- navigation
    const cx = Math.floor(me.x / TILE);
    const cy = Math.floor((me.y - 1) / TILE);
    const gx = Math.floor(this.goalX / TILE);
    const gy = Math.floor((this.goalY - 1) / TILE);
    const goalCell = gy * nav.w + gx;
    if (--this.repath <= 0 || goalCell !== this.pathGoal) {
      this.path = findPath(nav, cx, cy, gx, gy);
      this.pathGoal = goalCell;
      this.repath = 30 + (this.id % 10);
    }
    while (this.path.length && this.path[0] === cy * nav.w + cx) this.path.shift();
    let wx = this.goalX;
    let wy = this.goalY;
    if (this.path.length) {
      // Smooth: aim for the farthest waypoint (up to 8 ahead) in line of sight.
      let pick = this.path[0];
      for (let k = Math.min(this.path.length - 1, 8); k > 0; k--) {
        const c = this.path[k];
        const px = (c % nav.w) * TILE + TILE / 2;
        const py = Math.floor(c / nav.w) * TILE + TILE - 4;
        if (sim.world.los(me.x, me.y - 20, px, py - 16, sim.tick)) {
          pick = c;
          break;
        }
      }
      wx = (pick % nav.w) * TILE + TILE / 2;
      wy = Math.floor(pick / nav.w) * TILE + TILE;
      // Drop passed waypoints.
      const idx = this.path.indexOf(pick);
      if (idx > 0 && Math.abs(me.x - wx) < 12 && Math.abs(me.y - wy) < 20) this.path.splice(0, idx + 1);
    }
    const dx = wx - me.x;
    const dy = wy - me.y;
    let moveX = Math.abs(dx) > 6 ? Math.sign(dx) : 0;
    let jet = dy < -10 || (me.wall !== 0 && Math.sign(dx) === me.wall);
    if (!me.onGround && dy < 24 && dy > -10 && Math.abs(dx) > 40 && me.vy > 60) jet = true; // glide across gaps
    // Lava/void safety.
    const below = this.dangerBelow(sim, me);
    if (below && me.vy > -100) jet = true;
    // Fuel discipline (with hysteresis): when low, land and refuel to 70% before flying again.
    if (me.fuel < 12) this.refuel = true;
    if (this.refuel && (me.fuel > PLAYER.fuelMax * 0.7 || !me.onGround && me.fuel > 30)) this.refuel = false;
    if (this.refuel && !below) jet = false;

    // Combat movement: strafe and keep distance.
    if (visible && tgt) {
      const dist = Math.abs(tgt.x - me.x);
      const def = WEAPONS[me.slots[me.active].wi] ?? WEAPONS[0];
      const ideal = def.range * (def.id === 'mule' ? 0.25 : def.id === 'torchie' ? 0.6 : 0.45);
      if (--this.strafeT <= 0) {
        this.strafe = this.rng.int(3) - 1;
        this.strafeT = 20 + this.rng.int(40);
      }
      if (this.mode(sim) !== 'ctf' && this.mode(sim) !== 'koth') {
        moveX = dist > ideal + 120 ? Math.sign(tgt.x - me.x) : dist < ideal - 120 ? -Math.sign(tgt.x - me.x) : this.strafe;
        if (this.rng.next() < 0.02 && me.fuel > 40) jet = true;
      }
    }

    // Path goes down: drop through one-way platforms.
    let drop = !visible && wy > me.y + 10 && me.onGround && Math.abs(dx) < 48;

    // Unstick: pushing against something, or not making progress for a while.
    if (Math.abs(me.x - this.lastX) < 0.5 && moveX !== 0) this.stuckT++;
    else this.stuckT = 0;
    this.lastX = me.x;
    if (this.stuckT > 30) {
      jet = true;
      if (this.stuckT > 70) {
        moveX = -moveX;
        this.repath = 0;
        this.stuckT = 0;
      }
    }
    if (sim.tick % 90 === this.id % 90) {
      const moved = Math.abs(me.x - this.progX) + Math.abs(me.y - this.progY);
      const atGoal = Math.abs(me.x - this.goalX) < 64 && Math.abs(me.y - this.goalY) < 64;
      this.progX = me.x;
      this.progY = me.y;
      if (moved < 24 && !visible && !atGoal) {
        this.escapeT = 45;
        this.escapeDir = this.rng.next() < 0.5 ? -1 : 1;
        this.repath = 0;
      }
    }
    if (this.escapeT > 0) {
      this.escapeT--;
      moveX = this.escapeDir;
      jet = this.escapeT > 20 && me.fuel > 10;
      drop = this.escapeT <= 20;
    }

    inp.moveX = moveX * 127;
    if (drop) inp.moveY = 127;
    if (jet && me.fuel > 0) inp.buttons |= BTN_JET;

    // ---- aiming and shooting
    let desired = inp.aim;
    if (visible && tgt) {
      const def = WEAPONS[me.slots[me.active].wi] ?? WEAPONS[0];
      const th = bodyHeight(tgt);
      let tx = tgt.x;
      let ty = tgt.y - th * 0.55;
      if (def.projectile && def.kind !== 'flame') {
        const t = Math.sqrt((tx - sh.x) * (tx - sh.x) + (ty - sh.y) * (ty - sh.y)) / def.projectile.speed;
        tx += tgt.vx * t;
        ty += tgt.vy * t * 0.5;
        if (def.projectile.gravity > 0) ty -= 0.5 * def.projectile.gravity * t * t;
      }
      if (sim.tick % 20 === this.id % 20) this.aimNoise = (this.rng.next() * 2 - 1) * this.profile.aimError;
      desired = (datan2(ty - sh.y, tx - sh.x) + Math.round(this.aimNoise) + ANGLE_ONE) % ANGLE_ONE;
    } else if (Math.abs(moveX) > 0) {
      desired = moveX > 0 ? 0 : ANGLE_ONE / 2;
    }
    const diff = angleDiff(inp.aim, desired);
    const maxTurn = this.profile.aimSpeed / 60 * (ANGLE_ONE / 4096);
    inp.aim = (inp.aim + Math.max(-maxTurn, Math.min(maxTurn, diff)) + ANGLE_ONE) % ANGLE_ONE;
    inp.aim = Math.round(inp.aim) & 0xffff;

    if (visible && tgt && this.seenFor > this.profile.reaction) {
      const aimErr = Math.abs(angleDiff(inp.aim, desired));
      const slot = me.slots[me.active];
      const def = WEAPONS[slot.wi] ?? WEAPONS[0];
      const dist = Math.sqrt((tgt.x - me.x) * (tgt.x - me.x) + (tgt.y - me.y) * (tgt.y - me.y));
      if (aimErr < this.profile.fireCone && dist < def.range * 0.95) {
        if (def.auto || sim.tick % 2 === 0) inp.buttons |= BTN_FIRE;
      }
      if (def.zoom < 1 && dist > 500) inp.buttons |= BTN_ZOOM;
      if (dist < 46 && me.meleeCd === 0) this.actions = bumpCounter(this.actions, ACT_MELEE);
      if (
        me.grenades.length > 0 &&
        dist > 140 &&
        dist < 520 &&
        this.rng.next() < this.profile.grenadeChance * 4 &&
        GRENADES[me.grenades[0]].id !== 'smoke'
      ) {
        inp.throwPower = Math.max(30, Math.min(255, Math.round((dist / 520) * 255)));
        this.actions = bumpCounter(this.actions, ACT_THROW);
      }
    }

    // ---- weapon management
    const slot = me.slots[me.active];
    const other = me.slots[1 - me.active];
    if (slot.wi < 0 || (slot.mag === 0 && slot.reserve === 0 && other.wi >= 0)) {
      if (sim.tick % 15 === 0) this.actions = bumpCounter(this.actions, ACT_SWAP);
    } else if (me.active === 0 && other.wi >= 0 && (other.mag > 0 || other.reserve !== 0) && sim.tick % 30 === 0) {
      this.actions = bumpCounter(this.actions, ACT_SWAP);
    } else if (!visible && slot.wi >= 0 && slot.mag < WEAPONS[slot.wi].magSize * 0.4 && slot.reserve !== 0 && me.reloadT === 0 && sim.tick % 20 === 0) {
      this.actions = bumpCounter(this.actions, ACT_RELOAD);
    }
    // Upgrade to a better weapon lying underfoot.
    const near = sim.nearbyWeapon(me);
    if (near && sim.tick % 20 === this.id % 20) {
      const nd = WEAPONS[near.wi];
      const cur = me.slots[nd.slot === 'sidearm' ? 0 : 1];
      const curDef = cur.wi >= 0 ? WEAPONS[cur.wi] : null;
      const better = !curDef || (nd.slot === 'heavy' && curDef.slot !== 'heavy') || (curDef.id === 'hornet' && nd.slot === 'primary') || (curDef.id === 'sparrow' && nd.slot === 'sidearm') || cur.reserve === 0;
      if (better) this.actions = bumpCounter(this.actions, ACT_SWAP);
    }
    inp.actions = this.actions;
    return inp;
  }

  private mode(sim: Sim): string {
    return sim.config.mode;
  }

  private canSee(sim: Sim, sx: number, sy: number, t: Player): boolean {
    const ty = t.y - bodyHeight(t) * 0.55;
    const dx = t.x - sx;
    const dy = ty - sy;
    if (dx * dx + dy * dy > this.profile.viewRange * this.profile.viewRange) return false;
    if (sim.map.theme.dark && dx * dx + dy * dy > 520 * 520 && !t.jetting && t.input.buttons === 0) return false;
    if (sim.smokeBlocks(sx, sy, t.x, ty)) return false;
    return sim.world.los(sx, sy, t.x, ty, sim.tick);
  }

  private isEnemy(sim: Sim, me: Player, o: Player): boolean {
    if (o === me || !o.alive) return false;
    if (sim.modeInfo.teams) return o.team !== me.team;
    return true;
  }

  private pickTarget(sim: Sim, me: Player, sh: { x: number; y: number }): void {
    let best = -1;
    let bestScore = Infinity;
    for (const o of sim.players) {
      if (!this.isEnemy(sim, me, o) || o.protT > 0) continue;
      const dx = o.x - me.x;
      const dy = o.y - me.y;
      let score = Math.sqrt(dx * dx + dy * dy);
      if (!this.canSee(sim, sh.x, sh.y, o)) score += 1600;
      score -= (100 - Math.min(100, o.hp)) * 2;
      if (o.leader) score -= 300;
      if (o.carrying >= 0) score -= 500;
      if (o.id === this.target) score -= 150; // stickiness
      if (score < bestScore) {
        bestScore = score;
        best = o.id;
      }
    }
    this.target = best;
  }

  private chooseGoal(sim: Sim, me: Player, tgt: Player | undefined, visible: boolean): void {
    const m = sim.mode;
    const mode = sim.config.mode;
    const setGoal = (x: number, y: number) => {
      this.goalX = x;
      this.goalY = y;
    };
    // Low health: seek a health pack.
    if (me.hp < me.maxHp * 0.4 && !me.drone) {
      const hp = this.nearestSpawner(sim, me, (k) => k === 'health');
      if (hp) return setGoal(hp.x, hp.y);
    }
    if (mode === 'ctf' && m.flags.length === 2 && me.team >= 0) {
      const own = m.flags[me.team];
      const enemy = m.flags[1 - me.team];
      if (me.carrying >= 0) return setGoal(own.homeX, own.homeY);
      if (own.state === 2) return setGoal(own.x, own.y);
      const role = me.id % 3; // 0: attacker 1: attacker 2: defender
      if (own.state === 1) {
        const c = sim.getPlayer(own.carrier);
        if (c) return setGoal(c.x, c.y);
      }
      if (role !== 2 && enemy.state !== 1) return setGoal(enemy.x, enemy.y);
      if (role === 2) return setGoal(own.homeX + (visible && tgt ? 0 : (this.rng.int(5) - 2) * 32), own.homeY);
    }
    if (mode === 'koth') {
      const z = m.zone;
      return setGoal(z.x + z.w / 2 + ((me.id % 5) - 2) * 24, z.y + z.h);
    }
    if (mode === 'bomb') {
      const holder = sim.players.find((p) => p.bomb && p.alive);
      if (holder && holder !== me) {
        // Flee: go to the spawn farthest from the holder.
        let far = sim.map.objects[0];
        let fd = -1;
        for (const o of sim.map.objects) {
          if (o.kind !== 'spawn') continue;
          const d = (o.x - holder.x) * (o.x - holder.x) + (o.y - holder.y) * (o.y - holder.y);
          if (d > fd) {
            fd = d;
            far = o;
          }
        }
        return setGoal(far.x, far.y);
      }
    }
    if (mode === 'leader' && me.leader) {
      const allies = sim.players.filter((p) => p.team === me.team && p.alive && p !== me);
      if (allies.length) return setGoal(allies[0].x, allies[0].y);
    }
    if (tgt && tgt.alive) return setGoal(tgt.x, tgt.y);
    // Without a target, collect weapons or wander between spawns.
    if (me.slots[1].wi < 0 || WEAPONS[me.slots[1].wi]?.id === 'hornet' || (me.slots[0].wi >= 0 && WEAPONS[me.slots[0].wi]?.id === 'sparrow' && this.id % 4 === 0)) {
      const w = this.nearestSpawner(sim, me, (k) => k === 'weapon' || k === 'heavy');
      if (w) return setGoal(w.x, w.y);
    }
    const spawns = sim.map.objects.filter((o) => o.kind === 'spawn' || o.kind === 'hill');
    if (this.wander < 0 || (Math.abs(me.x - this.goalX) < 40 && Math.abs(me.y - this.goalY) < 60)) this.wander = this.rng.int(spawns.length);
    const s = spawns[this.wander % spawns.length];
    setGoal(s.x, s.y);
  }

  private nearestSpawner(sim: Sim, me: Player, pred: (k: string) => boolean) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const s of sim.spawners) {
      if (!s.available || !pred(s.kind)) continue;
      const d = (s.x - me.x) * (s.x - me.x) + (s.y - me.y) * (s.y - me.y);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best && bd < 1400 * 1400 ? best : null;
  }

  private dangerBelow(sim: Sim, me: Player): boolean {
    const tx = Math.floor(me.x / TILE);
    const ty = Math.floor(me.y / TILE);
    for (let k = 0; k < 6; k++) {
      const t = sim.world.tileAt(tx, ty + k);
      if (t === Tile.Lava) return true;
      if (t === Tile.Solid || t === Tile.Ice || t === Tile.OneWay) return false;
    }
    return me.y > sim.world.pxH - PLAYER.height * 2;
  }
}

/** Manages brains for every bot player in a sim (bots added/removed by modes are picked up automatically). */
export class BotDirector {
  private brains = new Map<number, BotBrain>();
  constructor(private seed: number) {}

  update(sim: Sim): void {
    for (const p of sim.players) {
      if (!p.isBot || p.dummy) continue;
      let b = this.brains.get(p.id);
      if (!b) {
        b = new BotBrain(p.id, p.difficulty, this.seed);
        this.brains.set(p.id, b);
      }
      sim.setInput(p.id, b.think(sim));
    }
    if (sim.tick % 120 === 0) {
      for (const id of this.brains.keys()) if (!sim.getPlayer(id)) this.brains.delete(id);
    }
  }
}
