import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMapFiles } from './registry';

/** Load all .tmj maps from disk (for Node scripts that don't run through Vite). */
export function loadMapsFromDisk(): void {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../tmj');
  const rec: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (f.endsWith('.tmj')) rec[f] = readFileSync(join(dir, f), 'utf8');
  registerMapFiles(rec);
}
