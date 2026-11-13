/**
 * npm run bench — plays a scripted 12-player match (1 measured client + 11 bots) on a fixed seed through
 * the real MatchHost/GameClient stack with 150 ms RTT, and writes a JSON report to docs/bench/.
 * Measures: sim tick cost, host tick cost, client per-frame cost, snapshot size and bandwidth, memory.
 * Rendering FPS must be measured on devices (see docs/QA_CHECKLIST.md); this covers the CPU-side budget.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadMapsFromDisk } from '@game/maps/node';
import { GameClient, MatchHost, createLocalPair } from '@game/net';
import { BTN_FIRE, BTN_JET } from '@game/sim';
import { VirtualClock } from '../netcode/helpers';

loadMapsFromDisk();
const mapId = process.argv[2] ?? 'rooftop-dusk';
const seconds = Number(process.argv[3] ?? 120);
const clock = new VirtualClock();
const host = new MatchHost({ kind: 'online', code: 'BENCH1', clock, seed: 2026, settings: { mapId, mode: 'ffa', botCount: 11, timeLimit: 600, scoreLimit: 500, maxPlayers: 12 } });
const pair = createLocalPair((d) => host.receive('c', d), () => host.disconnect('c'), { latencyMs: 75, jitterMs: 15, loss: 0.02 }, clock, 7, 'online');
host.connect('c', pair.link);
const client = new GameClient(pair.client, { name: 'Bench', look: [], token: '', platform: 'web' }, { clock });
let k = 0;
client.sampler = (out) => {
  k++;
  out.moveX = k % 160 < 80 ? 127 : -127;
  out.buttons = (k % 50 < 15 ? BTN_JET : 0) | (k % 9 < 4 ? BTN_FIRE : 0);
  out.aim = (k * 311) & 0xffff;
};
const frame = 1000 / 60;
const step = () => {
  clock.advance(frame);
  host.update(clock.now());
  client.update(clock.now());
  return client.view();
};
for (let i = 0; i < 60; i++) step();
client.lobbyAction({ a: 'start' });
for (let i = 0; i < 180; i++) step();
const clientFrame: number[] = [];
const down0 = pair.down.bytes;
const up0 = pair.up.bytes;
const msgs0 = pair.down.messages;
const mem0 = process.memoryUsage().heapUsed;
const t0 = performance.now();
for (let i = 0; i < seconds * 60; i++) {
  clock.advance(frame);
  host.update(clock.now());
  const c0 = performance.now();
  client.update(clock.now());
  client.view();
  client.takeEvents();
  clientFrame.push(performance.now() - c0);
}
const wall = performance.now() - t0;
const pct = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(a.length * p)];
const st = host.stats();
const report = {
  date: new Date().toISOString(),
  node: process.version,
  map: mapId,
  players: host.sim!.players.length,
  simulatedSeconds: seconds,
  wallMs: Math.round(wall),
  host: { tickMsAvg: +st.tick_ms_avg.toFixed(3), tickMsMax: +st.tick_ms_max.toFixed(3), overruns: st.overruns, budgetMs: 8 },
  client: { frameMsAvg: +(clientFrame.reduce((a, b) => a + b, 0) / clientFrame.length).toFixed(3), frameMsP99: +pct(clientFrame, 0.99).toFixed(3) },
  network: {
    conditions: '150ms RTT, 30ms jitter, 2% loss',
    downBytesPerSec: Math.round((pair.down.bytes - down0) / seconds),
    upBytesPerSec: Math.round((pair.up.bytes - up0) / seconds),
    avgSnapshotBytes: Math.round((pair.down.bytes - down0) / Math.max(1, pair.down.messages - msgs0)),
    budgetDown: 12 * 1024,
    budgetUp: 4 * 1024,
    corrections: client.stats.correctionsPerSec,
  },
  memoryMbDelta: +((process.memoryUsage().heapUsed - mem0) / 1048576).toFixed(1),
};
console.log(JSON.stringify(report, null, 2));
mkdirSync('docs/bench', { recursive: true });
writeFileSync(`docs/bench/bench-${report.date.slice(0, 10)}.json`, JSON.stringify(report, null, 2));
const ok = report.network.downBytesPerSec < report.network.budgetDown && report.network.upBytesPerSec < report.network.budgetUp && report.host.tickMsAvg < 8;
if (!ok) process.exit(1);
