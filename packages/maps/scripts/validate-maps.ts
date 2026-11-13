import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTmj, type Tmj } from '../src/load';
import { validateMap } from '../src/validate';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../tmj');
let failed = false;
const files = readdirSync(dir).filter((f) => f.endsWith('.tmj'));
for (const f of files) {
  const map = loadTmj(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Tmj);
  const r = validateMap(map);
  if (r.errors.length) {
    failed = true;
    console.error(`✗ ${f}: ${r.errors.join('; ')}`);
  } else console.log(`✓ ${f} (${r.stats.spawns} spawns, ${r.stats.pickups} pickups, ${r.stats.reachableCells} reachable cells)`);
}
console.log(`${files.length} maps checked`);
if (failed || files.length === 0) process.exit(1);
