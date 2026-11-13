import { describe, expect, it } from 'vitest';
import { WEAPONS, weaponIndex } from '@game/content';
import {
  GameClient,
  MatchHost,
  PF_COUNT,
  createLocalPair,
  playerFields,
  type NetConditions,
} from '@game/net';
import { BTN_FIRE, BTN_JET, EventType, datan2 } from '@game/sim';
import { VirtualClock } from './helpers';

interface Rig {
  clock: VirtualClock;
  host: MatchHost;
  clients: GameClient[];
  ups: { bytes: number }[];
  downs: { bytes: number }[];
  hostFields: Map<number, Map<number, Int32Array>>;
}

function makeRig(n: number, cond: NetConditions, mode: 'ffa' | 'tdm' = 'ffa', mapId = 'rooftop-dusk', bots = 0): Rig {
  const clock = new VirtualClock();
  const host = new MatchHost({
    kind: 'online',
    code: 'TEST01',
    clock,
    seed: 42,
    settings: { mapId, mode, timeLimit: 600, botCount: bots, maxPlayers: 12 },
  });
  const clients: GameClient[] = [];
  const ups: { bytes: number }[] = [];
  const downs: { bytes: number }[] = [];
  for (let i = 0; i < n; i++) {
    const peerId = `p${i}`;
    const pair = createLocalPair((d) => host.receive(peerId, d), () => host.disconnect(peerId), cond, clock, 100 + i, 'online');
    host.connect(peerId, pair.link);
    const c = new GameClient(pair.client, { name: `Tester${i}`, look: [], token: '', platform: 'web' }, { clock });
    clients.push(c);
    ups.push(pair.up);
    downs.push(pair.down);
  }
  return { clock, host, clients, ups, downs, hostFields: new Map() };
}

function step(r: Rig, ms: number): void {
  const frame = 1000 / 60;
  for (let t = 0; t < ms; t += frame) {
    r.clock.advance(frame);
    r.host.update(r.clock.now());
    if (r.host.sim) {
      const m = new Map<number, Int32Array>();
      for (const p of r.host.sim.players) m.set(p.id, playerFields(p, new Int32Array(PF_COUNT)));
      r.hostFields.set(r.host.sim.tick, m);
      if (r.hostFields.size > 600) r.hostFields.delete(r.hostFields.keys().next().value!);
    }
    for (const c of r.clients) {
      c.update(r.clock.now());
      c.view();
    }
  }
}

function hostClient(r: Rig): GameClient {
  const id = r.clients[0].lobby!.hostId;
  return r.clients.find((c) => c.playerId === id)!;
}

function scriptedSampler(i: number) {
  let t = 0;
  return (out: any) => {
    t++;
    const phase = Math.floor((t + i * 37) / 90) % 4;
    out.moveX = phase === 0 ? 127 : phase === 2 ? -127 : 0;
    out.moveY = 0;
    out.buttons = (phase === 1 || (t + i) % 50 < 12 ? BTN_JET : 0) | (t % 40 < 20 ? BTN_FIRE : 0);
    out.aim = (t * 300 + i * 5000) & 0xffff;
  };
}

describe('netcode', () => {
  it('rejects mismatched protocol versions without crashing', () => {
    const clock = new VirtualClock();
    const host = new MatchHost({ kind: 'online', code: 'V', clock });
    const pair = createLocalPair((d) => host.receive('x', d), () => host.disconnect('x'), { latencyMs: 0, jitterMs: 0, loss: 0 }, clock);
    host.connect('x', pair.link);
    let got = '';
    pair.client.onMessage = (d) => {
      got = new TextDecoder().decode(d.slice(2));
    };
    const bad = new TextEncoder().encode(JSON.stringify({ v: 999, name: 'x', look: [], token: '', platform: 'web' }));
    const msg = new Uint8Array(bad.length + 2);
    msg[0] = 1;
    msg[1] = bad.length;
    msg.set(bad, 2);
    pair.client.send(msg);
    expect(got).toContain('version');
  });

  it('survives malformed and malicious packets', () => {
    const clock = new VirtualClock();
    const host = new MatchHost({ kind: 'online', code: 'M', clock, autoStart: true });
    const pair = createLocalPair((d) => host.receive('x', d), () => host.disconnect('x'), { latencyMs: 0, jitterMs: 0, loss: 0 }, clock);
    host.connect('x', pair.link);
    const c = new GameClient(pair.client, { name: 'Ok', look: [], token: '', platform: 'web' }, { clock });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = 0; i < 3000; i++) {
      const len = 1 + Math.floor(rnd() * 64);
      const junk = new Uint8Array(len);
      for (let k = 0; k < len; k++) junk[k] = Math.floor(rnd() * 256);
      if (i % 3 === 0) junk[0] = [1, 2, 3, 4, 5][i % 5];
      expect(() => host.receive('x', junk)).not.toThrow();
      if (i % 50 === 0) {
        clock.advance(20);
        host.update(clock.now());
      }
    }
    expect(c).toBeTruthy();
  });

  it('keeps 12 clients in sync at 150ms RTT, 2% loss, 30ms jitter within the bandwidth budget', () => {
    const cond = { latencyMs: 75, jitterMs: 15, loss: 0.02 };
    const r = makeRig(12, cond);
    r.clients.forEach((c, i) => (c.sampler = scriptedSampler(i)));
    step(r, 1000);
    for (const c of r.clients) expect(c.status).toBe('lobby');
    hostClient(r).lobbyAction({ a: 'start' });
    step(r, 3000);
    for (const c of r.clients) expect(c.status).toBe('playing');
    // Verify every decoded snapshot equals the host's state for that tick (delta compression is exact).
    let checked = 0;
    let mismatches = 0;
    const orig = r.clients.map((c) => (c as any).onSnapshot.bind(c));
    r.clients.forEach((c, i) => {
      (c as any).onSnapshot = (rd: any) => {
        orig[i](rd);
        const snaps = (c as any).snaps;
        const s = snaps[snaps.length - 1];
        const hf = r.hostFields.get(s.tick);
        if (!hf) return;
        for (const [id, f] of s.data.players as Map<number, Int32Array>) {
          const h = hf.get(id);
          checked++;
          if (!h || h.some((v, k) => v !== f[k])) mismatches++;
        }
      };
    });
    const b0down = r.downs.map((d) => d.bytes);
    const b0up = r.ups.map((d) => d.bytes);
    const seconds = 30;
    let corrSum = 0;
    let corrSamples = 0;
    let maxErr = 0;
    for (let s = 0; s < seconds; s++) {
      step(r, 1000);
      for (const c of r.clients) {
        corrSum += c.stats.correctionsPerSec;
        corrSamples++;
        maxErr = Math.max(maxErr, c.stats.lastCorrection);
      }
    }
    const down = r.downs.map((d, i) => (d.bytes - b0down[i]) / seconds);
    const up = r.ups.map((d, i) => (d.bytes - b0up[i]) / seconds);
    const avgDown = down.reduce((a, b) => a + b, 0) / down.length;
    const maxDown = Math.max(...down);
    const maxUp = Math.max(...up);
    const corrPerSec = corrSum / corrSamples;
    console.log(
      `[netcode 12p 150ms/2%/30ms] checked=${checked} mismatches=${mismatches} down avg=${avgDown.toFixed(0)}B/s max=${maxDown.toFixed(0)}B/s up max=${maxUp.toFixed(0)}B/s corrections/s=${corrPerSec.toFixed(2)} lastErrMax=${maxErr.toFixed(1)}px rtt=${r.clients[0].stats.rtt}ms loss=${(r.clients[0].stats.loss * 100).toFixed(1)}%`,
    );
    expect(checked).toBeGreaterThan(5000);
    expect(mismatches).toBe(0);
    expect(maxDown).toBeLessThan(12 * 1024);
    expect(maxUp).toBeLessThan(4 * 1024);
    expect(r.host.tickStats.max).toBeLessThan(50);
  });

  for (const cond of [
    { latencyMs: 25, jitterMs: 5, loss: 0.0 },
    { latencyMs: 125, jitterMs: 20, loss: 0.05 },
  ]) {
    it(`stays consistent at ${cond.latencyMs * 2}ms RTT and ${cond.loss * 100}% loss`, () => {
      const r = makeRig(4, cond, 'tdm', 'snow-outpost', 4);
      r.clients.forEach((c, i) => (c.sampler = scriptedSampler(i)));
      step(r, 800);
      hostClient(r).lobbyAction({ a: 'start' });
      step(r, 20000);
      for (const c of r.clients) {
        expect(c.status).toBe('playing');
        const v = c.view()!;
        expect(v.players.length).toBe(8);
        const hostMe = r.host.sim!.getPlayer(c.playerId)!;
        const me = v.me!;
        // The predicted player stays close to the authoritative one (one RTT of motion at most).
        if (hostMe.alive && me.alive) expect(Math.abs(hostMe.x - me.x) + Math.abs(hostMe.y - me.y)).toBeLessThan(260);
      }
    });
  }

  it('lag compensation registers hits on what the shooter saw (150ms RTT)', () => {
    const r = makeRig(1, { latencyMs: 75, jitterMs: 15, loss: 0.02 }, 'ffa', 'training-grounds', 3);
    const shooter = r.clients[0];
    let shots = 0;
    let lastFire = 0;
    const lags: number[] = [];
    shooter.sampler = (out, view) => {
      out.moveX = 0;
      out.moveY = 0;
      out.buttons = 0;
      const me = view?.me;
      if (!view || !me || !me.alive || view.mode.phase !== 'playing') return;
      const world = shooter.world!;
      let best: any = null;
      let bd = 1e9;
      for (const p of view.players) {
        if (p.id === me.id || !p.alive || p.protT > 0) continue;
        const ty = p.y - (p.crouch ? 15 : 22);
        const d = Math.hypot(p.x - me.x, ty - me.y);
        if (d < bd && d < 1500 && world.los(me.x, me.y - 28, p.x, ty, view.tick)) {
          bd = d;
          best = { x: p.x, y: ty };
        }
      }
      if (!best) return;
      out.aim = datan2(best.y - (me.y - 28), best.x - me.x);
      const t = r.clock.now();
      if (t - lastFire > 1300) {
        lags.push(r.host.sim ? r.host.sim.tick - Math.floor((shooter as any).renderTick) : -1);
        out.buttons = BTN_FIRE;
        lastFire = t;
        shots++;
      }
    };
    step(r, 600);
    shooter.lobbyAction({ a: 'start' });
    step(r, 2500);
    // Give the shooter a near-perfect rifle and make them immortal for the test.
    const sim = r.host.sim!;
    const me = sim.getPlayer(shooter.playerId)!;
    for (let s = 0; s < 240; s++) {
      me.slots[1] = { wi: weaponIndex('heron'), mag: 99, reserve: -1 };
      me.active = 1;
      me.hp = 5000;
      me.protT = 0;
      for (const p of sim.players) if (p.isBot) p.input.buttons &= ~BTN_FIRE;
      step(r, 250);
    }
    // Count authoritative results from the host's perspective.
    const fired = me.shotsFired;
    const hits = me.shotsHit;
    const acc = fired ? hits / fired : 0;
    console.log(`[lag-comp] view lag ticks at fire (host-now minus viewTick)=${lags.slice(0,6).join(',')} client shots=${shots} host fired=${fired} hits=${hits} accuracy=${(acc * 100).toFixed(1)}% (weapon spread ${WEAPONS[weaponIndex('heron')].spread} rad)`);
    expect(fired).toBeGreaterThan(10);
    expect(acc).toBeGreaterThan(0.75);
    void EventType;
  });
});
