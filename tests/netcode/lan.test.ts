import { describe, expect, it } from 'vitest';
import { GameClient, LanHostBridge, MatchHost, createLanClientTransport } from '@game/net';
import { BTN_FIRE, BTN_JET } from '@game/sim';
import { udpClient, udpHost } from './udp';

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

describe('LAN over UDP (node:dgram stand-in for the native plugin)', () => {
  it('hosts a 12-player match over lossy UDP with reliable lobby control', async () => {
    const LOSS = 0.1;
    const { socket, port } = await udpHost(LOSS);
    const host = new MatchHost({ kind: 'lan', code: 'LAN123', settings: { mapId: 'volcano-base', mode: 'ffa', maxPlayers: 12 } });
    const bridge = new LanHostBridge(host, socket);
    const clients: { c: GameClient; t: ReturnType<typeof createLanClientTransport> }[] = [];
    for (let i = 0; i < 11; i++) {
      const t = createLanClientTransport(await udpClient(port, LOSS));
      const c = new GameClient(t, { name: `Phone${i}`, look: [], token: '', platform: i % 2 ? 'ios' : 'android' });
      let k = 0;
      c.sampler = (out) => {
        k++;
        out.moveX = (k + i * 20) % 100 < 50 ? 127 : -127;
        out.buttons = (k % 40 < 15 ? BTN_JET : 0) | (k % 20 < 5 ? BTN_FIRE : 0);
        out.aim = (k * 500 + i * 3000) & 0xffff;
      };
      clients.push({ c, t });
    }
    const tick = () => {
      host.update();
      bridge.update();
      for (const { c, t } of clients) {
        t.update();
        c.update();
        c.view();
      }
    };
    await pump(tick, 1500);
    expect(bridge.peerCount).toBe(11);
    for (const { c } of clients) expect(c.status).toBe('lobby');
    const hostClient = clients.find(({ c }) => c.playerId === clients[0].c.lobby!.hostId)!.c;
    hostClient.lobbyAction({ a: 'settings', settings: { botCount: 1 } });
    await pump(tick, 300);
    hostClient.lobbyAction({ a: 'start' });
    await pump(tick, 6000);
    for (const { c } of clients) {
      expect(c.status).toBe('playing');
      expect(c.view()!.players.length).toBe(12);
    }
    // Host leaves: everyone gets a clean close (no hang).
    host.close('host left');
    bridge.close();
    await pump(() => clients.forEach(({ c, t }) => (t.update(), c.update())), 300);
    for (const { c } of clients) expect(['closed', 'playing']).toContain(c.status);
    for (const { c } of clients) c.leave();
  }, 30000);
});
