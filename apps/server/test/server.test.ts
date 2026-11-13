import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameClient } from '@game/net';
import { connectOnline } from '@game/net/online';
import { BTN_FIRE, BTN_JET } from '@game/sim';
import { startServer } from '../src/app';

const PORT = 25670 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}`;
let server: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  process.env.LOG_LEVEL = 'quiet';
  process.env.QUICK_FILL_SECONDS = '1';
  server = await startServer({ port: PORT, dataDir: `/tmp/jayu-test-${PORT}` });
});

afterAll(async () => {
  await server.gameServer.gracefullyShutdown(false);
});

function pump(clients: GameClient[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      for (const c of clients) {
        c.update();
        c.view();
      }
      if (Date.now() - t0 >= ms) {
        clearInterval(iv);
        resolve();
      }
    }, 8);
  });
}

async function until(clients: GameClient[], cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await pump(clients, 50);
  }
}

const hello = (name: string, token = '') => ({ name, look: [], token, platform: 'web' as const });

describe('game server (Colyseus)', () => {
  it('serves health and metrics', async () => {
    const h = await (await fetch(`http://127.0.0.1:${PORT}/health`)).json();
    expect(h.ok).toBe(true);
    expect(h.maps).toBe(10);
    const m = await (await fetch(`http://127.0.0.1:${PORT}/metrics`)).json();
    expect(typeof m.rooms).toBe('number');
  });

  it('private room: create, join by invite code, play, reconnect with token', async () => {
    const a = await connectOnline(URL, { kind: 'create', region: 'ap-south', settings: { mapId: 'underground-lab', mode: 'tdm', botCount: 2 } });
    expect(a.code).toMatch(/^[A-Z2-9]{6}$/);
    const ca = new GameClient(a.transport, hello('Alice'));
    const b = await connectOnline(URL, { kind: 'join', code: a.code.toLowerCase() });
    const cb = new GameClient(b.transport, hello('Bob'));
    const clients = [ca, cb];
    await until(clients, () => ca.lobby?.players.length === 2 && cb.lobby?.players.length === 2);
    expect(ca.lobby!.hostId).toBe(ca.playerId);
    // Non-host cannot change settings; host can.
    cb.lobbyAction({ a: 'settings', settings: { mapId: 'shipyard' } });
    ca.lobbyAction({ a: 'settings', settings: { timeLimit: 120 } });
    await until(clients, () => ca.lobby?.settings.timeLimit === 120);
    expect(ca.lobby!.settings.mapId).toBe('underground-lab');
    let t = 0;
    for (const c of clients)
      c.sampler = (out) => {
        t++;
        out.moveX = t % 120 < 60 ? 127 : -127;
        out.buttons = (t % 30 < 10 ? BTN_JET : 0) | BTN_FIRE;
        out.aim = (t * 200) & 0xffff;
      };
    ca.lobbyAction({ a: 'start' });
    await until(clients, () => ca.status === 'playing' && cb.status === 'playing' && !!ca.view() && !!cb.view());
    await pump(clients, 3000);
    const va = ca.view()!;
    expect(va.players.length).toBe(4);
    expect(ca.stats.snapshotRate).toBeGreaterThan(15);
    // Bob drops and reconnects with his token: same player id.
    const bobId = cb.playerId;
    const token = cb.token;
    b.transport.close();
    await pump([ca], 500);
    const b2 = await connectOnline(URL, { kind: 'join', code: a.code });
    const cb2 = new GameClient(b2.transport, hello('Bob', token));
    await until([ca, cb2], () => cb2.status === 'playing' && !!cb2.view());
    expect(cb2.playerId).toBe(bobId);
    ca.leave();
    cb2.leave();
  }, 30000);

  it('quick match fills with bots and starts', async () => {
    const q = await connectOnline(URL, { kind: 'quick', region: 'ap-south' });
    const c = new GameClient(q.transport, hello('Quinn'));
    await until([c], () => c.status === 'playing' && !!c.view(), 10000);
    expect(c.view()!.players.length).toBe(6);
    c.leave();
  }, 20000);

  it('rejects joining an unknown invite code cleanly', async () => {
    await expect(connectOnline(URL, { kind: 'join', code: 'ZZZZZZ' })).rejects.toBeTruthy();
  });
});
