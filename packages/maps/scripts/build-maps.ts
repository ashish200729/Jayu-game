import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileSource, toTmj } from '../src/compile';
import { validateMap } from '../src/validate';
import type { MapSource } from '../src/types';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '../src/sources');
const outDir = join(here, '../tmj');
mkdirSync(outDir, { recursive: true });
let failed = false;
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.ts') && !f.startsWith('_')).sort()) {
  const mod = (await import(pathToFileURL(join(srcDir, f)).href)) as { default: MapSource };
  const map = compileSource(mod.default);
  const report = validateMap(map);
  if (report.errors.length) {
    failed = true;
    console.error(`✗ ${map.id}\n  ${report.errors.slice(0, 20).join('\n  ')}`);
  } else {
    console.log(`✓ ${map.id} ${map.width}x${map.height} spawns=${report.stats.spawns} pickups=${report.stats.pickups}`);
  }
  for (const wmsg of report.warnings) console.warn(`  ! ${wmsg}`);
  writeFileSync(join(outDir, `${map.id}.tmj`), JSON.stringify(toTmj(map)));
}
if (failed) process.exit(1);
