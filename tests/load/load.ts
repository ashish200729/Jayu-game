/**
 * npm run load -- [rooms=40] [seconds=60]
 * Starts the built server (apps/server/dist) in a child process and opens N private rooms with
 * 1 networked client + 5 bots each (6 players per room). Reports server CPU, memory and tick timing.
 */
import { spawn } from 'node:child_process';
import { GameClient } from '@game/net';
import { connectOnline } from '@game/net/online';
import { BTN_FIRE, BTN_JET } from '@game/sim';
import { loadMapsFromDisk } from '@game/maps/node';

loadMapsFromDisk();

const rooms = Number(process.argv[2] ?? 40);
const seconds = Number(process.argv[3] ?? 60);
const port = 28000 + Math.floor(Math.random() * 1000);
const server = spawn(process.execPath, ['apps/server/dist/main.js'], { env: { ...process.env, PORT: String(port), LOG_LEVEL: 'quiet', DATA_DIR: `/tmp/jayu-load-${port}` }, stdio: 'inherit' });
const url = `ws://127.0.0.1:${port}`;
const http = `http://127.0.0.1:${port}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${http}/health`)).ok) break;
  } catch {
    await sleep(200);
  }
}
const clients: GameClient[] = [];
const maps = ['rooftop-dusk', 'jungle-temple', 'snow-outpost', 'desert-canyon', 'orbital-station', 'shipyard', 'underground-lab', 'volcano-base', 'haunted-fortress'];
for (let r = 0; r < rooms; r++) {
  const conn = await connectOnline(url, { kind: 'create', region: 'ap-south', settings: { mapId: maps[r % maps.length], mode: r % 2 ? 'tdm' : 'ffa', botCount: 5, timeLimit: 600, scoreLimit: 500 } });
  const c = new GameClient(conn.transport, { name: `Load${r}`, look: [], token: '', platform: 'web' });
  let k = 0;
  c.sampler = (out) => {
    k++;
    out.moveX = k % 120 < 60 ? 127 : -127;
    out.buttons = (k % 40 < 12 ? BTN_JET : 0) | (k % 10 < 4 ? BTN_FIRE : 0);
    out.aim = (k * 300) & 0xffff;
  };
  clients.push(c);
}
const pump = setInterval(() => clients.forEach((c) => c.update()), 16);
await sleep(1500);
clients.forEach((c) => c.lobbyAction({ a: 'start' }));
await sleep(5000);
const playing = clients.filter((c) => c.status === 'playing').length;
const m0 = await (await fetch(`${http}/metrics`)).json();
const t0 = Date.now();
await sleep(seconds * 1000);
const m1 = await (await fetch(`${http}/metrics`)).json();
const wall = (Date.now() - t0) * 1000;
const cpu = (m1.cpu.user + m1.cpu.system - m0.cpu.user - m0.cpu.system) / wall;
const report = {
  rooms,
  playersPerRoom: 6,
  clientsPlaying: playing,
  seconds,
  serverCpuCores: +cpu.toFixed(3),
  serverRssMb: m1.rssMb,
  bytesOutPerSec: Math.round((m1.bytesOut - m0.bytesOut) / seconds),
  errors: m1.errors,
};
console.log(JSON.stringify(report));
const { mkdirSync, writeFileSync } = await import('node:fs');
mkdirSync('docs/bench', { recursive: true });
writeFileSync(`docs/bench/load-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ date: new Date().toISOString(), budget: '>= 40 six-player rooms on 2 vCPU', cpuCoresAvailable: (await import('node:os')).cpus().length, ...report }, null, 2));
clearInterval(pump);
clients.forEach((c) => c.leave());
server.kill('SIGKILL');
process.exit(playing === rooms && cpu < 2 ? 0 : 1);
