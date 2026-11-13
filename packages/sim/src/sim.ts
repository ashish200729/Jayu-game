import {
  COMBAT,
  DEFAULT_LOADOUT,
  GRENADES,
  MATCH,
  PLAYER,
  STARTING_PRIMARY,
  STARTING_SIDEARM,
  TICK_RATE,
  TILE,
  WEAPONS,
  cosmeticIndex,
  modeDef,
  upgradeChoices,
  waveSpec,
  weaponIndex,
  type Loadout,
  type ModeDef,
} from '@game/content';
import { getMap, type MapData } from '@game/maps';
import {
  ACT_MELEE,
  ACT_RELOAD,
  ACT_SIGNAL,
  ACT_SWAP,
  ACT_THROW,
  BTN_FIRE,
  BTN_ZOOM,
  SIGNAL_CHAT,
  SIGNAL_EMOTE,
  SIGNAL_UPGRADE,
  counter,
  emptyInput,
  type Input,
} from './input';
import { ANGLE_ONE, Hasher, Rng, datan2, dcos, dsin, q8 } from './math';
import { MEDIUM_LAVA, bodyHeight, stepMovement, type MoveMods } from './movement';
import {
  EventType,
  KILL_BOMB,
  KILL_BURN,
  KILL_GAS,
  KILL_GRENADE,
  KILL_LAVA,
  KILL_MELEE,
  KILL_WORLD,
  type Cloud,
  type DroppedWeapon,
  type Flag,
  type Grenade,
  type MatchConfig,
  type ModeState,
  type PickupSpawner,
  type Player,
  type Projectile,
  type SimEvent,
} from './types';
import { World, segmentRect } from './world';

const HIST = 32;
const HW = PLAYER.width / 2;
const HIT_PAD = 2;
const sec = (s: number) => Math.round(s * TICK_RATE);

export interface AddPlayerOptions {
  id?: number;
  name: string;
  team?: number;
  isBot?: boolean;
  dummy?: boolean;
  drone?: boolean;
  difficulty?: number;
  loadout?: Loadout;
}

export interface PlayerResult {
  id: number;
  name: string;
  team: number;
  isBot: boolean;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  objective: number;
  damage: number;
  accuracy: number;
  headshots: number;
  favouriteWeapon: string;
  weaponKills: Record<string, number>;
  bestCourse: number;
}

export interface MatchResults {
  mode: string;
  mapId: string;
  winner: number;
  winnerTeam: number;
  teamScores: [number, number];
  mvp: number;
  wave: number;
  durationTicks: number;
  players: PlayerResult[];
}

interface History {
  x: Float64Array;
  y: Float64Array;
  h: Float64Array;
  alive: Uint8Array;
  tick: Int32Array;
}

export class Sim {
  readonly config: MatchConfig;
  readonly map: MapData;
  readonly world: World;
  readonly modeInfo: ModeDef;
  readonly rng: Rng;
  tick = 0;
  players: Player[] = [];
  projectiles: Projectile[] = [];
  grenades: Grenade[] = [];
  clouds: Cloud[] = [];
  spawners: PickupSpawner[] = [];
  dropped: DroppedWeapon[] = [];
  mode: ModeState;
  events: SimEvent[] = [];
  private nextEntity = 1;
  private nextEvent = 1;
  private nextPlayerId = 1;
  private history = new Map<number, History>();
  private removeQueue: { id: number; at: number }[] = [];

  constructor(config: MatchConfig, map?: MapData) {
    this.config = config;
    this.map = map ?? getMap(config.mapId);
    this.world = new World(this.map, config.lowGravity);
    this.modeInfo = modeDef(config.mode);
    this.rng = new Rng(config.seed);
    const limit = config.scoreLimit > 0 ? config.scoreLimit : this.modeInfo.defaultScoreLimit;
    const timeLimit = config.mode === 'survival' || config.mode === 'training' ? 0 : config.timeLimit;
    this.mode = {
      phase: config.mode === 'survival' ? 'intermission' : 'countdown',
      phaseT: config.mode === 'survival' ? sec(6) : sec(MATCH.countdown),
      timeLeft: timeLimit > 0 ? sec(timeLimit) : -1,
      teamScores: [0, 0],
      scoreLimit: limit,
      flags: [],
      zone: { index: 0, x: 0, y: 0, w: 7 * TILE, h: 5 * TILE, t: sec(MATCH.kothZoneDuration), owner: -1, progress: 0 },
      bombT: 0,
      passCd: 0,
      wave: 0,
      waveSpawned: 0,
      waveTotal: 0,
      winner: -1,
      winnerTeam: -1,
      leaders: [-1, -1],
    };
    if (config.mode === 'training') {
      this.mode.phase = 'playing';
      this.mode.phaseT = 0;
    }
    for (const o of this.map.objects) {
      if (o.kind === 'flag') {
        this.mode.flags.push({ team: o.team, state: 0, x: o.x, y: o.y, homeX: o.x, homeY: o.y, carrier: -1, returnT: 0 });
      }
    }
    this.mode.flags.sort((a, b) => a.team - b.team);
    this.placeZone(0);
    let idx = 0;
    for (const o of this.map.objects) {
      if (o.kind === 'weapon' || o.kind === 'heavy' || o.kind === 'health' || o.kind === 'grenade' || o.kind === 'dual') {
        const sp: PickupSpawner = { index: idx++, kind: o.kind, x: o.x, y: o.y, item: -1, available: true, timer: 0 };
        this.rollSpawner(sp);
        if ((sp.kind === 'weapon' || sp.kind === 'heavy') && !config.pickups) sp.available = false;
        if (config.mode === 'bomb' && (sp.kind === 'heavy' || sp.kind === 'grenade')) sp.available = false;
        this.spawners.push(sp);
      }
    }
    if (config.mode === 'training') this.spawnTrainingDummies();
  }

  // ---------------------------------------------------------------- players

  addPlayer(opts: AddPlayerOptions): Player {
    const id = opts.id ?? this.nextPlayerId;
    this.nextPlayerId = Math.max(this.nextPlayerId, id + 1);
    let team = opts.team ?? -1;
    if (this.modeInfo.teams && team < 0) {
      const c0 = this.players.filter((p) => p.team === 0 && !p.drone && !p.dummy).length;
      const c1 = this.players.filter((p) => p.team === 1 && !p.drone && !p.dummy).length;
      team = this.config.mode === 'survival' ? 0 : c1 < c0 ? 1 : 0;
    }
    if (!this.modeInfo.teams) team = opts.dummy ? 1 : -1;
    const lo = opts.loadout ?? DEFAULT_LOADOUT;
    const p: Player = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      onGround: false,
      crouch: false,
      slideT: 0,
      jetT: 0,
      fuel: PLAYER.fuelMax,
      fuelDelay: 0,
      facing: 1,
      wall: 0,
      jetting: false,
      medium: 0,
      prevJet: false,
      ride: -1,
      dropT: 0,
      id,
      name: opts.name.slice(0, 16),
      team,
      isBot: !!opts.isBot,
      dummy: !!opts.dummy,
      drone: !!opts.drone,
      difficulty: opts.difficulty ?? this.config.botDifficulty,
      look: [lo.head, lo.outfit, lo.jetpack, lo.skin, lo.emote, lo.pose].map(cosmeticIndex),
      alive: false,
      hp: 0,
      maxHp: PLAYER.maxHp,
      respawnT: this.mode.phase === 'playing' ? sec(1) : 0,
      protT: 0,
      regenT: 0,
      aim: 0,
      slots: [
        { wi: -1, mag: 0, reserve: 0 },
        { wi: -1, mag: 0, reserve: 0 },
      ],
      active: 1,
      reloadT: 0,
      fireCd: 0,
      burstLeft: 0,
      burstCd: 0,
      recoil: 0,
      prevFire: false,
      grenades: [],
      throwCd: 0,
      meleeCd: 0,
      meleeT: 0,
      lastActions: 0,
      dualT: 0,
      burnT: 0,
      burnBy: -1,
      zoom: false,
      flaming: false,
      emote: 0,
      emoteT: 0,
      carrying: -1,
      leader: false,
      bomb: false,
      eliminated: false,
      upgrades: { damage: 0, hp: 0, fuel: 0, reload: 0, speed: 0 },
      pendingUpgrade: false,
      damageMult: 1,
      kills: 0,
      deaths: 0,
      assists: 0,
      score: 0,
      damageDealt: 0,
      shotsFired: 0,
      shotsHit: 0,
      headshots: 0,
      objective: 0,
      weaponKills: {},
      recentAttackers: [],
      lastDamageTick: 0,
      checkpoint: 0,
      courseStart: -1,
      bestCourse: 0,
      input: emptyInput(),
      ack: 0,
      hiddenUntil: 0,
    };
    // Hot potato joiners after the start sit out the round.
    if (this.config.mode === 'bomb' && this.mode.phase === 'playing') p.eliminated = true;
    if (this.config.mode === 'survival' && p.team === 0 && this.mode.phase === 'playing') p.respawnT = 1 << 30;
    this.players.push(p);
    this.players.sort((a, b) => a.id - b.id);
    this.history.set(id, {
      x: new Float64Array(HIST),
      y: new Float64Array(HIST),
      h: new Float64Array(HIST),
      alive: new Uint8Array(HIST),
      tick: new Int32Array(HIST).fill(-1),
    });
    if (this.mode.phase !== 'playing' || p.dummy) this.spawnPlayer(p);
    return p;
  }

  removePlayer(id: number): void {
    const p = this.getPlayer(id);
    if (!p) return;
    if (p.alive) this.dropStuff(p);
    if (p.bomb) {
      p.bomb = false;
      this.mode.bombT = sec(2);
    }
    if (this.mode.leaders[0] === id) this.mode.leaders[0] = -1;
    if (this.mode.leaders[1] === id) this.mode.leaders[1] = -1;
    for (const g of this.grenades) if (g.stuck === id) g.stuck = -1;
    this.players = this.players.filter((x) => x.id !== id);
    this.history.delete(id);
  }

  getPlayer(id: number): Player | undefined {
    for (const p of this.players) if (p.id === id) return p;
    return undefined;
  }

  setInput(id: number, input: Input): void {
    const p = this.getPlayer(id);
    if (!p) return;
    const dst = p.input;
    dst.seq = input.seq;
    dst.moveX = input.moveX;
    dst.moveY = input.moveY;
    dst.aim = input.aim;
    dst.buttons = input.buttons;
    dst.actions = input.actions;
    dst.throwPower = input.throwPower;
    dst.signal = input.signal;
    dst.viewTick = input.viewTick;
    p.ack = input.seq;
  }

  private spawnPlayer(p: Player): void {
    const pos = this.chooseSpawn(p);
    p.x = pos.x;
    p.y = pos.y;
    p.vx = 0;
    p.vy = 0;
    p.onGround = false;
    p.crouch = false;
    p.ride = -1;
    p.alive = true;
    p.maxHp = PLAYER.maxHp + p.upgrades.hp * 25;
    if (p.leader) p.maxHp = PLAYER.leaderHp;
    if (p.drone) {
      const spec = waveSpec(Math.max(1, this.mode.wave), this.humanCount());
      p.maxHp = Math.round(PLAYER.maxHp * spec.hpMult);
      p.damageMult = spec.damageMult;
    } else {
      p.damageMult = 1 + p.upgrades.damage * 0.15;
    }
    p.hp = p.maxHp;
    p.fuel = PLAYER.fuelMax * (1 + p.upgrades.fuel * 0.3);
    p.protT = p.dummy || p.drone ? 0 : sec(PLAYER.spawnProtection);
    p.lastDamageTick = this.tick;
    p.slots[0] = this.makeSlot(weaponIndex(STARTING_SIDEARM));
    if (p.drone) {
      const spec = waveSpec(Math.max(1, this.mode.wave), this.humanCount());
      p.slots[1] = this.makeSlot(weaponIndex(this.rng.pick(spec.weapons)));
      p.slots[1].reserve = -1;
    } else if (this.config.mode === 'bomb') {
      p.slots[1] = { wi: -1, mag: 0, reserve: 0 };
    } else {
      p.slots[1] = this.makeSlot(weaponIndex(STARTING_PRIMARY));
    }
    p.active = p.slots[1].wi >= 0 ? 1 : 0;
    p.reloadT = 0;
    p.fireCd = 0;
    p.burstLeft = 0;
    p.recoil = 0;
    p.grenades = p.drone || this.config.mode === 'bomb' ? [] : [0, 0];
    p.dualT = 0;
    p.burnT = 0;
    p.carrying = -1;
    p.respawnT = 0;
    p.recentAttackers = [];
    p.checkpoint = 0;
    p.courseStart = -1;
    this.recordHistory(p);
    this.emit(EventType.Spawn, [p.id, Math.round(p.x), Math.round(p.y)]);
  }

  private makeSlot(wi: number) {
    const d = WEAPONS[wi];
    return { wi, mag: d.magSize, reserve: d.reserve };
  }

  private humanCount(): number {
    let n = 0;
    for (const p of this.players) if (!p.drone && !p.dummy) n++;
    return n;
  }

  private chooseSpawn(p: Player): { x: number; y: number } {
    let spawns = this.map.objects.filter((o) => o.kind === 'spawn');
    if (p.dummy) {
      const targets = this.map.objects.filter((o) => o.kind === 'target');
      const t = targets[p.checkpoint % Math.max(1, targets.length)];
      if (t) return { x: t.x, y: t.y };
    }
    const half = this.world.pxW / 2;
    if (this.modeInfo.teams && p.team >= 0) {
      const side = spawns.filter((s) => s.team === p.team || (s.team === -1 && (s.x < half ? 0 : 1) === p.team));
      if (side.length) spawns = side;
    }
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const s of spawns) {
      let minD = 1e9;
      let seen = false;
      for (const e of this.players) {
        if (!e.alive || e === p || e.dummy) continue;
        if (this.modeInfo.teams && e.team === p.team) continue;
        const d = Math.hypot(e.x - s.x, e.y - s.y);
        if (d < minD) minD = d;
        if (d < 700 && this.world.los(s.x, s.y - 30, e.x, e.y - 30, this.tick)) seen = true;
      }
      const score = Math.min(minD, 1500) - (seen ? 2000 : 0) + this.rng.next() * 200;
      if (score > bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return { x: best.x, y: best.y };
  }

  // ---------------------------------------------------------------- events

  emit(type: EventType, d: number[]): void {
    this.events.push({ id: this.nextEvent++, type, tick: this.tick, d });
  }

  // ---------------------------------------------------------------- step

  step(): void {
    this.events = [];
    this.tick++;
    const m = this.mode;
    this.updatePhase();
    const frozen = m.phase === 'countdown' || m.phase === 'ended';
    for (const p of this.players) {
      if (p.alive) this.updatePlayer(p, frozen);
      else this.updateDead(p);
      this.recordHistory(p);
    }
    this.updateProjectiles();
    this.updateGrenades();
    this.updateClouds();
    this.updatePickups();
    if (m.phase === 'playing' || m.phase === 'intermission') this.updateMode();
    if (this.removeQueue.length) {
      const now = this.tick;
      const due = this.removeQueue.filter((r) => r.at <= now);
      this.removeQueue = this.removeQueue.filter((r) => r.at > now);
      for (const r of due) this.removePlayer(r.id);
    }
  }

  private recordHistory(p: Player): void {
    const h = this.history.get(p.id);
    if (!h) return;
    const i = this.tick % HIST;
    h.x[i] = p.x;
    h.y[i] = p.y;
    h.h[i] = bodyHeight(p);
    h.alive[i] = p.alive ? 1 : 0;
    h.tick[i] = this.tick;
  }

  private updatePhase(): void {
    const m = this.mode;
    if (m.phase === 'countdown') {
      if (--m.phaseT <= 0) {
        m.phase = 'playing';
        this.onMatchStart();
      }
    } else if (m.phase === 'ended') {
      if (m.phaseT > 0) m.phaseT--;
    } else if (m.phase === 'playing' && m.timeLeft > 0) {
      m.timeLeft--;
      if (m.timeLeft === 0) this.endByTime();
    }
  }

  private onMatchStart(): void {
    if (this.config.mode === 'bomb') {
      this.mode.bombT = sec(3);
    }
    if (this.config.mode === 'leader') this.assignLeaders();
  }

  private updateDead(p: Player): void {
    if (p.eliminated) return;
    if (this.mode.phase === 'ended' || this.mode.phase === 'countdown') return;
    if (p.respawnT > 0) p.respawnT--;
    if (p.respawnT <= 0 && (this.modeInfo.respawn || p.dummy)) this.spawnPlayer(p);
  }

  private updatePlayer(p: Player, frozen: boolean): void {
    const inp = p.input;
    const acts = inp.actions;
    const last = p.lastActions;
    p.lastActions = acts;
    const changed = (shift: number) => counter(acts, shift) !== counter(last, shift);
    const canAct = !frozen && !p.dummy && this.mode.phase !== 'intermission';
    p.aim = inp.aim & 0xffff;

    // Movement.
    const mods: MoveMods = {
      speedMult: 1 + p.upgrades.speed * 0.1,
      fuelMult: 1 + p.upgrades.fuel * 0.3,
      frozen: frozen || p.dummy,
    };
    stepMovement(p, inp, this.world, this.tick, mods);
    if (!p.dummy) {
      const ax = dcos(p.aim);
      if (Math.abs(ax) > 0.05) p.facing = ax > 0 ? 1 : -1;
    }
    if (p.medium & MEDIUM_LAVA) {
      this.kill(p, -1, KILL_LAVA, false);
      return;
    }
    if (p.y > this.world.pxH + 64 || p.x < -64 || p.x > this.world.pxW + 64) {
      this.kill(p, -1, KILL_WORLD, false);
      return;
    }

    // Timers.
    if (p.protT > 0) p.protT--;
    if (p.throwCd > 0) p.throwCd--;
    if (p.meleeCd > 0) p.meleeCd--;
    if (p.meleeT > 0) p.meleeT--;
    if (p.dualT > 0) p.dualT--;
    if (p.emoteT > 0) p.emoteT--;
    if (p.recoil > 0) {
      const def = WEAPONS[p.slots[p.active].wi] ?? WEAPONS[0];
      p.recoil = Math.max(0, p.recoil - def.recoilRecover / TICK_RATE);
    }
    p.zoom = canAct && (inp.buttons & BTN_ZOOM) !== 0;

    // Regeneration and burning.
    if (this.tick - p.lastDamageTick > sec(PLAYER.regenDelay) && p.hp < p.maxHp && this.tick % 5 === 0) p.hp++;
    if (p.burnT > 0) {
      p.burnT--;
      if (p.burnT % 15 === 0) this.damage(p, Math.round(COMBAT.burnDps / 4), p.burnBy, KILL_BURN, false, 0, 0, p.x, p.y - 20);
      if (!p.alive) return;
    }

    // Signals (emotes, quick chat, upgrades) work even while frozen.
    if (changed(ACT_SIGNAL)) this.handleSignal(p, inp.signal);

    if (canAct) {
      if (changed(ACT_SWAP)) this.swapOrPickup(p);
      if (changed(ACT_RELOAD)) this.startReload(p);
      if (changed(ACT_MELEE)) this.melee(p);
      if (changed(ACT_THROW)) this.throwGrenade(p, inp.throwPower);
      this.updateWeapon(p, (inp.buttons & BTN_FIRE) !== 0);
    } else {
      p.prevFire = (inp.buttons & BTN_FIRE) !== 0;
      p.flaming = false;
    }
    this.touchPickups(p);
  }

  private handleSignal(p: Player, signal: number): void {
    if (signal >= SIGNAL_UPGRADE && signal < SIGNAL_UPGRADE + 3) {
      if (this.config.mode === 'survival' && p.pendingUpgrade) {
        const choice = upgradeChoices(this.mode.wave)[signal - SIGNAL_UPGRADE];
        p.pendingUpgrade = false;
        if (choice === 'grenades') p.grenades = [0, 1, 2];
        else if (choice === 'health') p.upgrades.hp++;
        else p.upgrades[choice]++;
        if (choice === 'health') {
          p.maxHp = PLAYER.maxHp + p.upgrades.hp * 25;
          p.hp = p.maxHp;
        }
        if (choice === 'damage') p.damageMult = 1 + p.upgrades.damage * 0.15;
        this.emit(EventType.Upgrade, [p.id, signal - SIGNAL_UPGRADE]);
      }
      return;
    }
    if (p.emoteT > sec(1.5)) return; // rate limit
    if (signal >= SIGNAL_CHAT && signal < SIGNAL_CHAT + 8) {
      p.emoteT = sec(2);
      this.emit(EventType.Chat, [p.id, signal - SIGNAL_CHAT]);
    } else if (signal >= SIGNAL_EMOTE + 1 && signal <= SIGNAL_EMOTE + 6) {
      p.emote = signal;
      p.emoteT = sec(2.5);
      this.emit(EventType.Emote, [p.id, signal]);
    }
  }

  // ---------------------------------------------------------------- weapons

  private shoulder(p: Player): { x: number; y: number } {
    const h = bodyHeight(p);
    return { x: p.x, y: p.y - h + 16 };
  }

  private updateWeapon(p: Player, fireHeld: boolean): void {
    const slot = p.slots[p.active];
    p.flaming = false;
    if (slot.wi < 0) {
      p.prevFire = fireHeld;
      return;
    }
    const def = WEAPONS[slot.wi];
    if (p.reloadT > 0) {
      p.reloadT--;
      if (p.reloadT === 0) this.finishReload(p);
    }
    if (p.fireCd > 0) p.fireCd--;
    if (p.burstLeft > 0) {
      if (--p.burstCd <= 0) {
        if (slot.mag > 0) {
          this.shootOnce(p);
          p.burstLeft--;
          p.burstCd = sec(def.burstInterval);
        } else p.burstLeft = 0;
      }
    } else if (fireHeld && p.fireCd === 0 && p.reloadT === 0 && (def.auto || !p.prevFire)) {
      if (slot.mag <= 0) {
        if (slot.reserve !== 0) this.startReload(p);
        else if (!p.prevFire) this.emit(EventType.Deny, [p.id]);
      } else {
        this.shootOnce(p);
        p.burstLeft = def.burst - 1;
        p.burstCd = sec(def.burstInterval);
        const dual = p.dualT > 0 && def.dualWieldable;
        p.fireCd = Math.max(1, Math.round(sec(def.fireInterval) * (dual ? 0.55 : 1)));
      }
    }
    if (def.kind === 'flame' && fireHeld && slot.mag > 0 && p.reloadT === 0) p.flaming = true;
    if (slot.mag <= 0 && slot.reserve !== 0 && p.reloadT === 0 && p.burstLeft === 0) this.startReload(p);
    p.prevFire = fireHeld;
  }

  private startReload(p: Player): void {
    const slot = p.slots[p.active];
    if (slot.wi < 0 || p.reloadT > 0) return;
    const def = WEAPONS[slot.wi];
    const cap = this.magCap(p, slot.wi);
    if (slot.mag >= cap || slot.reserve === 0) return;
    p.reloadT = Math.max(1, Math.round(sec(def.reloadTime) / (1 + p.upgrades.reload * 0.33)));
    p.burstLeft = 0;
    this.emit(EventType.Reload, [p.id, slot.wi]);
  }

  private magCap(p: Player, wi: number): number {
    const def = WEAPONS[wi];
    return p.dualT > 0 && def.dualWieldable ? def.magSize * 2 : def.magSize;
  }

  private finishReload(p: Player): void {
    const slot = p.slots[p.active];
    if (slot.wi < 0) return;
    const cap = this.magCap(p, slot.wi);
    const need = cap - slot.mag;
    if (slot.reserve < 0) slot.mag = cap;
    else {
      const take = Math.min(need, slot.reserve);
      slot.mag += take;
      slot.reserve -= take;
    }
  }

  private shootOnce(p: Player): void {
    const slot = p.slots[p.active];
    const def = WEAPONS[slot.wi];
    slot.mag--;
    p.shotsFired++;
    p.protT = 0;
    const sh = this.shoulder(p);
    const spreadUnits = ((def.spread + p.recoil) / (2 * Math.PI)) * ANGLE_ONE;
    p.recoil = Math.min(def.recoilMax, p.recoil + def.recoil);
    if (def.kind === 'hitscan' || def.kind === 'rail') {
      let anyHit = false;
      for (let i = 0; i < def.pellets; i++) {
        const a = p.aim + (this.rng.next() * 2 - 1) * spreadUnits;
        if (this.hitscan(p, slot.wi, a, sh.x, sh.y)) anyHit = true;
      }
      if (anyHit) p.shotsHit++;
    } else if (def.projectile) {
      const spec = def.projectile;
      const a = p.aim + (this.rng.next() * 2 - 1) * spreadUnits;
      const dx = dcos(a);
      const dy = dsin(a);
      const flame = def.kind === 'flame';
      this.projectiles.push({
        id: this.nextEntity++,
        wi: slot.wi,
        owner: p.id,
        team: p.team,
        x: q8(sh.x + dx * 18),
        y: q8(sh.y + dy * 18),
        vx: q8(dx * spec.speed + (flame ? p.vx * 0.5 : 0)),
        vy: q8(dy * spec.speed + (flame ? p.vy * 0.5 : 0)),
        life: sec(spec.life),
        bounces: spec.bounces,
        fuse: spec.fuse > 0 ? sec(spec.fuse) : -1,
        hits: [],
        flame,
      });
      if (!flame) this.emit(EventType.Shot, [p.id, slot.wi, Math.round(sh.x), Math.round(sh.y), Math.round(sh.x + dx * 30), Math.round(sh.y + dy * 30), 0]);
      // Recoil push for heavy launchers (enables rocket-jumping style movement tech).
      if (spec.explosionRadius > 0) {
        p.vx = q8(p.vx - dx * 60);
        p.vy = q8(p.vy - dy * 60);
      }
    }
  }

  /** Lag-compensated hitscan. Returns true if any player was hit. */
  private hitscan(p: Player, wi: number, angle: number, x0: number, y0: number): boolean {
    const def = WEAPONS[wi];
    const dx = dcos(angle) * def.range;
    const dy = dsin(angle) * def.range;
    const wallT = this.world.raycast(x0, y0, x0 + dx, y0 + dy, this.tick);
    const rewindTick = this.rewindTick(p);
    const hits: { p: Player; t: number; head: boolean }[] = [];
    for (const v of this.players) {
      if (v === p || !v.alive) continue;
      if (this.modeInfo.teams && v.team === p.team && !this.config.friendlyFire) continue;
      const box = this.boxAt(v, rewindTick);
      if (!box) continue;
      const t = segmentRect(x0, y0, dx, dy, box.x - HIT_PAD, box.top - HIT_PAD, PLAYER.width + HIT_PAD * 2, box.h + HIT_PAD * 2);
      if (t < 0 || t > wallT) continue;
      const hy = y0 + dy * t;
      hits.push({ p: v, t, head: hy < box.top + PLAYER.headHeight });
    }
    hits.sort((a, b) => a.t - b.t);
    let endT = wallT;
    let hitAny = false;
    const pierce = def.kind === 'rail';
    for (const h of hits) {
      const dist = h.t * def.range;
      let mult = 1;
      if (dist > def.falloffStart) {
        const f = Math.min(1, (dist - def.falloffStart) / Math.max(1, def.range - def.falloffStart));
        mult = 1 - f * (1 - def.minDamageMult);
      }
      let dmg = def.damage * mult * (h.head ? def.headMult : 1);
      dmg = Math.max(1, Math.round(dmg));
      const kx = (dx / def.range) * def.knockback;
      const ky = (dy / def.range) * def.knockback;
      if (h.head) p.headshots++;
      this.damage(h.p, dmg, p.id, wi, h.head, kx, ky, x0 + dx * h.t, y0 + dy * h.t);
      hitAny = true;
      if (!pierce) {
        endT = h.t;
        break;
      }
    }
    this.emit(EventType.Shot, [
      p.id,
      wi,
      Math.round(x0),
      Math.round(y0),
      Math.round(x0 + dx * endT),
      Math.round(y0 + dy * endT),
      hitAny ? 1 : endT < 1 ? 2 : 0,
    ]);
    return hitAny;
  }

  private rewindTick(p: Player): number {
    if (p.isBot) return this.tick;
    const v = p.input.viewTick;
    if (v <= 0 || v >= this.tick) return this.tick;
    return Math.max(this.tick - COMBAT.lagCompMaxTicks, v);
  }

  /** Player box at a past tick (lag compensation) or now. */
  private boxAt(v: Player, tick: number): { x: number; top: number; h: number } | null {
    if (tick < this.tick) {
      const h = this.history.get(v.id);
      const i = tick % HIST;
      if (h && h.tick[i] === tick) {
        if (!h.alive[i]) return null;
        return { x: h.x[i] - HW, top: h.y[i] - h.h[i], h: h.h[i] };
      }
    }
    const bh = bodyHeight(v);
    return { x: v.x - HW, top: v.y - bh, h: bh };
  }

  private melee(p: Player): void {
    if (p.meleeCd > 0) return;
    p.meleeCd = sec(COMBAT.meleeCooldown);
    p.meleeT = sec(0.25);
    p.protT = 0;
    this.emit(EventType.Melee, [p.id]);
    const sh = this.shoulder(p);
    const fx = p.facing;
    for (const v of this.players) {
      if (v === p || !v.alive) continue;
      if (this.modeInfo.teams && v.team === p.team && !this.config.friendlyFire) continue;
      const cy = v.y - bodyHeight(v) / 2;
      const dx = v.x - sh.x;
      const dy = cy - sh.y;
      if (dx * fx < -6 || Math.abs(dx) > COMBAT.meleeRange + HW || Math.abs(dy) > 34) continue;
      if (!this.world.los(sh.x, sh.y, v.x, cy, this.tick)) continue;
      this.damage(v, COMBAT.meleeDamage, p.id, KILL_MELEE, false, fx * COMBAT.meleeKnockback, -180, v.x, cy);
    }
  }

  private throwGrenade(p: Player, power: number): void {
    if (p.throwCd > 0 || p.grenades.length === 0) return;
    const kind = p.grenades.shift()!;
    p.throwCd = sec(COMBAT.throwCooldown);
    p.protT = 0;
    const sh = this.shoulder(p);
    const dx = dcos(p.aim);
    const dy = dsin(p.aim);
    const speed = COMBAT.throwMinSpeed + ((COMBAT.throwMaxSpeed - COMBAT.throwMinSpeed) * power) / 255;
    const g = GRENADES[kind];
    this.grenades.push({
      id: this.nextEntity++,
      kind,
      owner: p.id,
      team: p.team,
      x: q8(sh.x + dx * 12),
      y: q8(sh.y + dy * 12),
      vx: q8(dx * speed + p.vx * 0.3),
      vy: q8(dy * speed + p.vy * 0.3),
      fuse: sec(g.fuse),
      stuck: -1,
      stuckDx: 0,
      stuckDy: 0,
      armT: sec(g.armTime),
    });
    this.emit(EventType.Throw, [p.id, kind]);
  }

  private swapOrPickup(p: Player): void {
    // Prefer picking up a weapon we are standing on.
    const near = this.nearbyWeapon(p);
    if (near) {
      const def = WEAPONS[near.wi];
      const slotIdx = def.slot === 'sidearm' ? 0 : 1;
      const old = p.slots[slotIdx];
      if (old.wi >= 0 && old.wi !== weaponIndex(STARTING_SIDEARM)) {
        this.dropWeapon(p, old.wi, old.mag, old.reserve);
      }
      p.slots[slotIdx] = { wi: near.wi, mag: near.mag, reserve: near.reserve };
      p.active = slotIdx;
      p.reloadT = 0;
      p.burstLeft = 0;
      near.take();
      this.emit(EventType.Pickup, [p.id, 1, near.wi]);
      return;
    }
    const other = 1 - p.active;
    if (p.slots[other].wi >= 0) {
      p.active = other;
      p.reloadT = 0;
      p.burstLeft = 0;
      p.fireCd = Math.max(p.fireCd, sec(0.15));
    }
  }

  /** A weapon on the ground the player overlaps and does not already hold. */
  nearbyWeapon(p: Player): { wi: number; mag: number; reserve: number; take: () => void } | null {
    const held = (wi: number) => p.slots[0].wi === wi || p.slots[1].wi === wi;
    for (const d of this.dropped) {
      if (held(d.wi)) continue;
      if (Math.abs(d.x - p.x) < 24 && d.y > p.y - bodyHeight(p) - 8 && d.y < p.y + 12) {
        return { wi: d.wi, mag: d.mag, reserve: d.reserve, take: () => (this.dropped = this.dropped.filter((x) => x !== d)) };
      }
    }
    for (const s of this.spawners) {
      if (!s.available || (s.kind !== 'weapon' && s.kind !== 'heavy') || held(s.item)) continue;
      if (Math.abs(s.x - p.x) < 24 && s.y > p.y - bodyHeight(p) - 8 && s.y < p.y + 12) {
        const def = WEAPONS[s.item];
        return {
          wi: s.item,
          mag: def.magSize,
          reserve: def.reserve,
          take: () => {
            s.available = false;
            s.timer = sec(s.kind === 'heavy' ? 35 : 20);
          },
        };
      }
    }
    return null;
  }

  private dropWeapon(p: Player, wi: number, mag: number, reserve: number): void {
    if (wi < 0) return;
    this.dropped.push({ id: this.nextEntity++, wi, mag, reserve, x: q8(p.x), y: q8(p.y - 10), vy: -120, life: sec(COMBAT.droppedWeaponLife) });
    if (this.dropped.length > 24) this.dropped.shift();
  }

  // ---------------------------------------------------------------- damage

  damage(
    v: Player,
    amount: number,
    attackerId: number,
    code: number,
    head: boolean,
    kx: number,
    ky: number,
    hx: number,
    hy: number,
  ): void {
    if (!v.alive || this.mode.phase === 'ended' || this.mode.phase === 'countdown') return;
    const a = attackerId >= 0 ? this.getPlayer(attackerId) : undefined;
    const self = a === v;
    if (a && !self && this.modeInfo.teams && a.team === v.team && !this.config.friendlyFire) return;
    if (v.protT > 0 && !self) return;
    v.vx = q8(v.vx + kx);
    v.vy = q8(v.vy + ky);
    if (Math.abs(ky) > 50) v.onGround = false;
    if (this.config.mode === 'bomb') {
      if (a && !self && a.bomb && this.mode.passCd === 0) {
        a.bomb = false;
        v.bomb = true;
        this.mode.passCd = sec(COMBAT.bombPassCooldown);
        this.mode.bombT = Math.max(this.mode.bombT, sec(1.5));
        this.emit(EventType.Bomb, [v.id, a.id]);
      }
      if (code !== KILL_BOMB) return;
    }
    if (self) amount = Math.round(amount * COMBAT.selfDamageMult);
    else if (a) amount = Math.round(amount * a.damageMult);
    if (amount <= 0) return;
    v.hp -= amount;
    v.lastDamageTick = this.tick;
    if (a && !self) {
      a.damageDealt += amount;
      const r = v.recentAttackers.find((x) => x.id === a.id);
      if (r) r.tick = this.tick;
      else v.recentAttackers.push({ id: a.id, tick: this.tick });
    }
    this.emit(EventType.Hit, [v.id, attackerId, amount, head ? 1 : 0, Math.round(hx), Math.round(hy)]);
    if (v.hp <= 0) this.kill(v, attackerId, code, head);
  }

  kill(v: Player, killerId: number, code: number, head: boolean): void {
    if (!v.alive) return;
    v.alive = false;
    v.hp = 0;
    v.deaths++;
    v.flaming = false;
    v.burnT = 0;
    v.respawnT = sec(this.config.mode === 'training' ? 1 : PLAYER.respawnTime);
    this.dropStuff(v);
    let killer = killerId >= 0 ? this.getPlayer(killerId) : undefined;
    // Environmental deaths credit the last recent attacker.
    if (!killer || killer === v) {
      const recent = v.recentAttackers.filter((r) => r.id !== v.id && this.tick - r.tick < sec(COMBAT.assistWindow));
      if (recent.length && (code === KILL_LAVA || code === KILL_WORLD || killer === v)) {
        const last = recent.reduce((x, y) => (y.tick > x.tick ? y : x));
        killer = this.getPlayer(last.id);
      }
    }
    if (killer && killer !== v) {
      killer.kills++;
      const key = code < WEAPONS.length ? WEAPONS[code].id : code === KILL_MELEE ? 'melee' : code >= KILL_GRENADE && code < KILL_GRENADE + 10 ? GRENADES[code - KILL_GRENADE].id : 'other';
      killer.weaponKills[key] = (killer.weaponKills[key] ?? 0) + 1;
      if (!(this.modeInfo.teams && killer.team === v.team)) killer.score += 1;
      if (this.config.mode === 'tdm' && killer.team !== v.team && killer.team >= 0) this.mode.teamScores[killer.team]++;
    } else if (!v.dummy && !v.drone && this.config.mode === 'ffa') {
      v.score = Math.max(0, v.score - 1);
    }
    for (const r of v.recentAttackers) {
      if (killer && r.id === killer.id) continue;
      if (this.tick - r.tick > sec(COMBAT.assistWindow)) continue;
      const ap = this.getPlayer(r.id);
      if (ap && ap !== v) ap.assists++;
    }
    v.recentAttackers = [];
    this.emit(EventType.Kill, [v.id, killer && killer !== v ? killer.id : -1, code, head ? 1 : 0]);
    // Mode hooks.
    if (this.config.mode === 'leader' && v.leader) {
      v.leader = false;
      v.maxHp = PLAYER.maxHp;
      this.mode.leaders[v.team] = -1;
      const other = 1 - v.team;
      this.mode.teamScores[other]++;
      if (killer && killer.team === other) killer.objective++;
    }
    if (this.config.mode === 'bomb') {
      v.eliminated = true;
      if (v.bomb) {
        v.bomb = false;
        this.mode.bombT = sec(2);
      }
    }
    if (this.config.mode === 'survival') {
      if (v.drone) this.removeQueue.push({ id: v.id, at: this.tick + sec(2) });
      else v.respawnT = 1 << 30;
    }
    if (v.dummy) v.respawnT = sec(2);
  }

  private dropStuff(v: Player): void {
    const s = v.slots[1];
    if (s.wi >= 0 && !v.drone && !v.dummy) this.dropWeapon(v, s.wi, Math.max(s.mag, 0), s.reserve < 0 ? 0 : s.reserve);
    if (v.carrying >= 0) {
      const f = this.mode.flags[v.carrying];
      if (f) {
        f.state = 2;
        f.x = q8(v.x);
        f.y = q8(v.y);
        f.carrier = -1;
        f.returnT = sec(MATCH.flagReturnTime);
        this.emit(EventType.Flag, [f.team, 2, v.id]);
      }
      v.carrying = -1;
    }
  }

  explode(x: number, y: number, radius: number, dmg: number, knock: number, owner: number, code: number, kind: number): void {
    this.emit(EventType.Explode, [Math.round(x), Math.round(y), Math.round(radius), kind]);
    for (const v of this.players) {
      if (!v.alive) continue;
      const h = bodyHeight(v);
      const cx = v.x;
      const cy = v.y - h / 2;
      const nx = Math.max(v.x - HW, Math.min(x, v.x + HW));
      const ny = Math.max(v.y - h, Math.min(y, v.y));
      const d = Math.sqrt((nx - x) * (nx - x) + (ny - y) * (ny - y));
      if (d > radius) continue;
      if (!this.world.los(x, y, cx, cy, this.tick) && !this.world.los(x, y - 6, cx, v.y - h + 4, this.tick)) continue;
      const f = Math.max(0.2, 1 - d / radius);
      let dirx = cx - x;
      let diry = cy - y - 10;
      const len = Math.sqrt(dirx * dirx + diry * diry) || 1;
      dirx /= len;
      diry /= len;
      this.damage(v, Math.round(dmg * f), owner, code, false, dirx * knock * f, diry * knock * f, cx, cy);
    }
    // Chain-detonate mines in the blast.
    for (const g of this.grenades) {
      if (g.fuse > 2 && (g.x - x) * (g.x - x) + (g.y - y) * (g.y - y) < radius * radius * 0.5) g.fuse = 2;
    }
  }

  // ---------------------------------------------------------------- projectiles

  private updateProjectiles(): void {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      if (this.stepProjectile(pr)) keep.push(pr);
    }
    this.projectiles = keep;
  }

  /** Returns false when the projectile is gone. */
  private stepProjectile(pr: Projectile): boolean {
    const def = WEAPONS[pr.wi];
    const spec = def.projectile!;
    pr.life--;
    if (pr.fuse > 0) pr.fuse--;
    if (pr.life <= 0 || pr.fuse === 0) {
      if (spec.explosionRadius > 0) this.explode(pr.x, pr.y, spec.explosionRadius, spec.explosionDamage, spec.knockback, pr.owner, pr.wi, 0);
      return false;
    }
    pr.vy += spec.gravity / TICK_RATE;
    let nx = pr.x + pr.vx / TICK_RATE;
    let ny = pr.y + pr.vy / TICK_RATE;
    // Player hits along the segment.
    const segDx = nx - pr.x;
    const segDy = ny - pr.y;
    const wallT = this.world.raycast(pr.x, pr.y, nx, ny, this.tick);
    for (const v of this.players) {
      if (!v.alive || v.id === pr.owner || pr.hits.includes(v.id)) continue;
      if (this.modeInfo.teams && v.team === pr.team && !this.config.friendlyFire) continue;
      const h = bodyHeight(v);
      const r = spec.radius;
      const t = segmentRect(pr.x, pr.y, segDx, segDy, v.x - HW - r, v.y - h - r, PLAYER.width + 2 * r, h + 2 * r);
      if (t < 0 || t > wallT) continue;
      const hx = pr.x + segDx * t;
      const hy = pr.y + segDy * t;
      if (spec.directDamage > 0) {
        const len = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy) || 1;
        this.damage(v, spec.directDamage, pr.owner, pr.wi, false, (pr.vx / len) * spec.knockback * 0.3, (pr.vy / len) * spec.knockback * 0.3, hx, hy);
        if (pr.flame) {
          v.burnT = sec(COMBAT.burnTime);
          v.burnBy = pr.owner;
        }
      }
      if (spec.pierce) {
        pr.hits.push(v.id);
        continue;
      }
      if (spec.explosionRadius > 0) this.explode(hx, hy, spec.explosionRadius, spec.explosionDamage, spec.knockback, pr.owner, pr.wi, 0);
      return false;
    }
    if (wallT < 1) {
      if (pr.flame) return false;
      if (pr.bounces > 0) {
        pr.bounces--;
        // Reflect on the axis that collides.
        const hitX = this.world.solidAtPoint(nx, pr.y, this.tick);
        const hitY = this.world.solidAtPoint(pr.x, ny, this.tick);
        const damp = spec.gravity > 0 ? 0.6 : 1;
        if (hitX || (!hitX && !hitY)) pr.vx = -pr.vx * damp;
        if (hitY || (!hitX && !hitY)) pr.vy = -pr.vy * damp;
        nx = pr.x;
        ny = pr.y;
        pr.vx = q8(pr.vx);
        pr.vy = q8(pr.vy);
        this.emit(EventType.Bounce, [Math.round(pr.x), Math.round(pr.y), pr.wi]);
      } else {
        const ex = pr.x + segDx * Math.max(0, wallT - 0.05);
        const ey = pr.y + segDy * Math.max(0, wallT - 0.05);
        if (spec.explosionRadius > 0) this.explode(ex, ey, spec.explosionRadius, spec.explosionDamage, spec.knockback, pr.owner, pr.wi, 0);
        return false;
      }
    }
    pr.x = q8(nx);
    pr.y = q8(ny);
    pr.vx = q8(pr.vx);
    pr.vy = q8(pr.vy);
    return true;
  }

  // ---------------------------------------------------------------- grenades

  private updateGrenades(): void {
    const keep: Grenade[] = [];
    for (const g of this.grenades) if (this.stepGrenade(g)) keep.push(g);
    this.grenades = keep;
  }

  private stepGrenade(g: Grenade): boolean {
    const def = GRENADES[g.kind];
    g.fuse--;
    if (g.armT > 0) g.armT--;
    if (g.stuck >= 0) {
      const host = this.getPlayer(g.stuck);
      if (!host || !host.alive) g.stuck = -1;
      else {
        g.x = q8(host.x + g.stuckDx);
        g.y = q8(host.y + g.stuckDy);
      }
    } else if (g.stuck === -1) {
      g.vy += (PLAYER.gravity * this.world.gravityMult * 0.9) / TICK_RATE;
      const steps = 2;
      for (let i = 0; i < steps; i++) {
        const nx = g.x + g.vx / TICK_RATE / steps;
        if (this.world.solidAtPoint(nx, g.y, this.tick)) {
          if (def.sticky) {
            g.stuck = -2;
            g.vx = 0;
            g.vy = 0;
            break;
          }
          g.vx = -g.vx * def.bounce;
        } else g.x = nx;
        const ny = g.y + g.vy / TICK_RATE / steps;
        if (this.world.solidAtPoint(g.x, ny, this.tick)) {
          if (def.sticky) {
            g.stuck = -2;
            g.vx = 0;
            g.vy = 0;
            break;
          }
          if (Math.abs(g.vy) > 120) this.emit(EventType.Bounce, [Math.round(g.x), Math.round(g.y), -1 - g.kind]);
          g.vy = -g.vy * def.bounce;
          g.vx *= 0.8;
          if (Math.abs(g.vy) < 40) g.vy = 0;
        } else g.y = ny;
      }
      if (def.sticky && g.stuck === -1) {
        for (const v of this.players) {
          if (!v.alive || v.id === g.owner) continue;
          if (this.modeInfo.teams && v.team === g.team && !this.config.friendlyFire) continue;
          const h = bodyHeight(v);
          if (g.x > v.x - HW - 4 && g.x < v.x + HW + 4 && g.y > v.y - h - 4 && g.y < v.y + 4) {
            g.stuck = v.id;
            g.stuckDx = g.x - v.x;
            g.stuckDy = g.y - v.y;
            break;
          }
        }
      }
      g.x = q8(g.x);
      g.y = q8(g.y);
      g.vx = q8(g.vx);
      g.vy = q8(g.vy);
    }
    if (g.y > this.world.pxH + 50) return false;
    // Mines: proximity trigger once armed.
    if (def.triggerRadius > 0 && g.armT === 0) {
      for (const v of this.players) {
        if (!v.alive || v.id === g.owner) continue;
        if (this.modeInfo.teams && v.team === g.team) continue;
        const dx = v.x - g.x;
        const dy = v.y - bodyHeight(v) / 2 - g.y;
        if (dx * dx + dy * dy < def.triggerRadius * def.triggerRadius) {
          g.fuse = 0;
          break;
        }
      }
    }
    if (g.fuse <= 0) {
      if (def.cloudRadius > 0) {
        this.clouds.push({ id: this.nextEntity++, kind: g.kind, owner: g.owner, team: g.team, x: g.x, y: g.y, r: def.cloudRadius, life: sec(def.cloudTime) });
        this.emit(EventType.Explode, [Math.round(g.x), Math.round(g.y), Math.round(def.cloudRadius), 10 + g.kind]);
      } else {
        this.explode(g.x, g.y, def.radius, def.damage, def.knockback, g.owner, KILL_GRENADE + g.kind, 1 + g.kind);
      }
      return false;
    }
    return true;
  }

  private updateClouds(): void {
    for (const c of this.clouds) {
      c.life--;
      const def = GRENADES[c.kind];
      if (def.cloudDps > 0 && c.life % 15 === 0) {
        for (const v of this.players) {
          if (!v.alive) continue;
          if (this.modeInfo.teams && v.team === c.team && v.id !== c.owner && !this.config.friendlyFire) continue;
          const dx = v.x - c.x;
          const dy = v.y - 20 - c.y;
          if (dx * dx + dy * dy < c.r * c.r) this.damage(v, Math.round(def.cloudDps / 4), c.owner, KILL_GAS, false, 0, 0, v.x, v.y - 20);
        }
      }
    }
    this.clouds = this.clouds.filter((c) => c.life > 0);
  }

  /** Smoke blocks bot vision. */
  smokeBlocks(x0: number, y0: number, x1: number, y1: number): boolean {
    for (const c of this.clouds) {
      if (GRENADES[c.kind].id !== 'smoke') continue;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((c.x - x0) * dx + (c.y - y0) * dy) / len2));
      const px = x0 + dx * t - c.x;
      const py = y0 + dy * t - c.y;
      if (px * px + py * py < c.r * c.r * 0.7) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- pickups

  private rollSpawner(s: PickupSpawner): void {
    if (s.kind === 'weapon') s.item = weaponIndex(this.rng.pick(this.map.weaponPool.length ? this.map.weaponPool : ['kestrel']));
    else if (s.kind === 'heavy') s.item = weaponIndex(this.rng.pick(this.map.heavyPool.length ? this.map.heavyPool : ['comet']));
    else if (s.kind === 'grenade') s.item = this.rng.int(GRENADES.length);
    else s.item = -1;
  }

  private updatePickups(): void {
    for (const s of this.spawners) {
      if (s.available) continue;
      if ((s.kind === 'weapon' || s.kind === 'heavy') && !this.config.pickups) continue;
      if (this.config.mode === 'bomb' && (s.kind === 'heavy' || s.kind === 'grenade')) continue;
      if (--s.timer <= 0) {
        this.rollSpawner(s);
        s.available = true;
      }
    }
    for (const d of this.dropped) {
      d.life--;
      if (d.vy !== 0 || !this.world.solidAtPoint(d.x, d.y + 1, this.tick)) {
        d.vy = Math.min(600, d.vy + PLAYER.gravity / TICK_RATE);
        const ny = d.y + d.vy / TICK_RATE;
        const t = this.world.tileAtPx(d.x, ny);
        if (World.isSolidTile(t) || (t === 2 && d.vy > 0 && Math.floor(d.y / TILE) < Math.floor(ny / TILE))) {
          d.y = Math.floor(ny / TILE) * TILE;
          d.vy = 0;
        } else d.y = q8(ny);
      }
      if (d.y > this.world.pxH) d.life = 0;
    }
    this.dropped = this.dropped.filter((d) => d.life > 0);
  }

  private touchPickups(p: Player): void {
    const h = bodyHeight(p);
    for (const s of this.spawners) {
      if (!s.available) continue;
      if (Math.abs(s.x - p.x) > 22 || s.y < p.y - h - 6 || s.y > p.y + 14) continue;
      if (s.kind === 'health') {
        if (p.hp >= p.maxHp || p.drone) continue;
        p.hp = Math.min(p.maxHp, p.hp + 50);
        p.burnT = 0;
        s.available = false;
        s.timer = sec(20);
        this.emit(EventType.Pickup, [p.id, 2, 0]);
      } else if (s.kind === 'grenade') {
        if (p.grenades.length >= COMBAT.maxGrenades || p.drone) continue;
        while (p.grenades.length < COMBAT.maxGrenades) p.grenades.push(s.item);
        s.available = false;
        s.timer = sec(18);
        this.emit(EventType.Pickup, [p.id, 3, s.item]);
      } else if (s.kind === 'dual') {
        if (p.drone) continue;
        p.dualT = sec(COMBAT.dualWieldTime);
        s.available = false;
        s.timer = sec(30);
        this.emit(EventType.Pickup, [p.id, 4, 0]);
      } else {
        // Weapons: same gun = take its ammo; empty slot = take the gun. Otherwise press swap to exchange.
        if (p.drone) continue;
        const def = WEAPONS[s.item];
        const slotIdx = def.slot === 'sidearm' ? 0 : 1;
        const slot = p.slots[slotIdx];
        if (slot.wi === s.item) {
          if (slot.reserve < 0) continue;
          slot.reserve += def.magSize + Math.max(0, def.reserve);
        } else if (slot.wi < 0) {
          p.slots[slotIdx] = this.makeSlot(s.item);
          p.active = slotIdx;
        } else continue;
        s.available = false;
        s.timer = sec(s.kind === 'heavy' ? 35 : 20);
        this.emit(EventType.Pickup, [p.id, 1, s.item]);
      }
    }
    for (const d of this.dropped) {
      if (Math.abs(d.x - p.x) > 22 || d.y < p.y - h - 6 || d.y > p.y + 14 || p.drone) continue;
      const def = WEAPONS[d.wi];
      const slotIdx = def.slot === 'sidearm' ? 0 : 1;
      const slot = p.slots[slotIdx];
      if (slot.wi === d.wi && slot.reserve >= 0) {
        slot.reserve += d.mag + d.reserve;
        d.life = 0;
        this.emit(EventType.Pickup, [p.id, 1, d.wi]);
      } else if (slot.wi < 0) {
        p.slots[slotIdx] = { wi: d.wi, mag: d.mag, reserve: d.reserve };
        p.active = slotIdx;
        d.life = 0;
        this.emit(EventType.Pickup, [p.id, 1, d.wi]);
      }
    }
  }

  // ---------------------------------------------------------------- modes

  private placeZone(index: number): void {
    const hills = this.map.objects.filter((o) => o.kind === 'hill');
    if (!hills.length) return;
    const h = hills[index % hills.length];
    const z = this.mode.zone;
    z.index = index % hills.length;
    z.x = h.x - z.w / 2;
    z.y = h.y - z.h;
  }

  private updateMode(): void {
    const m = this.mode;
    if (m.passCd > 0) m.passCd--;
    switch (this.config.mode) {
      case 'ffa':
        for (const p of this.players) if (!p.dummy && p.score >= m.scoreLimit) this.endMatch();
        break;
      case 'tdm':
        if (m.teamScores[0] >= m.scoreLimit || m.teamScores[1] >= m.scoreLimit) this.endMatch();
        break;
      case 'ctf':
        this.updateFlags();
        if (m.teamScores[0] >= m.scoreLimit || m.teamScores[1] >= m.scoreLimit) this.endMatch();
        break;
      case 'leader':
        this.assignLeaders();
        if (m.teamScores[0] >= m.scoreLimit || m.teamScores[1] >= m.scoreLimit) this.endMatch();
        break;
      case 'koth':
        this.updateZone();
        if (m.teamScores[0] >= m.scoreLimit || m.teamScores[1] >= m.scoreLimit) this.endMatch();
        break;
      case 'bomb':
        this.updateBomb();
        break;
      case 'survival':
        this.updateSurvival();
        break;
      case 'training':
        this.updateTraining();
        break;
    }
  }

  private assignLeaders(): void {
    for (const team of [0, 1]) {
      const cur = this.mode.leaders[team];
      if (cur >= 0 && this.getPlayer(cur)) continue;
      const cands = this.players.filter((p) => p.team === team && p.alive && !p.dummy);
      if (!cands.length) continue;
      const pick = cands[this.rng.int(cands.length)];
      this.mode.leaders[team] = pick.id;
      pick.leader = true;
      pick.maxHp = PLAYER.leaderHp;
      pick.hp = PLAYER.leaderHp;
    }
  }

  private updateFlags(): void {
    for (const f of this.mode.flags) {
      if (f.state === 1) {
        const c = this.getPlayer(f.carrier);
        if (!c || !c.alive) {
          f.state = 2;
          f.carrier = -1;
          f.returnT = sec(MATCH.flagReturnTime);
        } else {
          f.x = c.x;
          f.y = c.y;
        }
      } else if (f.state === 2) {
        if (!this.world.solidAtPoint(f.x, f.y + 1, this.tick) && f.y < this.world.pxH - TILE) f.y = q8(f.y + 6);
        if (--f.returnT <= 0) this.returnFlag(f, -1);
      }
    }
    for (const p of this.players) {
      if (!p.alive || p.team < 0) continue;
      const cy = p.y - bodyHeight(p) / 2;
      for (const f of this.mode.flags) {
        const near = Math.abs(f.x - p.x) < 28 && Math.abs(f.y - 20 - cy) < 36;
        if (!near) continue;
        if (f.team !== p.team && f.state !== 1 && p.carrying < 0) {
          f.state = 1;
          f.carrier = p.id;
          p.carrying = f.team;
          this.emit(EventType.Flag, [f.team, 1, p.id]);
        } else if (f.team === p.team && f.state === 2) {
          this.returnFlag(f, p.id);
          p.objective++;
        } else if (f.team === p.team && f.state === 0 && p.carrying >= 0) {
          const enemy = this.mode.flags[p.carrying];
          this.mode.teamScores[p.team]++;
          p.objective += 3;
          p.score += 3;
          p.carrying = -1;
          this.returnFlag(enemy, -2);
          this.emit(EventType.Flag, [enemy.team, 4, p.id]);
        }
      }
    }
  }

  private returnFlag(f: Flag, by: number): void {
    f.state = 0;
    f.x = f.homeX;
    f.y = f.homeY;
    f.carrier = -1;
    if (by !== -2) this.emit(EventType.Flag, [f.team, 3, by]);
  }

  private updateZone(): void {
    const z = this.mode.zone;
    if (--z.t <= 0) {
      const hills = this.map.objects.filter((o) => o.kind === 'hill').length;
      this.placeZone((z.index + 1) % Math.max(1, hills));
      z.t = sec(MATCH.kothZoneDuration);
      z.progress = 0;
      this.emit(EventType.Zone, [z.index]);
    }
    const count = [0, 0];
    for (const p of this.players) {
      if (!p.alive || p.team < 0) continue;
      if (p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y - bodyHeight(p) < z.y + z.h) count[p.team]++;
    }
    const owner = count[0] > 0 && count[1] === 0 ? 0 : count[1] > 0 && count[0] === 0 ? 1 : count[0] + count[1] > 0 ? 2 : -1;
    z.owner = owner;
    if (owner === 0 || owner === 1) {
      if (++z.progress >= TICK_RATE) {
        z.progress = 0;
        this.mode.teamScores[owner]++;
        for (const p of this.players) {
          if (p.alive && p.team === owner && p.x > z.x && p.x < z.x + z.w && p.y > z.y && p.y - bodyHeight(p) < z.y + z.h) p.objective++;
        }
      }
    }
  }

  private updateBomb(): void {
    const m = this.mode;
    const alive = this.players.filter((p) => !p.eliminated && p.alive && !p.dummy);
    const contenders = this.players.filter((p) => !p.eliminated && !p.dummy);
    if (contenders.length <= 1) {
      if (this.players.length >= 2 || contenders.length === 1) {
        m.winner = contenders[0]?.id ?? -1;
        if (contenders[0]) contenders[0].score += 3;
        this.endMatch(true);
      }
      return;
    }
    const holder = alive.find((p) => p.bomb);
    if (--m.bombT > 0) return;
    if (holder) {
      this.explode(holder.x, holder.y - 20, 90, 0, 600, holder.id, KILL_BOMB, 9);
      this.kill(holder, -1, KILL_BOMB, false);
      for (const p of alive) if (p !== holder) p.score += 1;
      m.bombT = sec(2);
    } else if (alive.length) {
      const pick = alive[this.rng.int(alive.length)];
      pick.bomb = true;
      m.bombT = sec(MATCH.bombFuse);
      this.emit(EventType.Bomb, [pick.id, -1]);
    }
  }

  private updateSurvival(): void {
    const m = this.mode;
    const humans = this.players.filter((p) => !p.drone && !p.dummy);
    if (m.phase === 'intermission') {
      if (--m.phaseT <= 0) {
        m.phase = 'playing';
        m.wave++;
        m.waveSpawned = 0;
        m.waveTotal = waveSpec(m.wave, humans.length).count;
        for (const h of humans) h.pendingUpgrade = false;
        this.emit(EventType.Wave, [m.wave, m.waveTotal]);
      }
      return;
    }
    const spec = waveSpec(m.wave, humans.length);
    const drones = this.players.filter((p) => p.drone);
    const aliveDrones = drones.filter((p) => p.alive).length;
    if (m.waveSpawned < m.waveTotal && aliveDrones < spec.maxAlive && this.tick % 30 === 0) {
      const d = this.addPlayer({ name: `Drone ${m.waveSpawned + 1}`, team: 1, isBot: true, drone: true, difficulty: spec.difficulty });
      if (!d.alive) this.spawnPlayer(d);
      m.waveSpawned++;
    }
    const humansAlive = humans.filter((p) => p.alive).length;
    if (humans.length > 0 && humansAlive === 0) {
      m.winnerTeam = 1;
      this.endMatch(true);
      return;
    }
    if (m.waveSpawned >= m.waveTotal && aliveDrones === 0 && this.removeQueue.length === 0 && !drones.some((d) => d.alive)) {
      m.phase = 'intermission';
      m.phaseT = sec(MATCH.survivalIntermission);
      m.teamScores[0] = m.wave;
      for (const h of humans) {
        h.pendingUpgrade = true;
        h.score += 5;
        if (!h.alive) {
          h.respawnT = 0;
          this.spawnPlayer(h);
        } else h.hp = h.maxHp;
      }
      this.emit(EventType.Wave, [m.wave, 0]);
    }
  }

  private spawnTrainingDummies(): void {
    const targets = this.map.objects.filter((o) => o.kind === 'target');
    for (let i = 0; i < targets.length; i++) {
      const d = this.addPlayer({ name: `Dummy ${i + 1}`, isBot: true, dummy: true });
      d.checkpoint = i;
      d.slots = [
        { wi: -1, mag: 0, reserve: 0 },
        { wi: -1, mag: 0, reserve: 0 },
      ];
      this.spawnPlayer(d);
      d.slots = [
        { wi: -1, mag: 0, reserve: 0 },
        { wi: -1, mag: 0, reserve: 0 },
      ];
      d.grenades = [];
    }
  }

  private updateTraining(): void {
    const cps = this.map.objects.filter((o) => o.kind === 'checkpoint').sort((a, b) => a.index - b.index);
    if (!cps.length) return;
    for (const p of this.players) {
      if (!p.alive || p.dummy) continue;
      const cp = cps[p.checkpoint];
      if (!cp) continue;
      if (Math.abs(cp.x - p.x) < 32 && Math.abs(cp.y - 24 - (p.y - 22)) < 48) {
        if (p.checkpoint === 0) p.courseStart = this.tick;
        this.emit(EventType.Checkpoint, [p.id, p.checkpoint]);
        p.checkpoint++;
        if (p.checkpoint >= cps.length) {
          const t = this.tick - p.courseStart;
          if (!p.bestCourse || t < p.bestCourse) p.bestCourse = t;
          this.emit(EventType.Course, [p.id, t]);
          p.checkpoint = 0;
        }
      }
    }
    for (const p of this.players) {
      if (p.dummy && p.alive) p.slots[1].wi = -1;
    }
  }

  private endByTime(): void {
    const m = this.mode;
    if (this.modeInfo.teams) {
      m.winnerTeam = m.teamScores[0] > m.teamScores[1] ? 0 : m.teamScores[1] > m.teamScores[0] ? 1 : -1;
    }
    this.endMatch();
  }

  endMatch(_force = false): void {
    const m = this.mode;
    if (m.phase === 'ended') return;
    m.phase = 'ended';
    m.phaseT = sec(MATCH.endDelay);
    if (this.modeInfo.teams && this.config.mode !== 'survival' && m.winnerTeam < 0) {
      m.winnerTeam = m.teamScores[0] > m.teamScores[1] ? 0 : m.teamScores[1] > m.teamScores[0] ? 1 : -1;
    }
    if (!this.modeInfo.teams && m.winner < 0) {
      const ranked = this.players.filter((p) => !p.dummy).sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
      if (ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score)) m.winner = ranked[0].id;
    }
    for (const p of this.players) {
      p.flaming = false;
      p.burstLeft = 0;
    }
  }

  isOver(): boolean {
    return this.mode.phase === 'ended' && this.mode.phaseT <= 0;
  }

  results(): MatchResults {
    const players = this.players
      .filter((p) => !p.dummy && !p.drone)
      .map((p): PlayerResult => {
        let fav = '';
        let favN = 0;
        for (const [k, n] of Object.entries(p.weaponKills))
          if (n > favN) {
            fav = k;
            favN = n;
          }
        return {
          id: p.id,
          name: p.name,
          team: p.team,
          isBot: p.isBot,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          score: p.score,
          objective: p.objective,
          damage: p.damageDealt,
          accuracy: p.shotsFired ? p.shotsHit / p.shotsFired : 0,
          headshots: p.headshots,
          favouriteWeapon: fav,
          weaponKills: { ...p.weaponKills },
          bestCourse: p.bestCourse,
        };
      })
      .sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
    const mvpScore = (r: PlayerResult) => r.score * 3 + r.kills * 2 + r.assists + r.objective * 2 + r.damage / 100 - r.deaths;
    let mvp = -1;
    let best = -Infinity;
    for (const r of players) {
      const s = mvpScore(r);
      if (s > best) {
        best = s;
        mvp = r.id;
      }
    }
    return {
      mode: this.config.mode,
      mapId: this.config.mapId,
      winner: this.mode.winner,
      winnerTeam: this.mode.winnerTeam,
      teamScores: [this.mode.teamScores[0], this.mode.teamScores[1]],
      mvp,
      wave: this.mode.wave,
      durationTicks: this.tick,
      players,
    };
  }

  // ---------------------------------------------------------------- hashing

  hash(): number {
    const h = new Hasher();
    h.int(this.tick);
    h.int(this.rng.state);
    for (const p of this.players) {
      h.int(p.id);
      h.num(p.x);
      h.num(p.y);
      h.num(p.vx);
      h.num(p.vy);
      h.num(p.fuel);
      h.int(p.hp);
      h.int(p.alive ? 1 : 0);
      h.int(p.slots[0].mag);
      h.int(p.slots[1].wi);
      h.int(p.slots[1].mag);
      h.int(p.kills);
      h.int(p.aim);
    }
    for (const pr of this.projectiles) {
      h.int(pr.id);
      h.num(pr.x);
      h.num(pr.y);
    }
    for (const g of this.grenades) {
      h.int(g.id);
      h.num(g.x);
      h.num(g.y);
    }
    h.int(this.mode.teamScores[0]);
    h.int(this.mode.teamScores[1]);
    h.int(this.mode.timeLeft);
    return h.value;
  }

  /** Angle from a player's shoulder to a point (used by bots and aim assist). */
  aimAt(p: Player, x: number, y: number): number {
    const s = this.shoulder(p);
    return datan2(y - s.y, x - s.x);
  }

  shoulderOf(p: Player): { x: number; y: number } {
    return this.shoulder(p);
  }
}
