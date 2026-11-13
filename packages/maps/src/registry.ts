import { loadTmj, type Tmj } from './load';
import type { MapData } from './types';

const files = new Map<string, string>();

/** Register raw .tmj file contents by map id. */
export function registerMapFiles(record: Record<string, string>): void {
  for (const [path, text] of Object.entries(record)) {
    const id = path.split('/').pop()!.replace(/\.tmj$/, '');
    files.set(id, text);
  }
}

// Under Vite (web app, server build, Vitest) the maps are bundled at build time.
// Plain Node scripts call loadMapsFromDisk() from '@game/maps/node' instead.
if (import.meta.env) {
  registerMapFiles(import.meta.glob('../tmj/*.tmj', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
}

/** Display order of maps in menus. */
export const MAP_ORDER = [
  'training-grounds',
  'rooftop-dusk',
  'jungle-temple',
  'snow-outpost',
  'desert-canyon',
  'orbital-station',
  'shipyard',
  'underground-lab',
  'volcano-base',
  'haunted-fortress',
];

export function mapIds(): string[] {
  return MAP_ORDER.filter((id) => files.has(id)).concat([...files.keys()].filter((id) => !MAP_ORDER.includes(id)).sort());
}

const cache = new Map<string, MapData>();
export function getMap(id: string): MapData {
  let m = cache.get(id);
  if (!m) {
    const text = files.get(id);
    if (!text) throw new Error(`Unknown map ${id}`);
    m = loadTmj(JSON.parse(text) as Tmj);
    cache.set(id, m);
  }
  return m;
}

export function hasMap(id: string): boolean {
  return files.has(id);
}
