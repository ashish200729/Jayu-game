/**
 * npm run balance -- [matchesPerMap=200] [mode=tdm] [seconds=180]
 * Bot-vs-bot runs: team win rate per map (target 45–55%), weapon usage, time to first engagement,
 * and spawn-kill detection (deaths within 3 s of spawning).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { WEAPONS } from '@game/content';
import { loadMapsFromDisk } from '@game/maps/node';
import { mapIds } from '@game/maps';
import { BotDirector } from '@game/bots';
import { EventType, Sim, defaultConfig } from '@game/sim';
import type { ModeId } from '@game/content';

loadMapsFromDisk();
const N = Number(process.argv[2] ?? 200);
const mode = (process.argv[3] ?? 'tdm') as ModeId;
const secs = Number(process.argv[4] ?? 180);
const out: Record<string, unknown> = {};
const weaponKills: Record<string, number> = {};
let fail = false;
const only = process.argv[5];
for (const mapId of mapIds().filter((m) => !only || only.split(',').includes(m))) {
  let red = 0;
  let blue = 0;
  let draws = 0;
  let firstKillSum = 0;
  let spawnKills = 0;
  let kills = 0;
  for (let m = 0; m < N; m++) {
    const sim = new Sim(defaultConfig({ mapId, mode, seed: 1000 + m, timeLimit: secs, botDifficulty: 1 }));
    for (let i = 0; i < 6; i++) sim.addPlayer({ name: `B${i}`, isBot: true, difficulty: 1 });
    const bots = new BotDirector(m);
    const spawnAt = new Map<number, number>();
    let first = -1;
    while (!sim.isOver() && sim.tick < (secs + 10) * 60) {
      bots.update(sim);
      sim.step();
      for (const e of sim.events) {
        if (e.type === EventType.Spawn) spawnAt.set(e.d[0], sim.tick);
        if (e.type === EventType.Kill) {
          kills++;
          if (first < 0) first = sim.tick;
          if (sim.tick - (spawnAt.get(e.d[0]) ?? -1e9) < 180) spawnKills++;
          const code = e.d[2];
          const key = code < WEAPONS.length ? WEAPONS[code].id : `special:${code}`;
          weaponKills[key] = (weaponKills[key] ?? 0) + 1;
        }
      }
    }
    const r = sim.results();
    if (r.winnerTeam === 0) red++;
    else if (r.winnerTeam === 1) blue++;
    else draws++;
    firstKillSum += first > 0 ? first / 60 : secs;
  }
  const decided = red + blue;
  const redRate = decided ? red / decided : 0.5;
  const ok = redRate >= 0.45 && redRate <= 0.55;
  if (!ok && N >= 100) fail = true;
  out[mapId] = { red, blue, draws, redWinRate: +redRate.toFixed(3), withinTarget: ok, avgFirstKillSec: +(firstKillSum / N).toFixed(1), spawnKillRate: +(spawnKills / Math.max(1, kills)).toFixed(3) };
  console.log(mapId.padEnd(18), JSON.stringify(out[mapId]));
}
const unused = WEAPONS.filter((w) => !weaponKills[w.id]).map((w) => w.id);
const report = { date: new Date().toISOString(), mode, matchesPerMap: N, seconds: secs, maps: out, weaponKills, unusedWeapons: unused };
console.log('weapon kills', JSON.stringify(weaponKills), 'unused:', unused.join(',') || 'none');
mkdirSync('docs/bench', { recursive: true });
writeFileSync(`docs/bench/balance-${mode}-${report.date.slice(0, 10)}.json`, JSON.stringify(report, null, 2));
if (fail) process.exit(1);
