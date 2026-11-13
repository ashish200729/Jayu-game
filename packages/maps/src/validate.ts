import { TILE } from '@game/content';
import { Tile, type MapData } from './types';

export interface MapReport {
  id: string;
  errors: string[];
  warnings: string[];
  stats: { spawns: number; red: number; blue: number; reachableCells: number; pickups: number };
}

function blocksBody(t: number): boolean {
  return t === Tile.Solid || t === Tile.Ice || t === Tile.Lava;
}
function isFloor(t: number): boolean {
  return t === Tile.Solid || t === Tile.Ice || t === Tile.OneWay;
}

/**
 * Enforces the map design rules: closed borders, enough spawns per side, objective markers,
 * pickups, and that every spawn/objective/pickup is reachable by a jetpacking player (1x2 tiles).
 */
export function validateMap(map: MapData): MapReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { width: w, height: h, tiles } = map;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? Tile.Solid : tiles[y * w + x]);
  if (w < 30 || h < 20) errors.push(`map too small (${w}x${h})`);
  if (w > 140 || h > 90) errors.push(`map too large (${w}x${h})`);
  for (let x = 0; x < w; x++) {
    if (at(x, 0) !== Tile.Solid) errors.push(`top border open at x=${x}`);
    const b = at(x, h - 1);
    if (b !== Tile.Solid && b !== Tile.Lava && b !== Tile.Ice) errors.push(`bottom border open at x=${x}`);
  }
  for (let y = 0; y < h; y++) {
    if (at(0, y) !== Tile.Solid) errors.push(`left border open at y=${y}`);
    if (at(w - 1, y) !== Tile.Solid) errors.push(`right border open at y=${y}`);
  }
  const spawns = map.objects.filter((o) => o.kind === 'spawn');
  const half = (w * TILE) / 2;
  const red = spawns.filter((s) => s.team === 0 || (s.team === -1 && s.x < half)).length;
  const blue = spawns.filter((s) => s.team === 1 || (s.team === -1 && s.x >= half)).length;
  if (spawns.length < 8) errors.push(`needs at least 8 spawns, has ${spawns.length}`);
  if (red < 4 || blue < 4) errors.push(`needs at least 4 spawns per side (red ${red}, blue ${blue})`);
  const flags = map.objects.filter((o) => o.kind === 'flag');
  if (flags.filter((f) => f.team === 0).length !== 1 || flags.filter((f) => f.team === 1).length !== 1)
    errors.push('needs exactly one red flag (R) and one blue flag (U)');
  if (map.objects.filter((o) => o.kind === 'hill').length < 2) errors.push('needs at least 2 hill markers (H)');
  const count = (k: string) => map.objects.filter((o) => o.kind === k).length;
  if (count('weapon') < 3) errors.push('needs at least 3 weapon spawners (W)');
  if (count('heavy') < 1) errors.push('needs at least 1 heavy spawner (X)');
  if (count('health') < 2) errors.push('needs at least 2 health packs (+)');
  if (count('grenade') < 1) errors.push('needs at least 1 grenade box (g)');

  // Reachability flood fill over body positions (feet cell x,y + head cell x,y-1).
  const canStand = (x: number, y: number) => !blocksBody(at(x, y)) && !blocksBody(at(x, y - 1));
  const seen = new Uint8Array(w * h);
  const start = spawns[0];
  let reachable = 0;
  if (start) {
    const sx = Math.floor(start.x / TILE);
    const sy = Math.floor((start.y - 1) / TILE);
    const stack: number[] = [];
    if (canStand(sx, sy)) {
      stack.push(sy * w + sx);
      seen[sy * w + sx] = 1;
    } else errors.push(`first spawn at ${sx},${sy} is blocked`);
    while (stack.length) {
      const i = stack.pop()!;
      reachable++;
      const x = i % w;
      const y = (i - x) / w;
      const nb = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 1 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (seen[j] || !canStand(nx, ny)) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  for (const o of map.objects) {
    const ox = Math.floor(o.x / TILE);
    const oy = Math.floor((o.y - 1) / TILE);
    if (blocksBody(at(ox, oy))) {
      errors.push(`${o.kind} at ${ox},${oy} is inside a wall`);
      continue;
    }
    // Objects one tile tall can sit under a low ceiling; check the cell or the cell below as a body position.
    const ok = seen[oy * w + ox] || (oy + 1 < h && seen[(oy + 1) * w + ox]);
    if (!ok) errors.push(`${o.kind} at ${ox},${oy} is unreachable`);
    if (o.kind === 'spawn') {
      let floor = false;
      for (let k = 1; k <= 3; k++) {
        const t = at(ox, oy + k);
        if (t === Tile.Lava) break;
        if (isFloor(t)) {
          floor = true;
          break;
        }
      }
      if (!floor) errors.push(`spawn at ${ox},${oy} has no floor within 3 tiles`);
    }
  }
  for (const m of map.movers) {
    if (m.period <= 0) errors.push(`${m.kind} at ${m.x},${m.y} has no period`);
    if (m.kind !== 'platform' && (m.openTime <= 0 || m.openTime >= m.period))
      errors.push(`${m.kind} at ${m.x},${m.y} openTime must be within its period`);
  }
  const passable = tiles.reduce((n, t) => n + (blocksBody(t) ? 0 : 1), 0);
  if (reachable < passable * 0.6) warnings.push(`only ${reachable}/${passable} open cells reachable`);
  return {
    id: map.id,
    errors,
    warnings,
    stats: { spawns: spawns.length, red, blue, reachableCells: reachable, pickups: map.objects.length - spawns.length },
  };
}
