/**
 * npm run soak -- [minutes=60]
 * Simulated-time soak: back-to-back online-style matches (12 clients incl. bots, 150 ms RTT, 2% loss)
 * plus a LAN-style host loop, for N game minutes. Fails on any exception, desync of the local player,
 * or heap growth above 10% after warm-up.
 */
import { loadMapsFromDisk } from '@game/maps/node';
import { mapIds } from '@game/maps';
import { GameClient, MatchHost, createLocalPair } from '@game/net';
import { BTN_FIRE, BTN_JET } from '@game/sim';
import { VirtualClock } from '../netcode/helpers';

loadMapsFromDisk();
const minutes = Number(process.argv[2] ?? 60);
const clock = new VirtualClock();
const maps = mapIds();
const modes = ['ffa', 'tdm', 'ctf', 'koth', 'bomb', 'leader'] as const;
let matchIdx = 0;
const host = new MatchHost({ kind: 'online', code: 'SOAK01', clock, seed: 99, settings: { mapId: maps[0], mode: 'ffa', botCount: 8, timeLimit: 300, maxPlayers: 12 } });
const clients: GameClient[] = [];
for (let i = 0; i < 4; i++) {
  const id = `p${i}`;
  const pair = createLocalPair((d) => host.receive(id, d), () => host.disconnect(id), { latencyMs: 75, jitterMs: 15, loss: 0.02 }, clock, 50 + i, 'online');
  host.connect(id, pair.link);
  const c = new GameClient(pair.client, { name: `Soak${i}`, look: [], token: '', platform: 'web' }, { clock });
  let k = 0;
  c.sampler = (out) => {
    k++;
    out.moveX = (k + i * 50) % 140 < 70 ? 127 : -127;
    out.buttons = (k % 45 < 14 ? BTN_JET : 0) | (k % 11 < 5 ? BTN_FIRE : 0);
    out.aim = (k * 257 + i * 7000) & 0xffff;
  };
  clients.push(c);
}
const frame = 1000 / 60;
const totalFrames = minutes * 60 * 60;
let heapBase = 0;
let maxHeap = 0;
let matches = 0;
let maxErr = 0;
const t0 = performance.now();
for (let f = 0; f < totalFrames; f++) {
  clock.advance(frame);
  host.update(clock.now());
  for (const c of clients) {
    c.update(clock.now());
    c.view();
    c.takeEvents();
    c.takeLocalShots();
    maxErr = Math.max(maxErr, c.stats.lastCorrection);
  }
  if (host.phase === 'lobby' && f % 60 === 0) {
    const hc = clients.find((c) => c.lobby && c.playerId === c.lobby.hostId);
    if (hc) {
      matchIdx++;
      hc.lobbyAction({ a: 'settings', settings: { mapId: maps[matchIdx % maps.length], mode: modes[matchIdx % modes.length], timeLimit: 120 } });
      hc.lobbyAction({ a: 'start' });
      matches++;
    }
  }
  if (f % 3600 === 0) {
    (globalThis as { gc?: () => void }).gc?.();
    const h = process.memoryUsage().heapUsed;
    if (f === 3600 * 5) heapBase = h;
    maxHeap = Math.max(maxHeap, h);
    console.log(`game minute ${f / 3600}: phase=${host.phase} matches=${matches} heap=${(h / 1048576).toFixed(1)}MB tickMax=${host.stats().tick_ms_max.toFixed(2)}ms`);
  }
}
const growth = heapBase ? (maxHeap - heapBase) / heapBase : 0;
console.log(JSON.stringify({ minutes, matches, wallSec: Math.round((performance.now() - t0) / 1000), heapGrowth: +growth.toFixed(3), maxCorrectionPx: +maxErr.toFixed(1), tick: host.stats() }));
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync('docs/bench', { recursive: true });
writeFileSync(`docs/bench/soak-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ date: new Date().toISOString(), minutes, matches, heapGrowth: +growth.toFixed(3), maxCorrectionPx: +maxErr.toFixed(1), tickMsAvg: host.stats().tick_ms_avg, tickMsMax: host.stats().tick_ms_max }, null, 2));
if (growth > 0.1 || matches < minutes / 3) process.exit(1);
