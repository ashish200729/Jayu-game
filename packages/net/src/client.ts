import { TICK_RATE, WEAPONS } from '@game/content';
import { getMap } from '@game/maps';
import {
  BTN_FIRE,
  World,
  angleDiff,
  bodyHeight,
  copyInput,
  dcos,
  dsin,
  emptyInput,
  newMoveState,
  stepMovement,
  type Input,
  type MatchResults,
  type MoveState,
  type SimEvent,
} from '@game/sim';
import { ByteReader, DecodeError } from './codec';
import {
  Msg,
  PROTOCOL_VERSION,
  decodeJson,
  encodeInputs,
  encodeJson,
  encodePing,
  encodeSimple,
  type EndMsg,
  type HelloMsg,
  type LobbyAction,
  type LobbyStateMsg,
  type RejectMsg,
  type RosterEntry,
  type RosterMsg,
  type StartMsg,
  type WelcomeMsg,
} from './protocol';
import {
  decodeSnapshot,
  fieldsToView,
  type CloudView,
  type DroppedView,
  type GrenadeView,
  type ModeView,
  type PlayerView,
  type ProjectileView,
  type SnapshotData,
} from './snapshot';
import { realClock, type Clock, type ClientTransport } from './transport';

export type ClientStatus = 'connecting' | 'lobby' | 'playing' | 'results' | 'closed' | 'rejected';

export interface InputSampler {
  /** Fill `out` with the current device input (seq/viewTick are set by the client). */
  (out: Input, view: ClientView | null): void;
}

export interface LocalShot {
  wi: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  projectile: boolean;
}

export interface ClientView {
  tick: number;
  renderTick: number;
  me: PlayerView | null;
  players: PlayerView[];
  projectiles: ProjectileView[];
  grenades: GrenadeView[];
  clouds: CloudView[];
  dropped: DroppedView[];
  spawners: { available: boolean; item: number }[];
  mode: ModeView;
  /** Latest local aim (not the server's), so your own arm never lags. */
  localAim: number;
}

export interface NetStats {
  rtt: number;
  jitter: number;
  loss: number;
  snapshotRate: number;
  correctionsPerSec: number;
  bytesInPerSec: number;
  bytesOutPerSec: number;
  inputBuffer: number;
  lastCorrection: number;
}

interface Snap {
  tick: number;
  recv: number;
  players: Map<number, PlayerView>;
  data: SnapshotData;
}

export interface ClientOptions {
  clock?: Clock;
  /** Interpolation delay for remote entities, in ticks (default from snapshot rate). */
  interpTicks?: number;
  /** Disable own-player prediction (debug). */
  noPrediction?: boolean;
}

const FIELD_COPY: (keyof MoveState)[] = [
  'x', 'y', 'vx', 'vy', 'onGround', 'crouch', 'slideT', 'jetT', 'fuel', 'fuelDelay', 'facing', 'wall', 'jetting', 'medium', 'prevJet', 'ride', 'dropT',
];

export class GameClient {
  status: ClientStatus = 'connecting';
  rejectReason: RejectMsg['reason'] | '' = '';
  closeReason = '';
  playerId = -1;
  token = '';
  hostKind: WelcomeMsg['hostKind'] = 'local';
  lobby: LobbyStateMsg | null = null;
  start: StartMsg | null = null;
  roster = new Map<number, RosterEntry>();
  rosterVersion = 0;
  results: MatchResults | null = null;
  world: World | null = null;
  readonly stats: NetStats = {
    rtt: 0,
    jitter: 0,
    loss: 0,
    snapshotRate: 0,
    correctionsPerSec: 0,
    bytesInPerSec: 0,
    bytesOutPerSec: 0,
    inputBuffer: 0,
    lastCorrection: 0,
  };
  onChange: (() => void) | null = null;
  sampler: InputSampler | null = null;

  private clock: Clock;
  private transport: ClientTransport;
  private hello: HelloMsg;
  private opts: ClientOptions;
  private lastHello = -1e9;
  private lastPing = -1e9;
  private lastSync: Record<string, number> = {};
  private snaps: Snap[] = [];
  private baselines = new Map<number, Map<number, Int32Array>>();
  private baselineOrder: number[] = [];
  private ackSnapshot = 0;
  private seq = 0;
  private pending: Input[] = [];
  private sentHistory: Input[] = [];
  private ticksSinceSend = 0;
  private acc = 0;
  private lastFrame = -1;
  private ctick = 0;
  private renderTick = 0;
  private interp = 6;
  private speed = 1;
  private pred: MoveState = newMoveState(0, 0);
  private predValid = false;
  private smoothX = 0;
  private smoothY = 0;
  private prevPredX = 0;
  private prevPredY = 0;
  private alpha = 0;
  private localInput: Input = emptyInput();
  private seenEvents = new Set<number>();
  private seenOrder: number[] = [];
  private eventQueue: SimEvent[] = [];
  private readyEvents: SimEvent[] = [];
  private localShots: LocalShot[] = [];
  private localCd = 0;
  private localBurst = 0;
  private localBurstCd = 0;
  private prevFire = false;
  private fakeProjectiles: (ProjectileView & { born: number })[] = [];
  private knownOwnProjectiles = new Set<number>();
  private corrections: number[] = [];
  private snapTimes: number[] = [];
  private bytesIn: { t: number; n: number }[] = [];
  private bytesOut: { t: number; n: number }[] = [];
  private lastSnapTick = 0;
  private expectedInterval = 1;
  private lossWindow: number[] = [];
  private rttSamples: number[] = [];

  constructor(transport: ClientTransport, hello: Omit<HelloMsg, 'v'>, opts: ClientOptions = {}) {
    this.transport = transport;
    this.clock = opts.clock ?? realClock;
    this.opts = opts;
    this.hello = { ...hello, v: PROTOCOL_VERSION };
    transport.onMessage = (d) => this.onMessage(d);
    transport.onClose = (reason) => {
      if (this.status !== 'rejected') this.setStatus('closed');
      this.closeReason = reason;
    };
    this.sendHello();
  }

  get kind(): ClientTransport['kind'] {
    return this.transport.kind;
  }

  private setStatus(s: ClientStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onChange?.();
  }

  private sendRaw(data: Uint8Array): void {
    this.bytesOut.push({ t: this.clock.now(), n: data.length });
    this.transport.send(data);
  }

  private sendHello(): void {
    this.lastHello = this.clock.now();
    this.sendRaw(encodeJson(Msg.Hello, this.hello));
  }

  lobbyAction(a: LobbyAction): void {
    this.sendRaw(encodeJson(Msg.Lobby, a));
  }

  leave(): void {
    try {
      this.sendRaw(encodeSimple(Msg.Leave));
    } catch {
      // transport already closed
    }
    this.transport.close();
    this.setStatus('closed');
  }

  private requestSync(what: 'roster' | 'start' | 'results' | 'lobby'): void {
    const now = this.clock.now();
    if (now - (this.lastSync[what] ?? -1e9) < 400) return;
    this.lastSync[what] = now;
    this.sendRaw(encodeJson(Msg.SyncReq, { what }));
  }

  // ------------------------------------------------------------------ receiving

  private onMessage(data: Uint8Array): void {
    this.bytesIn.push({ t: this.clock.now(), n: data.length });
    let r: ByteReader;
    let type: number;
    try {
      r = new ByteReader(data);
      type = r.u8();
    } catch {
      return;
    }
    try {
      switch (type) {
        case Msg.Welcome: {
          const w = decodeJson<WelcomeMsg>(r);
          this.playerId = w.playerId;
          this.token = w.token;
          this.hostKind = w.hostKind;
          if (this.status === 'connecting') this.setStatus('lobby');
          break;
        }
        case Msg.Reject: {
          const m = decodeJson<RejectMsg>(r);
          this.rejectReason = m.reason;
          this.setStatus('rejected');
          this.transport.close();
          break;
        }
        case Msg.Kick:
          this.rejectReason = 'kicked';
          this.setStatus('rejected');
          break;
        case Msg.LobbyState: {
          this.lobby = decodeJson<LobbyStateMsg>(r);
          if (this.lobby.phase === 'lobby' || this.lobby.phase === 'starting') {
            if (this.status === 'results' || this.status === 'playing') {
              this.start = null;
              this.results = null;
            }
            if (this.status !== 'connecting') this.setStatus('lobby');
          } else if (this.lobby.phase === 'results' && !this.results) this.requestSync('results');
          this.onChange?.();
          break;
        }
        case Msg.Start:
          this.onStart(decodeJson<StartMsg>(r));
          break;
        case Msg.Roster: {
          const m = decodeJson<RosterMsg>(r);
          this.rosterVersion = m.version;
          this.roster = new Map(m.players.map((p) => [p.id, p]));
          this.onChange?.();
          break;
        }
        case Msg.Snapshot:
          this.onSnapshot(r);
          break;
        case Msg.End: {
          const m = decodeJson<EndMsg>(r);
          if (!this.start || m.matchId === this.start.matchId) {
            this.results = m.results;
            this.setStatus('results');
            this.onChange?.();
          }
          break;
        }
        case Msg.Pong: {
          const t = r.f64();
          const sample = this.clock.now() - t;
          this.rttSamples.push(sample);
          if (this.rttSamples.length > 10) this.rttSamples.shift();
          const avg = this.rttSamples.reduce((a, b) => a + b, 0) / this.rttSamples.length;
          this.stats.rtt = Math.round(avg);
          this.stats.jitter = Math.round(this.rttSamples.reduce((a, b) => a + Math.abs(b - avg), 0) / this.rttSamples.length);
          break;
        }
      }
    } catch (e) {
      if (!(e instanceof DecodeError) && !(e instanceof SyntaxError)) throw e;
      if (e instanceof DecodeError && /baseline/.test(e.message)) this.ackSnapshot = 0;
    }
  }

  private onStart(m: StartMsg): void {
    if (this.start && this.start.matchId === m.matchId) return;
    this.start = m;
    this.results = null;
    this.playerId = m.playerId;
    this.world = new World(getMap(m.config.mapId), m.config.lowGravity);
    this.snaps = [];
    this.baselines.clear();
    this.baselineOrder = [];
    this.ackSnapshot = 0;
    this.pending = [];
    this.sentHistory = [];
    this.predValid = false;
    this.ctick = m.tick;
    this.renderTick = m.tick;
    this.lastSnapTick = 0;
    this.expectedInterval = Math.max(1, Math.round(TICK_RATE / m.snapshotRate));
    this.interp = this.opts.interpTicks ?? (this.expectedInterval <= 1 ? 2 : this.expectedInterval * 2);
    this.seenEvents.clear();
    this.seenOrder = [];
    this.eventQueue = [];
    this.readyEvents = [];
    this.fakeProjectiles = [];
    this.knownOwnProjectiles.clear();
    this.setStatus('playing');
    this.onChange?.();
  }

  private onSnapshot(r: ByteReader): void {
    let s: SnapshotData;
    try {
      s = decodeSnapshot(r, this.baselines);
    } catch (e) {
      if (e instanceof DecodeError) {
        this.ackSnapshot = 0; // ask for a full snapshot
        return;
      }
      throw e;
    }
    if (!this.start || s.matchId !== this.start.matchId) {
      this.requestSync('start');
      return;
    }
    if (this.snaps.length && s.tick <= this.snaps[this.snaps.length - 1].tick) return; // stale / reordered
    const now = this.clock.now();
    this.baselines.set(s.tick, s.players);
    this.baselineOrder.push(s.tick);
    while (this.baselineOrder.length > 48) this.baselines.delete(this.baselineOrder.shift()!);
    this.ackSnapshot = s.tick;
    if (s.rosterVersion !== this.rosterVersion) this.requestSync('roster');
    // Loss estimate from gaps in snapshot ticks.
    if (this.lastSnapTick) {
      const gap = Math.round((s.tick - this.lastSnapTick) / this.expectedInterval);
      this.lossWindow.push(Math.max(0, gap - 1), 1);
      while (this.lossWindow.length > 200) this.lossWindow.splice(0, 2);
    }
    this.lastSnapTick = s.tick;
    this.snapTimes.push(now);
    const players = new Map<number, PlayerView>();
    for (const [id, f] of s.players) players.set(id, fieldsToView(id, f));
    this.snaps.push({ tick: s.tick, recv: now, players, data: s });
    if (this.snaps.length > 32) this.snaps.shift();
    this.stats.inputBuffer = s.inputBuffer;
    // Events: dedupe and queue for release in render time.
    for (const e of s.events) {
      if (this.seenEvents.has(e.id)) continue;
      this.seenEvents.add(e.id);
      this.seenOrder.push(e.id);
      if (this.seenOrder.length > 2000) this.seenEvents.delete(this.seenOrder.shift()!);
      this.eventQueue.push(e);
    }
    // Clock alignment on first snapshot.
    if (this.snaps.length === 1) {
      this.renderTick = s.tick - this.interp;
      this.ctick = s.tick + Math.round((this.stats.rtt / 2 / 1000) * TICK_RATE) + 2;
    }
    // Input-buffer driven time scale: keep ~2 inputs queued on the host.
    this.speed = s.inputBuffer < 1 ? 1.04 : s.inputBuffer > 3 ? 0.97 : 1;
    this.reconcile(s, players.get(this.playerId));
    if (s.mode.phase === 'ended' && !this.results && this.lobby?.phase === 'results') this.requestSync('results');
  }

  private moveMods(me: PlayerView, phase: ModeView['phase']) {
    return {
      speedMult: 1 + me.upgrades.speed * 0.1,
      fuelMult: 1 + me.upgrades.fuel * 0.3,
      frozen: phase === 'countdown' || phase === 'ended' || me.dummy,
    };
  }

  private reconcile(s: SnapshotData, me: PlayerView | undefined): void {
    this.pending = this.pending.filter((i) => i.seq > s.ack);
    if (!me || !me.alive || !this.world || this.opts.noPrediction) {
      this.predValid = false;
      this.smoothX = this.smoothY = 0;
      return;
    }
    const before = this.predValid ? { x: this.pred.x, y: this.pred.y } : null;
    const st = this.pred;
    for (const k of FIELD_COPY) (st as unknown as Record<string, unknown>)[k] = (me as unknown as Record<string, unknown>)[k];
    const mods = this.moveMods(me, s.mode.phase);
    let t = s.tick;
    for (const inp of this.pending) {
      t++;
      stepMovement(st, inp, this.world, t, mods);
    }
    this.ctick = Math.max(this.ctick, t);
    if (before) {
      const ex = before.x - st.x;
      const ey = before.y - st.y;
      const err = Math.sqrt(ex * ex + ey * ey);
      if (err > 0.5) {
        this.corrections.push(this.clock.now());
        this.stats.lastCorrection = err;
      }
      if (err > 96) {
        this.smoothX = this.smoothY = 0;
      } else {
        this.smoothX += ex;
        this.smoothY += ey;
      }
      this.prevPredX += st.x - before.x;
      this.prevPredY += st.y - before.y;
    } else {
      this.prevPredX = st.x;
      this.prevPredY = st.y;
    }
    this.predValid = true;
  }

  // ------------------------------------------------------------------ per-frame update

  /** Call once per rendered frame. */
  update(now = this.clock.now()): void {
    this.viewVersion++;
    if (this.lastFrame < 0) this.lastFrame = now;
    const dt = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    if (this.status === 'connecting' && now - this.lastHello > 700) this.sendHello();
    if (now - this.lastPing > 1000 && this.status !== 'closed' && this.status !== 'rejected') {
      this.lastPing = now;
      this.sendRaw(encodePing(now, this.stats.rtt));
    }
    if (this.status !== 'playing' || !this.world) return;
    // Remote render clock: follow the newest snapshot minus the interpolation delay.
    const last = this.snaps[this.snaps.length - 1];
    this.renderTick += (dt / 1000) * TICK_RATE;
    if (last) {
      const target = last.tick + ((now - last.recv) / 1000) * TICK_RATE - this.interp;
      const err = target - this.renderTick;
      if (Math.abs(err) > 20) this.renderTick = target;
      else this.renderTick += err * 0.06;
    }
    // Predicted local clock.
    const tickMs = 1000 / TICK_RATE;
    this.acc += dt * this.speed;
    let steps = 0;
    while (this.acc >= tickMs && steps < 6) {
      this.acc -= tickMs;
      this.clientTick();
      steps++;
    }
    if (this.acc > tickMs * 6) this.acc = 0;
    this.alpha = this.acc / tickMs;
    // Decay prediction error smoothing over ~100 ms.
    const k = Math.pow(0.5, dt / 35);
    this.smoothX *= k;
    this.smoothY *= k;
    if (Math.abs(this.smoothX) < 0.05) this.smoothX = 0;
    if (Math.abs(this.smoothY) < 0.05) this.smoothY = 0;
    // Release queued events whose time has come.
    const rt = this.renderTick;
    if (this.eventQueue.length) {
      const keep: SimEvent[] = [];
      for (const e of this.eventQueue) {
        const mine = e.d[0] === this.playerId || e.d[1] === this.playerId;
        if (e.tick <= rt + 1 || mine || e.tick < rt - 120) this.readyEvents.push(e);
        else keep.push(e);
      }
      this.eventQueue = keep;
    }
    this.updateFakeProjectiles(dt);
    this.updateStats(now);
  }

  private clientTick(): void {
    const me = this.latestMe();
    const inp = this.localInput;
    const view = this.snaps.length ? this.viewCache ?? null : null;
    if (this.sampler) this.sampler(inp, view);
    inp.seq = ++this.seq;
    inp.viewTick = Math.max(0, Math.floor(this.renderTick));
    const copy = copyInput(inp);
    this.pending.push(copy);
    this.sentHistory.push(copy);
    if (this.sentHistory.length > 8) this.sentHistory.shift();
    if (this.pending.length > 120) this.pending.shift();
    this.ctick++;
    if (me && me.alive && this.predValid && this.world && !this.opts.noPrediction) {
      this.prevPredX = this.pred.x;
      this.prevPredY = this.pred.y;
      stepMovement(this.pred, copy, this.world, this.ctick, this.moveMods(me, this.snaps[this.snaps.length - 1].data.mode.phase));
      this.predictFire(me, copy);
    }
    if (++this.ticksSinceSend >= (this.transport.kind === 'local' ? 1 : 2)) {
      this.ticksSinceSend = 0;
      this.sendRaw(encodeInputs(this.sentHistory.slice(-5), this.ackSnapshot));
    }
  }

  private viewCache: ClientView | null = null;
  private viewVersion = 0;
  private builtVersion = -1;

  /** Cosmetic prediction of your own shots so muzzle flashes and tracers appear instantly. */
  private predictFire(me: PlayerView, inp: Input): void {
    const phase = this.snaps[this.snaps.length - 1].data.mode.phase;
    const fire = (inp.buttons & BTN_FIRE) !== 0;
    if (this.localCd > 0) this.localCd--;
    const slot = me.slots[me.active];
    if (slot.wi < 0 || phase !== 'playing' || me.reloadT > 0) {
      this.prevFire = fire;
      this.localBurst = 0;
      return;
    }
    const def = WEAPONS[slot.wi];
    if (def.kind === 'flame') {
      this.prevFire = fire;
      return;
    }
    if (this.localBurst > 0) {
      if (--this.localBurstCd <= 0) {
        this.emitLocalShot(slot.wi, inp.aim);
        this.localBurst--;
        this.localBurstCd = Math.round(def.burstInterval * TICK_RATE);
      }
    } else if (fire && this.localCd === 0 && slot.mag > 0 && (def.auto || !this.prevFire)) {
      this.emitLocalShot(slot.wi, inp.aim);
      this.localBurst = def.burst - 1;
      this.localBurstCd = Math.round(def.burstInterval * TICK_RATE);
      const dual = me.dualT > 0 && def.dualWieldable;
      this.localCd = Math.max(1, Math.round(def.fireInterval * TICK_RATE * (dual ? 0.55 : 1)));
    }
    this.prevFire = fire;
  }

  private emitLocalShot(wi: number, aim: number): void {
    const def = WEAPONS[wi];
    const h = bodyHeight(this.pred);
    const x0 = this.pred.x;
    const y0 = this.pred.y - h + 16;
    const dx = dcos(aim);
    const dy = dsin(aim);
    if (def.projectile) {
      this.localShots.push({ wi, x0, y0, x1: x0 + dx * 30, y1: y0 + dy * 30, projectile: true });
      this.fakeProjectiles.push({
        id: -this.seq,
        wi,
        owner: this.playerId,
        x: x0 + dx * 18,
        y: y0 + dy * 18,
        vx: dx * def.projectile.speed,
        vy: dy * def.projectile.speed,
        born: this.clock.now(),
      });
      return;
    }
    const t = this.world!.raycast(x0, y0, x0 + dx * def.range, y0 + dy * def.range, this.ctick);
    this.localShots.push({ wi, x0, y0, x1: x0 + dx * def.range * t, y1: y0 + dy * def.range * t, projectile: false });
  }

  private updateFakeProjectiles(dt: number): void {
    if (!this.fakeProjectiles.length) return;
    const now = this.clock.now();
    const keep: typeof this.fakeProjectiles = [];
    for (const f of this.fakeProjectiles) {
      const spec = WEAPONS[f.wi].projectile!;
      f.vy += (spec.gravity * dt) / 1000;
      const nx = f.x + (f.vx * dt) / 1000;
      const ny = f.y + (f.vy * dt) / 1000;
      const hitWall = this.world!.raycast(f.x, f.y, nx, ny, this.ctick) < 1;
      f.x = nx;
      f.y = ny;
      if (!hitWall && now - f.born < this.stats.rtt + 300) keep.push(f);
    }
    this.fakeProjectiles = keep;
  }

  private updateStats(now: number): void {
    const cut = now - 1000;
    while (this.corrections.length && this.corrections[0] < cut) this.corrections.shift();
    while (this.snapTimes.length && this.snapTimes[0] < cut) this.snapTimes.shift();
    while (this.bytesIn.length && this.bytesIn[0].t < cut) this.bytesIn.shift();
    while (this.bytesOut.length && this.bytesOut[0].t < cut) this.bytesOut.shift();
    this.stats.correctionsPerSec = this.corrections.length;
    this.stats.snapshotRate = this.snapTimes.length;
    this.stats.bytesInPerSec = this.bytesIn.reduce((a, b) => a + b.n, 0);
    this.stats.bytesOutPerSec = this.bytesOut.reduce((a, b) => a + b.n, 0);
    let lost = 0;
    let total = 0;
    for (let i = 0; i < this.lossWindow.length; i += 2) {
      lost += this.lossWindow[i];
      total += this.lossWindow[i] + this.lossWindow[i + 1];
    }
    this.stats.loss = total ? lost / total : 0;
  }

  // ------------------------------------------------------------------ view

  private latestMe(): PlayerView | undefined {
    const s = this.snaps[this.snaps.length - 1];
    return s?.players.get(this.playerId);
  }

  /** Events ready to be presented (effects, sounds, kill feed). Drains the queue. */
  takeEvents(): SimEvent[] {
    const e = this.readyEvents;
    this.readyEvents = [];
    return e;
  }

  /** Locally predicted shots of your own player since the last call. */
  takeLocalShots(): LocalShot[] {
    const s = this.localShots;
    this.localShots = [];
    return s;
  }

  /** Interpolated world view for rendering. */
  view(): ClientView | null {
    if (!this.snaps.length) return null;
    if (this.viewCache && this.viewVersion === this.builtVersion) return this.viewCache;
    this.builtVersion = this.viewVersion;
    const rt = this.renderTick;
    let i1 = this.snaps.findIndex((s) => s.tick > rt);
    if (i1 < 0) i1 = this.snaps.length - 1;
    const i0 = Math.max(0, i1 - 1);
    const s0 = this.snaps[i0];
    const s1 = this.snaps[i1];
    const span = s1.tick - s0.tick;
    const a = span > 0 ? Math.max(0, Math.min(1, (rt - s0.tick) / span)) : 1;
    const latest = this.snaps[this.snaps.length - 1];
    const players: PlayerView[] = [];
    let me: PlayerView | null = null;
    for (const [id, p1] of latest.players) {
      if (id === this.playerId) {
        const v = { ...p1 };
        if (this.predValid && v.alive) {
          const px = this.prevPredX + (this.pred.x - this.prevPredX) * this.alpha;
          const py = this.prevPredY + (this.pred.y - this.prevPredY) * this.alpha;
          v.x = px + this.smoothX;
          v.y = py + this.smoothY;
          v.vx = this.pred.vx;
          v.vy = this.pred.vy;
          v.crouch = this.pred.crouch;
          v.jetting = this.pred.jetting;
          v.onGround = this.pred.onGround;
          v.fuel = this.pred.fuel;
          v.facing = this.pred.facing;
        }
        v.aim = this.localInput.aim;
        me = v;
        players.push(v);
        continue;
      }
      const a0 = s0.players.get(id);
      const b1 = s1.players.get(id);
      if (!a0 || !b1) {
        players.push(b1 ?? a0 ?? p1);
        continue;
      }
      const base = a < 0.5 ? a0 : b1;
      const v = { ...base };
      // Do not interpolate across a respawn teleport.
      const jump = Math.abs(b1.x - a0.x) + Math.abs(b1.y - a0.y) > 300 || a0.alive !== b1.alive;
      if (!jump) {
        v.x = a0.x + (b1.x - a0.x) * a;
        v.y = a0.y + (b1.y - a0.y) * a;
        v.aim = (a0.aim + Math.round(angleDiff(a0.aim, b1.aim) * a) + 65536) % 65536;
        v.fuel = a0.fuel + (b1.fuel - a0.fuel) * a;
      }
      players.push(v);
    }
    const lerpList = <T extends { id: number; x: number; y: number }>(l0: T[], l1: T[]): T[] =>
      l1.map((e1) => {
        const e0 = l0.find((e) => e.id === e1.id);
        if (!e0) return e1;
        return { ...e1, x: e0.x + (e1.x - e0.x) * a, y: e0.y + (e1.y - e0.y) * a };
      });
    // Own projectiles: extrapolate to "now" so they line up with the instant local prediction.
    const lead = (this.ctick - rt) / TICK_RATE;
    const projectiles = lerpList(s0.data.projectiles, s1.data.projectiles).map((p) => {
      if (p.owner !== this.playerId) return p;
      if (!this.knownOwnProjectiles.has(p.id)) {
        this.knownOwnProjectiles.add(p.id);
        // Hand-off: drop the oldest fake projectile of the same weapon.
        const fi = this.fakeProjectiles.findIndex((f) => f.wi === p.wi);
        if (fi >= 0) this.fakeProjectiles.splice(fi, 1);
      }
      const spec = WEAPONS[p.wi].projectile;
      return { ...p, x: p.x + p.vx * lead, y: p.y + p.vy * lead + 0.5 * (spec?.gravity ?? 0) * lead * lead };
    });
    for (const f of this.fakeProjectiles) projectiles.push(f);
    const v: ClientView = {
      tick: latest.tick,
      renderTick: rt,
      me,
      players,
      projectiles,
      grenades: lerpList(s0.data.grenades, s1.data.grenades),
      clouds: latest.data.clouds,
      dropped: latest.data.dropped,
      spawners: latest.data.spawners,
      mode: latest.data.mode,
      localAim: this.localInput.aim,
    };
    this.viewCache = v;
    return v;
  }

  /** Predicted local tick (used by the renderer for mover positions). */
  get predictedTick(): number {
    return this.ctick + this.alpha;
  }

  get name(): string {
    return this.hello.name;
  }

  playerName(id: number): string {
    return this.roster.get(id)?.name ?? this.lobby?.players.find((p) => p.id === id)?.name ?? `Player ${id}`;
  }

  /** Movement-state of the local prediction (for tests). */
  get predicted(): MoveState | null {
    return this.predValid ? this.pred : null;
  }

  get pendingInputs(): number {
    return this.pending.length;
  }
}
