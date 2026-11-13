import { COSMETICS, DEFAULT_LOADOUT, MATCH, TICK_RATE, modeDef, type Loadout } from '@game/content';
import { hasMap } from '@game/maps';
import { BotDirector } from '@game/bots';
import { Sim, EventType, defaultConfig, sanitizeInput, type Input, type MatchConfig, type MatchResults, type SimEvent } from '@game/sim';
import { ByteReader, DecodeError } from './codec';
import { botName, sanitizeName } from './names';
import {
  Msg,
  PROTOCOL_VERSION,
  decodeInputs,
  decodeJson,
  encodeJson,
  encodePong,
  makeToken,
  type EndMsg,
  type HelloMsg,
  type LobbyAction,
  type LobbyPlayer,
  type LobbySettings,
  type LobbyStateMsg,
  type Platform,
  type RejectMsg,
  type RosterMsg,
  type StartMsg,
  type SyncReqMsg,
  type WelcomeMsg,
} from './protocol';
import { PF_COUNT, encodeSnapshot, playerFields } from './snapshot';
import { realClock, type Clock, type PeerLink } from './transport';

export interface HostOptions {
  kind: 'local' | 'online' | 'lan';
  code: string;
  quickMatch?: boolean;
  settings?: Partial<LobbySettings>;
  /** Ticks between snapshots: 1 local, 2 LAN, 3 online. */
  snapshotInterval?: number;
  clock?: Clock;
  seed?: number;
  /** Start as soon as the first player joins (offline). */
  autoStart?: boolean;
  /** Quick match: seconds before bots fill the room. */
  fillDelay?: number;
  /** Keep disconnected players' slots this long (seconds). */
  reconnectGrace?: number;
  rand?: () => number;
  log?: (msg: string) => void;
  onMatchEnd?: (results: MatchResults) => void;
  onEmpty?: () => void;
  /** Record the per-tick inputs applied (for determinism tests). */
  recordInputs?: boolean;
}

interface PeerState {
  id: string;
  link: PeerLink;
  playerId: number;
  rtt: number;
  queue: Input[];
  lastQueued: number;
  lastInput: Input | null;
  ackSnapshot: number;
  sent: Map<number, Map<number, Int32Array>>;
  sentOrder: number[];
  msgCount: number;
  msgWindowStart: number;
  strikes: number;
  bytesOut: number;
  bytesIn: number;
}

interface Slot extends LobbyPlayer {
  token: string;
  peerId: string | null;
  disconnectedAt: number;
  loadout: Loadout;
}

const DEFAULT_SETTINGS: LobbySettings = {
  mapId: 'training-grounds',
  mode: 'ffa',
  timeLimit: MATCH.defaultTimeLimit,
  scoreLimit: 0,
  botCount: 0,
  botDifficulty: 1,
  friendlyFire: false,
  lowGravity: false,
  pickups: true,
  maxPlayers: MATCH.maxPlayersPrivate,
};

const IMPORTANT = new Set<number>([
  EventType.Kill,
  EventType.Flag,
  EventType.Bomb,
  EventType.Wave,
  EventType.Chat,
  EventType.Zone,
  EventType.Course,
  EventType.Upgrade,
  EventType.Checkpoint,
  EventType.Pickup,
]);

export type HostPhase = 'lobby' | 'starting' | 'playing' | 'results';

export interface InputLogEntry {
  tick: number;
  inputs: [number, Input][];
}

export class MatchHost {
  readonly opts: HostOptions;
  readonly code: string;
  readonly clock: Clock;
  phase: HostPhase = 'lobby';
  settings: LobbySettings;
  sim: Sim | null = null;
  bots: BotDirector | null = null;
  matchId = 0;
  results: MatchResults | null = null;
  inputLog: InputLogEntry[] = [];
  hashes: number[] = [];
  /** Players present when the match started (for deterministic replays). */
  startRoster: { id: number; name: string; team: number; isBot: boolean; difficulty: number; loadout: Loadout }[] = [];
  private peers = new Map<string, PeerState>();
  private slots: Slot[] = [];
  private nextPlayerId = 1;
  private hostId = -1;
  private lastTime = -1;
  private acc = 0;
  private startAt = 0;
  private resultsAt = 0;
  private firstJoinAt = -1;
  private lobbyDirty = true;
  private lastLobbySend = 0;
  private rosterVersion = 1;
  private recentEvents: { snap: number; e: SimEvent }[] = [];
  private pendingEvents: SimEvent[] = [];
  private snapCount = 0;
  private banned = new Set<string>();
  private rand: () => number;
  private seedBase: number;
  private closed = false;
  readonly snapshotInterval: number;
  /** Tick timing statistics (ms). */
  tickStats = { count: 0, total: 0, max: 0, overruns: 0 };

  constructor(opts: HostOptions) {
    this.opts = opts;
    this.code = opts.code;
    this.clock = opts.clock ?? realClock;
    this.rand = opts.rand ?? Math.random;
    this.seedBase = opts.seed ?? Math.floor(this.rand() * 2 ** 31);
    this.snapshotInterval = opts.snapshotInterval ?? (opts.kind === 'local' ? 1 : opts.kind === 'lan' ? 2 : 3);
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    if (opts.quickMatch) this.settings.maxPlayers = Math.min(this.settings.maxPlayers, MATCH.maxPlayersPublic);
    this.settings = this.validSettings(this.settings);
  }

  get playerCount(): number {
    return this.slots.filter((s) => !s.isBot && s.connected).length;
  }

  get humanSlots(): number {
    return this.slots.filter((s) => !s.isBot).length;
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  private validSettings(s: LobbySettings): LobbySettings {
    const out = { ...s };
    if (!hasMap(out.mapId)) out.mapId = DEFAULT_SETTINGS.mapId;
    try {
      modeDef(out.mode);
    } catch {
      out.mode = 'ffa';
    }
    out.timeLimit = Math.max(60, Math.min(1200, Math.round(out.timeLimit) || 300));
    out.scoreLimit = Math.max(0, Math.min(500, Math.round(out.scoreLimit) || 0));
    out.botCount = Math.max(0, Math.min(11, Math.round(out.botCount) || 0));
    out.botDifficulty = ([0, 1, 2] as const)[Math.max(0, Math.min(2, Math.round(out.botDifficulty) || 0))];
    out.maxPlayers = Math.max(2, Math.min(MATCH.maxPlayersPrivate, Math.round(out.maxPlayers) || 12));
    out.friendlyFire = !!out.friendlyFire;
    out.lowGravity = !!out.lowGravity;
    out.pickups = out.pickups !== false;
    return out;
  }

  // ------------------------------------------------------------------ connections

  connect(peerId: string, link: PeerLink): void {
    if (this.closed) {
      link.close('closed');
      return;
    }
    this.peers.set(peerId, {
      id: peerId,
      link,
      playerId: -1,
      rtt: 0,
      queue: [],
      lastQueued: 0,
      lastInput: null,
      ackSnapshot: 0,
      sent: new Map(),
      sentOrder: [],
      msgCount: 0,
      msgWindowStart: this.clock.now(),
      strikes: 0,
      bytesOut: 0,
      bytesIn: 0,
    });
  }

  disconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);
    const slot = this.slots.find((s) => s.peerId === peerId);
    if (!slot) return;
    slot.peerId = null;
    slot.connected = false;
    slot.disconnectedAt = this.clock.now();
    this.lobbyDirty = true;
    this.log(`player ${slot.id} disconnected`);
    if (this.phase === 'lobby' || this.phase === 'results') this.removeSlot(slot);
    if (slot.id === this.hostId) this.pickHost();
    if (this.playerCount === 0) this.opts.onEmpty?.();
  }

  private removeSlot(slot: Slot): void {
    this.slots = this.slots.filter((s) => s !== slot);
    if (this.sim) this.sim.removePlayer(slot.id);
    this.rosterVersion++;
    this.lobbyDirty = true;
  }

  private pickHost(): void {
    const h = this.slots.find((s) => !s.isBot && s.connected);
    this.hostId = h ? h.id : -1;
    this.lobbyDirty = true;
  }

  private send(peer: PeerState, data: Uint8Array): void {
    peer.bytesOut += data.length;
    peer.link.send(data);
  }

  private reject(peer: PeerState, reason: RejectMsg['reason']): void {
    this.send(peer, encodeJson(Msg.Reject, { reason, serverVersion: PROTOCOL_VERSION } satisfies RejectMsg));
    peer.link.close(reason);
    this.peers.delete(peer.id);
  }

  private strike(peer: PeerState, n: number, why: string): void {
    peer.strikes += n;
    if (peer.strikes >= 100) {
      this.log(`kicking ${peer.id}: ${why}`);
      const slot = this.slots.find((s) => s.peerId === peer.id);
      this.reject(peer, 'kicked');
      if (slot) this.disconnect(peer.id);
    }
  }

  receive(peerId: string, data: Uint8Array): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    peer.bytesIn += data.length;
    const now = this.clock.now();
    if (now - peer.msgWindowStart > 1000) {
      peer.msgWindowStart = now;
      peer.msgCount = 0;
    }
    if (++peer.msgCount > 240) {
      this.strike(peer, 1, 'rate limit');
      return;
    }
    if (data.length === 0 || data.length > 16 * 1024) {
      this.strike(peer, 10, 'bad size');
      return;
    }
    try {
      const r = new ByteReader(data);
      const type = r.u8();
      switch (type) {
        case Msg.Hello:
          this.onHello(peer, decodeJson<HelloMsg>(r));
          break;
        case Msg.Inputs:
          this.onInputs(peer, r);
          break;
        case Msg.Lobby:
          this.onLobby(peer, decodeJson<LobbyAction>(r));
          break;
        case Msg.Ping: {
          const t = r.f64();
          peer.rtt = Math.min(5000, r.uv());
          this.send(peer, encodePong(t, this.sim?.tick ?? 0));
          break;
        }
        case Msg.SyncReq:
          this.onSync(peer, decodeJson<SyncReqMsg>(r));
          break;
        case Msg.Leave:
          peer.link.close('left');
          this.disconnect(peerId);
          break;
        default:
          this.strike(peer, 10, `unknown message ${type}`);
      }
    } catch (e) {
      if (e instanceof DecodeError || e instanceof SyntaxError || e instanceof TypeError || e instanceof RangeError) this.strike(peer, 10, String(e));
      else throw e;
    }
  }

  private onHello(peer: PeerState, h: HelloMsg): void {
    if (!h || typeof h !== 'object') throw new DecodeError('bad hello');
    if (h.v !== PROTOCOL_VERSION) return this.reject(peer, 'version');
    if (peer.playerId >= 0) {
      // Duplicate hello over an unreliable transport: re-send welcome.
      this.sendWelcome(peer);
      return;
    }
    const token = typeof h.token === 'string' ? h.token.slice(0, 64) : '';
    if (token && this.banned.has(token)) return this.reject(peer, 'kicked');
    let slot = token ? this.slots.find((s) => s.token === token && !s.isBot) : undefined;
    if (slot && slot.peerId && this.peers.has(slot.peerId) && slot.peerId !== peer.id) {
      // Same token connected twice: replace the stale connection.
      const old = this.peers.get(slot.peerId)!;
      old.link.close('replaced');
      this.peers.delete(old.id);
    }
    if (!slot) {
      const humans = this.slots.filter((s) => !s.isBot).length;
      if (humans >= this.settings.maxPlayers) {
        // Quick match: a human can take a bot's place.
        const bot = this.opts.quickMatch ? this.slots.find((s) => s.isBot) : undefined;
        if (!bot) return this.reject(peer, 'full');
        this.removeSlot(bot);
      }
      if (this.phase === 'playing' && this.sim && this.sim.config.mode === 'bomb' && this.opts.quickMatch) {
        // joiners sit out until next round; still allowed
      }
      const look = this.validLook(h.look);
      slot = {
        id: this.nextPlayerId++,
        name: sanitizeName(h.name, this.rand),
        team: -1,
        ready: false,
        isBot: false,
        ping: 0,
        look: [look.head, look.outfit, look.jetpack, look.skin, look.emote, look.pose],
        platform: (['web', 'android', 'ios'] as Platform[]).includes(h.platform) ? h.platform : 'web',
        connected: true,
        token: makeToken(this.rand),
        peerId: peer.id,
        disconnectedAt: 0,
        loadout: look,
      };
      this.slots.push(slot);
      this.rosterVersion++;
      if (this.firstJoinAt < 0) this.firstJoinAt = this.clock.now();
      if (this.phase === 'playing' && this.sim) {
        // In quick match, a joiner replaces a bot in the running match.
        if (this.opts.quickMatch) {
          const bot = this.sim.players.find((p) => p.isBot && !p.dummy && !p.drone);
          if (bot) {
            this.sim.removePlayer(bot.id);
            this.slots = this.slots.filter((s) => s.id !== bot.id);
          }
        }
        this.sim.addPlayer({ id: slot.id, name: slot.name, loadout: slot.loadout });
        const sp = this.sim.getPlayer(slot.id);
        if (sp) slot.team = sp.team;
      }
      this.log(`player ${slot.id} (${slot.name}) joined via ${peer.id}`);
    } else {
      slot.connected = true;
      slot.disconnectedAt = 0;
      this.log(`player ${slot.id} reconnected`);
      const sp = this.sim?.getPlayer(slot.id);
      if (sp && sp.isBot && this.opts.quickMatch) sp.isBot = false;
    }
    slot.peerId = peer.id;
    peer.playerId = slot.id;
    if (this.hostId < 0) this.hostId = slot.id;
    this.lobbyDirty = true;
    this.sendWelcome(peer);
    if (this.phase === 'playing' || this.phase === 'starting') this.sendStart(peer);
    if (this.phase === 'results' && this.results) this.send(peer, encodeJson(Msg.End, { matchId: this.matchId, results: this.results } satisfies EndMsg));
    if (this.opts.autoStart && this.phase === 'lobby') this.startMatch();
  }

  private validLook(look: unknown): Loadout {
    const out: Loadout = { ...DEFAULT_LOADOUT };
    if (!Array.isArray(look)) return out;
    const keys: (keyof Loadout)[] = ['head', 'outfit', 'jetpack', 'skin', 'emote', 'pose'];
    keys.forEach((k, i) => {
      const id = look[i];
      const c = COSMETICS.find((x) => x.id === id);
      if (c && c.category === (k === 'skin' ? 'skin' : k)) out[k] = c.id;
    });
    return out;
  }

  private sendWelcome(peer: PeerState): void {
    const slot = this.slots.find((s) => s.id === peer.playerId);
    if (!slot) return;
    this.send(
      peer,
      encodeJson(Msg.Welcome, {
        playerId: slot.id,
        token: slot.token,
        protocol: PROTOCOL_VERSION,
        hostKind: this.opts.kind,
        snapshotRate: TICK_RATE / this.snapshotInterval,
      } satisfies WelcomeMsg),
    );
    this.sendLobby(peer);
  }

  private onInputs(peer: PeerState, r: ByteReader): void {
    const { ack, inputs } = decodeInputs(r);
    if (peer.playerId < 0) return;
    if (ack > 0 && (!this.sim || ack <= this.sim.tick)) peer.ackSnapshot = Math.max(peer.ackSnapshot, ack);
    for (const raw of inputs) {
      if (raw.seq <= peer.lastQueued) continue;
      if (raw.seq > peer.lastQueued + 600 && peer.lastQueued > 0) {
        this.strike(peer, 5, 'seq jump');
        continue;
      }
      peer.queue.push(sanitizeInput(raw));
      peer.lastQueued = raw.seq;
    }
    // Keep latency low: never buffer more than 6 inputs.
    while (peer.queue.length > 6) peer.queue.shift();
  }

  private onLobby(peer: PeerState, a: LobbyAction): void {
    const slot = this.slots.find((s) => s.id === peer.playerId);
    if (!slot || !a || typeof a !== 'object') return;
    const isHost = slot.id === this.hostId && !this.opts.quickMatch;
    switch (a.a) {
      case 'ready':
        slot.ready = !!a.ready;
        break;
      case 'team':
        if (this.phase === 'lobby' && (a.team === 0 || a.team === 1 || a.team === -1)) slot.team = a.team;
        break;
      case 'look':
        if (this.phase === 'lobby') {
          slot.loadout = this.validLook(a.look);
          const l = slot.loadout;
          slot.look = [l.head, l.outfit, l.jetpack, l.skin, l.emote, l.pose];
          this.rosterVersion++;
        }
        break;
      case 'settings':
        if (isHost && this.phase === 'lobby' && a.settings && typeof a.settings === 'object') {
          this.settings = this.validSettings({ ...this.settings, ...a.settings });
        }
        break;
      case 'start':
        if (isHost && this.phase === 'lobby') this.beginStarting();
        break;
      case 'rematch':
        if (isHost && this.phase === 'results') this.backToLobby();
        break;
      case 'kick':
        if (isHost && a.id !== slot.id) {
          const target = this.slots.find((s) => s.id === a.id);
          if (target) {
            this.banned.add(target.token);
            const tp = target.peerId ? this.peers.get(target.peerId) : undefined;
            if (tp) {
              this.send(tp, encodeJson(Msg.Kick, {}));
              tp.link.close('kicked');
              this.peers.delete(tp.id);
            }
            this.removeSlot(target);
          }
        }
        break;
    }
    this.lobbyDirty = true;
  }

  private onSync(peer: PeerState, req: SyncReqMsg): void {
    if (!req) return;
    if (req.what === 'roster') this.send(peer, this.rosterMsg());
    else if (req.what === 'start' && (this.phase === 'playing' || this.phase === 'starting')) this.sendStart(peer);
    else if (req.what === 'results' && this.results) this.send(peer, encodeJson(Msg.End, { matchId: this.matchId, results: this.results } satisfies EndMsg));
    else if (req.what === 'lobby') this.sendLobby(peer);
  }

  // ------------------------------------------------------------------ lobby / match lifecycle

  private lobbyState(): LobbyStateMsg {
    const now = this.clock.now();
    const fillIn =
      this.opts.quickMatch && this.phase === 'lobby' && this.firstJoinAt >= 0
        ? Math.max(0, Math.ceil(((this.opts.fillDelay ?? 20) * 1000 - (now - this.firstJoinAt)) / 1000))
        : 0;
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      countdown: this.phase === 'starting' ? Math.max(0, Math.ceil((this.startAt - now) / 1000)) : 0,
      settings: this.settings,
      quickMatch: !!this.opts.quickMatch,
      fillIn,
      players: this.slots.map((s) => {
        const peer = s.peerId ? this.peers.get(s.peerId) : undefined;
        return {
          id: s.id,
          name: s.name,
          team: s.team,
          ready: s.ready,
          isBot: s.isBot,
          ping: peer ? peer.rtt : 0,
          look: s.look,
          platform: s.platform,
          connected: s.connected,
        };
      }),
    };
  }

  private sendLobby(peer?: PeerState): void {
    const data = encodeJson(Msg.LobbyState, this.lobbyState());
    if (peer) this.send(peer, data);
    else for (const p of this.peers.values()) if (p.playerId >= 0) this.send(p, data);
  }

  private rosterMsg(): Uint8Array {
    const players = this.sim
      ? this.sim.players.map((p) => {
          const slot = this.slots.find((s) => s.id === p.id);
          return {
            id: p.id,
            name: p.name,
            look: slot ? slot.look : [],
            isBot: p.isBot,
            platform: slot ? slot.platform : ('bot' as Platform),
          };
        })
      : [];
    return encodeJson(Msg.Roster, { version: this.rosterVersion, players } satisfies RosterMsg);
  }

  private sendStart(peer: PeerState): void {
    if (!this.sim) return;
    this.send(
      peer,
      encodeJson(Msg.Start, {
        matchId: this.matchId,
        config: this.sim.config,
        playerId: peer.playerId,
        tick: this.sim.tick,
        snapshotRate: TICK_RATE / this.snapshotInterval,
      } satisfies StartMsg),
    );
    this.send(peer, this.rosterMsg());
  }

  private beginStarting(): void {
    this.phase = 'starting';
    this.startAt = this.clock.now() + (this.opts.quickMatch ? 3000 : 1500);
    this.lobbyDirty = true;
  }

  /** Create the simulation and put everyone in. */
  startMatch(): void {
    if (this.closed) return;
    const s = this.settings;
    this.matchId++;
    const config: MatchConfig = defaultConfig({
      mapId: s.mapId,
      mode: s.mode,
      seed: (this.seedBase + this.matchId * 7919) >>> 0,
      timeLimit: s.timeLimit,
      scoreLimit: s.scoreLimit,
      friendlyFire: s.friendlyFire,
      lowGravity: s.lowGravity,
      pickups: s.pickups,
      botDifficulty: s.botDifficulty,
      botCount: s.botCount,
      maxPlayers: s.maxPlayers,
    });
    const sim = new Sim(config);
    this.sim = sim;
    this.bots = new BotDirector(config.seed);
    this.results = null;
    this.inputLog = [];
    this.hashes = [];
    this.recentEvents = [];
    this.pendingEvents = [];
    // Remove leftover bot slots from a previous match.
    this.slots = this.slots.filter((x) => !x.isBot);
    const humans = this.slots.filter((x) => x.connected);
    for (const slot of humans) {
      sim.addPlayer({ id: slot.id, name: slot.name, team: modeDef(s.mode).teams ? slot.team : undefined, loadout: slot.loadout });
      slot.team = sim.getPlayer(slot.id)!.team;
      slot.ready = false;
    }
    let bots = s.botCount;
    if (this.opts.quickMatch) bots = Math.max(0, s.maxPlayers - humans.length);
    if (s.mode === 'survival') bots = 0;
    if (s.mode === 'training') bots = 0;
    for (let i = 0; i < bots; i++) {
      const id = this.nextPlayerId++;
      const name = botName(i + Math.floor(this.rand() * 8));
      const look = this.randomLook();
      sim.addPlayer({ id, name, isBot: true, difficulty: s.botDifficulty, loadout: look });
      this.slots.push({
        id,
        name,
        team: sim.getPlayer(id)!.team,
        ready: true,
        isBot: true,
        ping: 0,
        look: [look.head, look.outfit, look.jetpack, look.skin, look.emote, look.pose],
        platform: 'bot',
        connected: true,
        token: '',
        peerId: null,
        disconnectedAt: 0,
        loadout: look,
      });
    }
    for (const peer of this.peers.values()) {
      peer.queue = [];
      peer.lastInput = null;
      peer.ackSnapshot = 0;
      peer.sent.clear();
      peer.sentOrder = [];
    }
    this.startRoster = sim.players
      .filter((p) => !p.dummy)
      .map((p) => {
        const slot = this.slots.find((x) => x.id === p.id);
        return { id: p.id, name: p.name, team: p.team, isBot: p.isBot, difficulty: p.difficulty, loadout: slot ? slot.loadout : { ...DEFAULT_LOADOUT } };
      });
    this.rosterVersion++;
    this.phase = 'playing';
    this.lobbyDirty = true;
    this.log(`match ${this.matchId} started: ${s.mode} on ${s.mapId} with ${humans.length} humans + ${bots} bots`);
    for (const peer of this.peers.values()) if (peer.playerId >= 0) this.sendStart(peer);
  }

  private randomLook(): Loadout {
    const pick = (cat: string) => {
      const list = COSMETICS.filter((c) => c.category === cat);
      return list[Math.floor(this.rand() * list.length)].id;
    };
    return { head: pick('head'), outfit: pick('outfit'), jetpack: pick('jetpack'), skin: pick('skin'), emote: pick('emote'), pose: pick('pose') };
  }

  private backToLobby(): void {
    this.phase = 'lobby';
    this.sim = null;
    this.bots = null;
    this.slots = this.slots.filter((s) => !s.isBot && s.connected);
    this.lobbyDirty = true;
  }

  // ------------------------------------------------------------------ ticking

  /** Advance the host to the current time. Call frequently (every frame or every few ms). */
  update(now = this.clock.now()): void {
    if (this.closed) return;
    if (this.lastTime < 0) this.lastTime = now;
    const dt = Math.min(250, now - this.lastTime);
    this.lastTime = now;
    if (this.phase === 'lobby') {
      if (this.opts.quickMatch && this.firstJoinAt >= 0) {
        const humans = this.playerCount;
        const waited = now - this.firstJoinAt > (this.opts.fillDelay ?? 20) * 1000;
        if (humans > 0 && (humans >= this.settings.maxPlayers || waited)) this.beginStarting();
      }
    } else if (this.phase === 'starting') {
      if (now >= this.startAt) this.startMatch();
    } else if (this.phase === 'playing' && this.sim) {
      this.acc += dt;
      const tickMs = 1000 / TICK_RATE;
      let n = 0;
      while (this.acc >= tickMs && n < 8) {
        this.acc -= tickMs;
        this.tick();
        n++;
        if (this.phase !== 'playing') break;
      }
      if (this.acc > tickMs * 8) this.acc = 0;
    } else if (this.phase === 'results') {
      if (now - this.resultsAt > 12000) {
        if (this.opts.kind === 'local') return;
        if (this.opts.quickMatch) this.close('match over');
        else this.backToLobby();
      }
    }
    // Reconnect grace expiry.
    const grace = (this.opts.reconnectGrace ?? 30) * 1000;
    for (const slot of [...this.slots]) {
      if (slot.isBot || slot.connected || !slot.disconnectedAt) continue;
      if (now - slot.disconnectedAt < grace) continue;
      if (this.opts.quickMatch && this.sim) {
        const sp = this.sim.getPlayer(slot.id);
        if (sp) {
          sp.isBot = true;
          slot.isBot = true;
          slot.name = sp.name;
          slot.disconnectedAt = 0;
          slot.connected = true;
          this.rosterVersion++;
          continue;
        }
      }
      this.removeSlot(slot);
    }
    if (this.lobbyDirty || now - this.lastLobbySend > 1000) {
      this.lobbyDirty = false;
      this.lastLobbySend = now;
      this.sendLobby();
    }
  }

  /** One authoritative simulation step + snapshot fan-out. */
  tick(): void {
    const sim = this.sim!;
    const t0 = realClock.now();
    const log: [number, Input][] | null = this.opts.recordInputs ? [] : null;
    for (const peer of this.peers.values()) {
      if (peer.playerId < 0) continue;
      const p = sim.getPlayer(peer.playerId);
      if (!p) continue;
      const next = peer.queue.shift();
      if (next) {
        peer.lastInput = next;
        sim.setInput(p.id, next);
      } else if (peer.lastInput) {
        // Buffer underflow: repeat the last input without advancing the ack.
        const rep = { ...peer.lastInput, actions: peer.lastInput.actions, seq: p.ack };
        sim.setInput(p.id, rep);
      }
      if (log) log.push([p.id, { ...p.input }]);
    }
    // Disconnected humans stand still.
    for (const slot of this.slots) {
      if (slot.isBot || slot.connected) continue;
      const p = sim.getPlayer(slot.id);
      if (p) {
        p.input.buttons = 0;
        p.input.moveX = 0;
        p.input.moveY = 0;
      }
    }
    this.bots!.update(sim);
    if (log) {
      for (const p of sim.players) if (p.isBot && !log.some(([id]) => id === p.id)) log.push([p.id, { ...p.input }]);
      log.sort((a, b) => a[0] - b[0]);
      this.inputLog.push({ tick: sim.tick + 1, inputs: log });
    }
    sim.step();
    if (this.opts.recordInputs && sim.tick % 60 === 0) this.hashes.push(sim.hash());
    for (const e of sim.events) this.pendingEvents.push(e);
    if (sim.tick % this.snapshotInterval === 0) this.broadcastSnapshot();
    const dt = realClock.now() - t0;
    const st = this.tickStats;
    st.count++;
    st.total += dt;
    if (dt > st.max) st.max = dt;
    if (dt > 8) st.overruns++;
    if (sim.isOver() && this.phase === 'playing') {
      this.results = sim.results();
      this.phase = 'results';
      this.resultsAt = this.clock.now();
      this.lobbyDirty = true;
      this.broadcastSnapshot();
      const end = encodeJson(Msg.End, { matchId: this.matchId, results: this.results } satisfies EndMsg);
      for (const peer of this.peers.values()) if (peer.playerId >= 0) this.send(peer, end);
      this.opts.onMatchEnd?.(this.results);
      this.log(`match ${this.matchId} ended`);
    }
  }

  private broadcastSnapshot(): void {
    const sim = this.sim!;
    this.snapCount++;
    const current = new Map<number, Int32Array>();
    for (const p of sim.players) current.set(p.id, playerFields(p, new Int32Array(PF_COUNT)));
    const fresh = this.pendingEvents;
    this.pendingEvents = [];
    for (const e of fresh) if (IMPORTANT.has(e.type)) this.recentEvents.push({ snap: this.snapCount, e });
    this.recentEvents = this.recentEvents.filter((r) => this.snapCount - r.snap < 4);
    const src = {
      matchId: this.matchId,
      tick: sim.tick,
      mode: sim.mode,
      players: sim.players,
      projectiles: sim.projectiles,
      grenades: sim.grenades,
      clouds: sim.clouds,
      dropped: sim.dropped,
      spawners: sim.spawners,
    };
    for (const peer of this.peers.values()) {
      if (peer.playerId < 0) continue;
      const me = sim.getPlayer(peer.playerId);
      const base = peer.ackSnapshot ? peer.sent.get(peer.ackSnapshot) ?? null : null;
      const events: SimEvent[] = [];
      const seen = new Set<number>();
      for (const e of fresh) {
        if (!IMPORTANT.has(e.type) && me && me.alive && !this.relevant(e, me.x, me.y)) continue;
        events.push(e);
        seen.add(e.id);
      }
      for (const r of this.recentEvents) if (!seen.has(r.e.id)) events.push(r.e);
      const data = encodeSnapshot(src, current, base, peer.ackSnapshot, me?.ack ?? 0, peer.queue.length, this.rosterVersion, events);
      this.send(peer, data);
      peer.sent.set(sim.tick, current);
      peer.sentOrder.push(sim.tick);
      while (peer.sentOrder.length > 40) peer.sent.delete(peer.sentOrder.shift()!);
    }
  }

  private relevant(e: SimEvent, x: number, y: number): boolean {
    const R = 1700;
    let ex: number;
    let ey: number;
    switch (e.type) {
      case EventType.Shot:
        ex = e.d[2];
        ey = e.d[3];
        break;
      case EventType.Explode:
      case EventType.Bounce:
        ex = e.d[0];
        ey = e.d[1];
        break;
      case EventType.Hit:
        ex = e.d[4];
        ey = e.d[5];
        break;
      default:
        return true;
    }
    return Math.abs(ex - x) < R && Math.abs(ey - y) < R;
  }

  /** Bandwidth and timing statistics for monitoring and tests. */
  stats() {
    const peers = [...this.peers.values()].map((p) => ({ id: p.id, playerId: p.playerId, bytesOut: p.bytesOut, bytesIn: p.bytesIn, rtt: p.rtt, strikes: p.strikes }));
    return {
      phase: this.phase,
      tick: this.sim?.tick ?? 0,
      players: this.playerCount,
      peers,
      tick_ms_avg: this.tickStats.count ? this.tickStats.total / this.tickStats.count : 0,
      tick_ms_max: this.tickStats.max,
      overruns: this.tickStats.overruns,
    };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(reason = 'closed'): void {
    if (this.closed) return;
    this.closed = true;
    for (const peer of this.peers.values()) {
      try {
        peer.link.close(reason);
      } catch {
        // link already gone
      }
    }
    this.peers.clear();
  }
}
