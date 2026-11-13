import { TICK_RATE, TILE } from '@game/content';
import { Tile, type MapData, type Mover } from '@game/maps';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Static map + time-driven movers. Every mover is a pure function of the tick, so clients
 * can compute door/bridge/platform positions themselves for prediction and rendering.
 */
export class World {
  readonly map: MapData;
  readonly w: number;
  readonly h: number;
  readonly pxW: number;
  readonly pxH: number;
  readonly tiles: Uint8Array;
  readonly movers: Mover[];
  readonly gravityMult: number;

  constructor(map: MapData, lowGravity = false) {
    this.map = map;
    this.w = map.width;
    this.h = map.height;
    this.pxW = map.width * TILE;
    this.pxH = map.height * TILE;
    this.tiles = map.tiles;
    this.movers = map.movers;
    this.gravityMult = lowGravity ? 0.45 : 1;
  }

  tileAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return Tile.Solid;
    return this.tiles[ty * this.w + tx];
  }

  tileAtPx(x: number, y: number): number {
    return this.tileAt(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  static isSolidTile(t: number): boolean {
    return t === Tile.Solid || t === Tile.Ice;
  }

  /** Whether a door/bridge mover is currently solid. */
  moverSolid(m: Mover, tick: number): boolean {
    if (m.kind === 'platform') return true;
    const t = (tick / TICK_RATE + m.phase) % m.period;
    if (m.kind === 'door') return t >= m.openTime; // open during [0, openTime)
    return t < m.period - m.openTime; // bridge collapsed during the last openTime seconds
  }

  /** Door/bridge state fraction for rendering: 1 = fully solid/closed. */
  moverClosedness(m: Mover, tick: number): number {
    const t = (tick / TICK_RATE + m.phase) % m.period;
    const ramp = 0.35;
    if (m.kind === 'door') {
      if (t < m.openTime) return t < ramp ? 1 - t / ramp : t > m.openTime - ramp ? 1 - (m.openTime - t) / ramp : 0;
      return 1;
    }
    if (m.kind === 'bridge') {
      const down = m.period - m.openTime;
      if (t >= down) return 0;
      if (t > down - 1.2) return 0.5; // warning wobble
      return 1;
    }
    return 1;
  }

  /** Platform offset at a tick (smooth ping-pong between 0 and (dx,dy)). */
  platformOffset(m: Mover, tick: number, out: { x: number; y: number }): void {
    const s = ((tick / TICK_RATE + m.phase) / m.period) % 1;
    const f = s < 0.5 ? s * 2 : 2 - s * 2;
    const e = f * f * (3 - 2 * f);
    out.x = Math.round(m.dx * e * 8) / 8;
    out.y = Math.round(m.dy * e * 8) / 8;
  }

  /** Point inside a solid (tiles + closed doors/bridges). */
  solidAtPoint(x: number, y: number, tick: number): boolean {
    if (World.isSolidTile(this.tileAtPx(x, y))) return true;
    for (const m of this.movers) {
      if (m.kind === 'platform') continue;
      if (x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h && this.moverSolid(m, tick)) return true;
    }
    return false;
  }

  /**
   * Ray vs solid world (tiles + closed doors/bridges). Returns the travelled fraction 0..1
   * of the segment before hitting a solid (1 = clear). Amanatides–Woo grid traversal.
   */
  raycast(x0: number, y0: number, x1: number, y1: number, tick: number): number {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let tx = Math.floor(x0 / TILE);
    let ty = Math.floor(y0 / TILE);
    const endX = Math.floor(x1 / TILE);
    const endY = Math.floor(y1 / TILE);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? Math.abs(TILE / dx) : Infinity;
    const tDeltaY = stepY !== 0 ? Math.abs(TILE / dy) : Infinity;
    let tMaxX = stepX > 0 ? ((tx + 1) * TILE - x0) / dx : stepX < 0 ? (tx * TILE - x0) / dx : Infinity;
    let tMaxY = stepY > 0 ? ((ty + 1) * TILE - y0) / dy : stepY < 0 ? (ty * TILE - y0) / dy : Infinity;
    let t: number;
    let best = 1;
    if (World.isSolidTile(this.tileAt(tx, ty))) return 0;
    let guard = 0;
    while (guard++ < 512) {
      if (tx === endX && ty === endY) break;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        tMaxX += tDeltaX;
        tx += stepX;
      } else {
        t = tMaxY;
        tMaxY += tDeltaY;
        ty += stepY;
      }
      if (t > 1) break;
      if (World.isSolidTile(this.tileAt(tx, ty))) {
        best = t;
        break;
      }
    }
    for (const m of this.movers) {
      if (m.kind === 'platform' || !this.moverSolid(m, tick)) continue;
      const mt = segmentRect(x0, y0, dx, dy, m.x, m.y, m.w, m.h);
      if (mt >= 0 && mt < best) best = mt;
    }
    return best < 0 ? 0 : best;
  }

  /** Line of sight between two points (true if clear). */
  los(x0: number, y0: number, x1: number, y1: number, tick: number): boolean {
    return this.raycast(x0, y0, x1, y1, tick) >= 0.999;
  }
}

/**
 * Segment (origin + t*d, t in 0..1) vs axis-aligned rect. Returns the entry t, or -1 if no hit.
 * If the origin starts inside the rect, returns 0.
 */
export function segmentRect(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number {
  let tmin = 0;
  let tmax = 1;
  if (dx === 0) {
    if (ox < rx || ox > rx + rw) return -1;
  } else {
    let t1 = (rx - ox) / dx;
    let t2 = (rx + rw - ox) / dx;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (dy === 0) {
    if (oy < ry || oy > ry + rh) return -1;
  } else {
    let t1 = (ry - oy) / dy;
    let t2 = (ry + rh - oy) / dy;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
