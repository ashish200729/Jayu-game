import { describe, expect, it } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { GameClient, LanHostBridge, MatchHost, createLanClientTransport, createLocalPair, type InputLogEntry } from '@game/net';
import { connectOnline } from '@game/net/online';
import { BTN_FIRE, BTN_JET, Sim, defaultConfig, type MatchConfig } from '@game/sim';
import { startServer } from '../../apps/server/src/app';
import { udpClient, udpHost } from '../netcode/udp';

/** Replays a host's recorded input log through a fresh Sim and returns the hash every 60 steps. */
function replay(config: MatchConfig, roster: MatchHost['startRoster'], log: InputLogEntry[]): number[] {
  const sim = new Sim(config);
  for (const p of roster) sim.addPlayer({ id: p.id, name: p.name, team: p.team, isBot: p.isBot, difficulty: p.difficulty, loadout: p.loadout });
  const hashes: number[] = [];
  for (const e of log) {
    for (const [id, inp] of e.inputs) sim.setInput(id, inp);
    sim.step();
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  return hashes;
}

const sampler = (i: number) => {
  let k = 0;
  return (out: any) => {
    k++;
    out.moveX = (k + i * 30) % 90 < 45 ? 127 : -127;
    out.buttons = (k % 50 < 18 ? BTN_JET : 0) | (k % 16 < 6 ? BTN_FIRE : 0);
    out.aim = (k * 700 + i * 9000) & 0xffff;
    if (k % 97 === 0) out.actions = (out.actions + 1) & 0xf; // throw grenade counter
  };
};

function pump(fn: () => void, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      fn();
      if (Date.now() - t0 >= ms) {
        clearInterval(iv);
        resolve();
      }
    }, 5);
  });
}

const settings = { mapId: 'orbital-station', mode: 'tdm' as const, botCount: 3, timeLimit: 300 };

describe('determinism across hosts', () => {
  it('local host: replay matches recorded hashes', async () => {
    const host = new MatchHost({ kind: 'local', code: 'L', recordInputs: true, autoStart: true, settings });
    const pair = createLocalPair((d) => host.receive('a', d), () => host.disconnect('a'));
    host.connect('a', pair.link);
    const c = new GameClient(pair.client, { name: 'Solo', look: [], token: '', platform: 'web' });
    c.sampler = sampler(0);
    await pump(() => (host.update(), c.update()), 6000);
    expect(host.hashes.length).toBeGreaterThan(3);
    expect(replay(host.sim!.config, host.startRoster, host.inputLog)).toEqual(host.hashes);
  }, 20000);

  it('LAN host over UDP: replay matches recorded hashes', async () => {
    const { socket, port } = await udpHost(0.05);
    const host = new MatchHost({ kind: 'lan', code: 'LAN', recordInputs: true, settings });
    const bridge = new LanHostBridge(host, socket);
    const cs: { c: GameClient; t: ReturnType<typeof createLanClientTransport> }[] = [];
    for (let i = 0; i < 3; i++) {
      const t = createLanClientTransport(await udpClient(port, 0.05));
      const c = new GameClient(t, { name: `P${i}`, look: [], token: '', platform: 'android' });
      c.sampler = sampler(i);
      cs.push({ c, t });
    }
    const tick = () => {
      host.update();
      bridge.update();
      for (const { c, t } of cs) {
        t.update();
        c.update();
      }
    };
    await pump(tick, 800);
    cs.find(({ c }) => c.playerId === cs[0].c.lobby!.hostId)!.c.lobbyAction({ a: 'start' });
    await pump(tick, 7000);
    expect(host.hashes.length).toBeGreaterThan(3);
    expect(replay(host.sim!.config, host.startRoster, host.inputLog)).toEqual(host.hashes);
    host.close();
    bridge.close();
  }, 20000);

  it('Colyseus room: replay matches recorded hashes', async () => {
    process.env.RECORD_INPUTS = '1';
    process.env.LOG_LEVEL = 'quiet';
    const port = 27000 + Math.floor(Math.random() * 1000);
    const server = await startServer({ port, dataDir: `/tmp/jayu-det-${port}` });
    try {
      const conns: GameClient[] = [];
      const a = await connectOnline(`ws://127.0.0.1:${port}`, { kind: 'create', region: 'ap-south', settings });
      conns.push(new GameClient(a.transport, { name: 'A', look: [], token: '', platform: 'web' }));
      const b = await connectOnline(`ws://127.0.0.1:${port}`, { kind: 'join', code: a.code });
      conns.push(new GameClient(b.transport, { name: 'B', look: [], token: '', platform: 'ios' }));
      conns.forEach((c, i) => (c.sampler = sampler(i)));
      await pump(() => conns.forEach((c) => c.update()), 800);
      conns[0].lobbyAction({ a: 'start' });
      await pump(() => conns.forEach((c) => c.update()), 7000);
      const room = matchMaker.getLocalRoomById(a.code) as unknown as { host: MatchHost };
      const host = room.host;
      expect(host.hashes.length).toBeGreaterThan(3);
      expect(replay(host.sim!.config, host.startRoster, host.inputLog)).toEqual(host.hashes);
      // And the same log through a local in-process sim gives the same result as the LAN/local hosts would.
      expect(replay(defaultConfig({ ...host.sim!.config }), host.startRoster, host.inputLog)).toEqual(host.hashes);
      conns.forEach((c) => c.leave());
    } finally {
      delete process.env.RECORD_INPUTS;
      await server.gameServer.gracefullyShutdown(false);
    }
  }, 30000);
});
