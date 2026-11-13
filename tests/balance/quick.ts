import { loadMapsFromDisk } from '@game/maps/node';
import { mapIds } from '@game/maps';
import { Sim, defaultConfig } from '@game/sim';
import { BotDirector } from '@game/bots';
loadMapsFromDisk();
const mode = (process.argv[2] ?? 'ffa') as any;
const secs = Number(process.argv[3] ?? 120);
for (const mapId of mapIds()) {
  const sim = new Sim(defaultConfig({ mapId, mode, seed: 7, timeLimit: secs }));
  for (let i = 0; i < 6; i++) sim.addPlayer({ name: `Bot${i}`, isBot: true, difficulty: 1 });
  const bots = new BotDirector(7);
  const t0 = performance.now();
  let firstKill = -1;
  while (!sim.isOver() && sim.tick < 60 * (secs + 10)) {
    bots.update(sim);
    sim.step();
    if (firstKill < 0 && sim.events.some((e) => e.type === 4)) firstKill = sim.tick;
  }
  const r = sim.results();
  console.log(mapId.padEnd(18), 'ticks', sim.tick, 'ms', (performance.now() - t0).toFixed(0), 'firstKill', (firstKill / 60).toFixed(1) + 's', 'kills', r.players.map((p) => p.kills).join(','), 'teams', r.teamScores.join(':'), 'acc', r.players.map((p) => p.accuracy.toFixed(2)).join(','));
}
