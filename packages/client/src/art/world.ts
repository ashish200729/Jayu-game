import type Phaser from 'phaser';
import { GRENADES, TILE } from '@game/content';
import { Tile, type Backdrop, type MapData } from '@game/maps';
import { block, canvas, hex, lineOf, mix, paint, roundRect, seededRandom, shade, tint } from './draw';

/** Chunk size in world pixels. Textures are CHUNK * resolution. */
export const CHUNK = 512;
/** Resolution of small shared sprites (pickups, projectiles, flags, reticle). Consumers scale by 1/SPR. */
export const SPR = 3;

type Material = 'rock' | 'brick' | 'metal';
type Cap = 'grass' | 'snow' | 'sand' | 'magma' | 'ledge' | 'neon' | 'dock' | 'moss';

const MATERIAL: Record<Backdrop, Material> = {
  city: 'brick',
  fortress: 'brick',
  harbor: 'metal',
  lab: 'metal',
  space: 'metal',
  jungle: 'rock',
  training: 'rock',
  snow: 'rock',
  desert: 'rock',
  volcano: 'rock',
};
const CAP: Record<Backdrop, Cap> = {
  city: 'ledge',
  fortress: 'moss',
  harbor: 'dock',
  lab: 'neon',
  space: 'neon',
  jungle: 'grass',
  training: 'grass',
  snow: 'snow',
  desert: 'sand',
  volcano: 'magma',
};

function hash(x: number, y: number, s = 0): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Renders the static tile layer of a map into chunk textures at `res` x resolution.
 * Returns chunk keys + world positions; display each with setScale(1 / res).
 */
export function buildMapChunks(scene: Phaser.Scene, map: MapData, res = 1): { key: string; x: number; y: number; res: number }[] {
  const out: { key: string; x: number; y: number; res: number }[] = [];
  const pxW = map.width * TILE;
  const pxH = map.height * TILE;
  const th = map.theme;
  const W = map.width;
  const H = map.height;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? Tile.Solid : map.tiles[y * W + x]);
  const isSolid = (t: number) => t === Tile.Solid || t === Tile.Ice;
  const solid = (x: number, y: number) => isSolid(at(x, y));
  // Distance (in tiles) from each solid tile to the nearest open tile: drives interior depth shading.
  const dist = new Uint8Array(W * H);
  const q: number[] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!solid(x, y)) continue;
      const edge = !solid(x - 1, y) || !solid(x + 1, y) || !solid(x, y - 1) || !solid(x, y + 1);
      if (edge) {
        dist[y * W + x] = 1;
        q.push(y * W + x);
      }
    }
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    const x = p % W;
    const y = (p - x) / W;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const n = ny * W + nx;
      if (solid(nx, ny) && dist[n] === 0) {
        dist[n] = Math.min(8, dist[p] + 1);
        q.push(n);
      }
    }
  }
  const depthOf = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 8 : dist[y * W + x] || 8);
  const mat = MATERIAL[th.backdrop];
  const cap = CAP[th.backdrop];
  const R = 7;
  // Gradients are pre-rendered once as small stamps and blitted per tile (creating thousands of canvas
  // gradients per map was the dominant load-time cost on phones).
  const stamps = new Map<string, HTMLCanvasElement>();
  const stamp = (key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement => {
    let st = stamps.get(key);
    if (!st) {
      const [sc, sg] = canvas(w * res, h * res);
      sg.scale(res, res);
      draw(sg);
      stamps.set(key, (st = sc));
    }
    return st;
  };
  const vgrad = (key: string, w: number, h: number, stops: [number, string][], horizontal = false) =>
    stamp(key, w, h, (g) => {
      const gr = horizontal ? g.createLinearGradient(0, 0, w, 0) : g.createLinearGradient(0, 0, 0, h);
      for (const [o, c] of stops) gr.addColorStop(o, c);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  const shTop = vgrad('shTop', TILE, TILE, [
    [0, 'rgba(0,0,0,0.34)'],
    [0.9, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0)'],
  ]);
  const shL = vgrad('shL', 12, TILE, [
    [0, 'rgba(0,0,0,0.2)'],
    [1, 'rgba(0,0,0,0)'],
  ], true);
  const shR = vgrad('shR', 12, TILE, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.2)'],
  ], true);
  const litTop = vgrad('litTop', TILE, 10, [
    [0, 'rgba(255,255,255,0.22)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const litL = vgrad('litL', 6, TILE, [
    [0, 'rgba(255,255,255,0.14)'],
    [1, 'rgba(255,255,255,0)'],
  ], true);
  const darkR = vgrad('darkR', 8, TILE, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.3)'],
  ], true);
  const darkB = vgrad('darkB', TILE, 10, [
    [0, 'rgba(0,0,0,0)'],
    [1, 'rgba(0,0,0,0.38)'],
  ]);
  const depthStamp = (ice: boolean, d: number) => {
    const base = ice ? 0xbfe8ff : th.solid;
    const dark = ice ? 0x6fa8cf : th.solidDark;
    const k = Math.min(1, (d - 1) / 4);
    return vgrad(`depth:${ice ? 1 : 0}:${d}`, TILE, TILE, [
      [0, hex(mix(base, dark, k * 0.85))],
      [1, hex(mix(base, dark, Math.min(1, k * 0.85 + 0.2)))],
    ]);
  };

  for (let cy = 0; cy < pxH; cy += CHUNK) {
    for (let cx = 0; cx < pxW; cx += CHUNK) {
      const key = `map2:${map.id}:${res}:${cx}:${cy}`;
      out.push({ key, x: cx, y: cy, res });
      if (scene.textures.exists(key)) continue;
      const w = Math.min(CHUNK, pxW - cx);
      const h = Math.min(CHUNK, pxH - cy);
      const [c, ctx] = canvas(w * res, h * res);
      ctx.scale(res, res);
      ctx.translate(-cx, -cy);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const tx0 = Math.floor(cx / TILE) - 1;
      const ty0 = Math.floor(cy / TILE) - 1;
      const tx1 = Math.ceil((cx + w) / TILE) + 1;
      const ty1 = Math.ceil((cy + h) / TILE) + 1;
      const each = (fn: (tx: number, ty: number, x: number, y: number, t: number) => void) => {
        for (let ty = ty0; ty < ty1; ty++) for (let tx = tx0; tx < tx1; tx++) fn(tx, ty, tx * TILE, ty * TILE, at(tx, ty));
      };
      const radii = (tx: number, ty: number, r: number): [number, number, number, number] => {
        const o = (dx: number, dy: number) => !solid(tx + dx, ty + dy);
        return [o(-1, 0) && o(0, -1) ? r : 0, o(1, 0) && o(0, -1) ? r : 0, o(1, 0) && o(0, 1) ? r : 0, o(-1, 0) && o(0, 1) ? r : 0];
      };

      // 1. Cast shadows behind everything: under overhangs and in inside corners.
      each((tx, ty, x, y, t) => {
        if (isSolid(t)) return;
        if (solid(tx, ty - 1)) ctx.drawImage(shTop, x, y, TILE, TILE);
        if (solid(tx - 1, ty)) ctx.drawImage(shL, x, y, 12, TILE);
        if (solid(tx + 1, ty)) ctx.drawImage(shR, x + TILE - 12, y, 12, TILE);
      });

      // 2. Outline: the solid mask, slightly expanded, in the line colour.
      const outline = lineOf(th.solidDark);
      ctx.fillStyle = hex(outline);
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        ctx.beginPath();
        ctx.roundRect(x - 1.6, y - 1.6, TILE + 3.2, TILE + 3.2, radii(tx, ty, R + 1.6));
        ctx.fill();
      });

      // 3. Solid mask on a separate layer, then everything is painted "source-atop" (clipped to it).
      const [mc, m] = canvas(w * res, h * res);
      m.scale(res, res);
      m.translate(-cx, -cy);
      m.lineJoin = 'round';
      m.lineCap = 'round';
      m.fillStyle = '#fff';
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        m.beginPath();
        m.roundRect(x, y, TILE, TILE, radii(tx, ty, R));
        m.fill();
      });
      m.globalCompositeOperation = 'source-atop';
      // 3a. Depth shading: lighter near the surface, darker inside.
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        m.drawImage(depthStamp(t === Tile.Ice, depthOf(tx, ty)), x, y, TILE, TILE);
      });
      // 3b. Material pattern.
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        const d = depthOf(tx, ty);
        const fade = Math.max(0.25, 1 - (d - 1) * 0.18);
        if (t === Tile.Ice) {
          drawIce(m, x, y, tx, ty);
          return;
        }
        if (mat === 'brick') drawBrick(m, x, y, tx, ty, th.solid, fade, th.backdrop === 'fortress');
        else if (mat === 'metal') drawMetal(m, x, y, tx, ty, th.solid, fade, th.accent, th.backdrop === 'harbor');
        else drawRock(m, x, y, tx, ty, th.solid, fade);
      });
      // 3c. Directional edge light: lit top/left, shaded bottom/right.
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        if (!solid(tx, ty - 1)) m.drawImage(litTop, x, y, TILE, 10);
        if (!solid(tx - 1, ty)) m.drawImage(litL, x, y, 6, TILE);
        if (!solid(tx + 1, ty)) m.drawImage(darkR, x + TILE - 8, y, 8, TILE);
        if (!solid(tx, ty + 1)) m.drawImage(darkB, x, y + TILE - 10, TILE, 10);
      });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(mc, 0, 0);
      ctx.restore();

      // 4. Surface caps + overhang details, drawn over the outline.
      each((tx, ty, x, y, t) => {
        if (!isSolid(t)) return;
        const openUp = !solid(tx, ty - 1);
        const openDown = !solid(tx, ty + 1);
        const l = !solid(tx - 1, ty);
        const r = !solid(tx + 1, ty);
        if (openUp) drawCap(ctx, t === Tile.Ice ? 'snow' : cap, x, y, tx, ty, l, r, th.rim, th.solid);
        if (openDown) drawUnderside(ctx, cap, x, y, tx, ty, th.rim);
      });

      // 5. Special tiles.
      each((tx, ty, x, y, t) => {
        if (t === Tile.OneWay) drawOneWay(ctx, x, y, tx, ty, at(tx - 1, ty) !== Tile.OneWay, at(tx + 1, ty) !== Tile.OneWay, th.backdrop, th.solid, th.rim);
        else if (t === Tile.Vine) drawVine(ctx, x, y, tx, ty, at(tx, ty + 1) !== Tile.Vine);
        else if (t === Tile.Vent) drawVent(ctx, x, y, at(tx, ty + 1) !== Tile.Vent);
        else if (t === Tile.LowGrav) {
          ctx.fillStyle = 'rgba(170,130,255,0.07)';
          ctx.fillRect(x, y, TILE, TILE);
          if (hash(tx, ty, 9) > 0.8) {
            ctx.fillStyle = 'rgba(225,210,255,0.75)';
            ctx.beginPath();
            ctx.arc(x + hash(tx, ty, 1) * 28 + 2, y + hash(tx, ty, 2) * 28 + 2, 1.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
      scene.textures.addCanvas(key, c);
    }
  }
  return out;
}

// ------------------------------------------------------------------ materials

function drawBrick(m: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, base: number, fade: number, stone: boolean): void {
  const bh = 16;
  const mortar = hex(shade(base, 0.6), 0.85 * fade);
  for (let r = 0; r < 2; r++) {
    const row = ty * 2 + r;
    const yy = y + r * bh;
    const off = (row % 2) * 16 + (stone ? 8 : 0);
    // Brick tone variation: per brick id so the halves on neighbouring tiles match.
    for (let bx = -1; bx <= 1; bx++) {
      const brickX = Math.floor((x - off) / 32) + bx;
      const sx = brickX * 32 + off;
      const v = hash(brickX, row, 3);
      const x0 = Math.max(x, sx);
      const x1 = Math.min(x + TILE, sx + 32);
      if (x1 <= x0) continue;
      m.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * 0.12 * fade})` : `rgba(0,0,0,${(0.5 - v) * 0.2 * fade})`;
      m.fillRect(x0, yy, x1 - x0, bh);
      m.fillStyle = `rgba(255,255,255,${0.1 * fade})`;
      m.fillRect(x0, yy + 1.5, x1 - x0, 1.2);
      if (sx >= x && sx < x + TILE) {
        m.fillStyle = mortar;
        m.fillRect(sx - 0.8, yy, 1.6, bh);
      }
    }
    m.fillStyle = mortar;
    m.fillRect(x, yy - 0.8, TILE, 1.6);
  }
}

function drawMetal(m: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, base: number, fade: number, accent: number, harbor: boolean): void {
  const p = 1.5;
  m.fillStyle = `rgba(255,255,255,${0.16 * fade})`;
  m.fillRect(x + p, y + p, TILE - p * 2, 1.2);
  m.fillRect(x + p, y + p, 1.2, TILE - p * 2);
  m.fillStyle = `rgba(0,0,0,${0.32 * fade})`;
  m.fillRect(x + p, y + TILE - p - 1.2, TILE - p * 2, 1.2);
  m.fillRect(x + TILE - p - 1.2, y + p, 1.2, TILE - p * 2);
  m.fillStyle = hex(shade(base, 0.55), 0.7 * fade);
  m.fillRect(x, y, TILE, 0.8);
  m.fillRect(x, y, 0.8, TILE);
  for (const [rx, ry] of [
    [5, 5],
    [TILE - 5, 5],
    [5, TILE - 5],
    [TILE - 5, TILE - 5],
  ]) {
    m.fillStyle = `rgba(0,0,0,${0.35 * fade})`;
    m.beginPath();
    m.arc(x + rx + 0.4, y + ry + 0.5, 1.5, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = hex(tint(base, 0.35), fade);
    m.beginPath();
    m.arc(x + rx, y + ry, 1.2, 0, Math.PI * 2);
    m.fill();
  }
  const v = hash(tx, ty, 5);
  if (v > 0.86) {
    // Vent slots.
    for (let i = 0; i < 3; i++) {
      roundRect(m, x + 9, y + 10 + i * 5, 14, 2.4, 1.2);
      m.fillStyle = `rgba(0,0,0,${0.45 * fade})`;
      m.fill();
    }
  } else if (v < 0.07 && !harbor) {
    // Small status light.
    m.fillStyle = hex(accent, 0.9 * fade);
    m.beginPath();
    m.arc(x + 16, y + 16, 1.8, 0, Math.PI * 2);
    m.fill();
  } else if (harbor && v < 0.2) {
    // Rust streak.
    const g = m.createLinearGradient(0, y + 6, 0, y + TILE);
    g.addColorStop(0, `rgba(160,80,30,${0.35 * fade})`);
    g.addColorStop(1, 'rgba(160,80,30,0)');
    m.fillStyle = g;
    m.fillRect(x + 8 + v * 40, y + 6, 4, TILE - 6);
  }
}

function drawRock(m: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, base: number, fade: number): void {
  const n = 2 + Math.floor(hash(tx, ty, 1) * 2);
  for (let i = 0; i < n; i++) {
    const rx = x + 5 + hash(tx, ty, 10 + i) * 22;
    const ry = y + 5 + hash(tx, ty, 20 + i) * 22;
    const rw = 4 + hash(tx, ty, 30 + i) * 6;
    const rh = rw * (0.55 + hash(tx, ty, 40 + i) * 0.3);
    const rot = (hash(tx, ty, 50 + i) - 0.5) * 0.8;
    m.beginPath();
    m.ellipse(rx, ry + 1, rw, rh, rot, 0, Math.PI * 2);
    m.fillStyle = `rgba(0,0,0,${0.22 * fade})`;
    m.fill();
    m.beginPath();
    m.ellipse(rx, ry, rw, rh, rot, 0, Math.PI * 2);
    m.fillStyle = hex(tint(base, 0.06), 0.55 * fade);
    m.fill();
    m.beginPath();
    m.ellipse(rx - rw * 0.2, ry - rh * 0.35, rw * 0.55, rh * 0.32, rot, 0, Math.PI * 2);
    m.fillStyle = `rgba(255,255,255,${0.12 * fade})`;
    m.fill();
  }
  if (hash(tx, ty, 7) > 0.72) {
    m.strokeStyle = hex(shade(base, 0.55), 0.7 * fade);
    m.lineWidth = 1;
    m.beginPath();
    const sx = x + hash(tx, ty, 8) * 20 + 4;
    m.moveTo(sx, y + 2);
    m.lineTo(sx + 4, y + 11);
    m.lineTo(sx + 1, y + 19);
    m.lineTo(sx + 6, y + 27);
    m.stroke();
  }
  // Fine grain speckles.
  for (let i = 0; i < 4; i++) {
    m.fillStyle = hash(tx, ty, 60 + i) > 0.5 ? `rgba(255,255,255,${0.1 * fade})` : `rgba(0,0,0,${0.16 * fade})`;
    m.fillRect(x + hash(tx, ty, 70 + i) * 30, y + hash(tx, ty, 80 + i) * 30, 1.4, 1.4);
  }
}

function drawIce(m: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number): void {
  const g = m.createLinearGradient(x, y, x + TILE, y + TILE);
  g.addColorStop(0, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(60,120,180,0.18)');
  m.fillStyle = g;
  m.fillRect(x, y, TILE, TILE);
  m.strokeStyle = 'rgba(255,255,255,0.7)';
  m.lineWidth = 1.2;
  m.beginPath();
  const o = hash(tx, ty, 2) * 8;
  m.moveTo(x + 5 + o, y + 24);
  m.lineTo(x + 14 + o, y + 13);
  m.moveTo(x + 11 + o, y + 26);
  m.lineTo(x + 16 + o, y + 20);
  m.stroke();
}

// ------------------------------------------------------------------ surfaces

function drawCap(ctx: CanvasRenderingContext2D, cap: Cap, x: number, y: number, tx: number, ty: number, l: boolean, r: boolean, rim: number, solidC: number): void {
  const x0 = x + (l ? 1.5 : -0.5);
  const x1 = x + TILE + (r ? -1.5 : 0.5);
  const w = x1 - x0;
  switch (cap) {
    case 'grass': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 2.5, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 8, l || r ? 4 : 0, rim, { line: 0, hi: 0.8 });
      ctx.fillStyle = hex(shade(rim, 0.62));
      for (let i = 0; i < 6; i++) {
        const gx = x + 2 + i * 5.4 + hash(tx, ty, i) * 2;
        ctx.beginPath();
        ctx.moveTo(gx, y + 5.5);
        ctx.quadraticCurveTo(gx + 1.5, y + 8.5 + hash(tx, ty, i + 9) * 3, gx + 3, y + 5.5);
        ctx.fill();
      }
      for (let i = 0; i < 7; i++) {
        const gx = x + 1 + i * 4.8 + hash(tx, ty, 20 + i) * 2;
        const gh = 3 + hash(tx, ty, 30 + i) * 5;
        ctx.strokeStyle = hex(i % 2 ? tint(rim, 0.25) : shade(rim, 0.85));
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.quadraticCurveTo(gx + 0.6, y - gh * 0.6, gx + (hash(tx, ty, 40 + i) - 0.4) * 3, y - gh);
        ctx.stroke();
      }
      if (hash(tx, ty, 99) > 0.88) {
        const fx = x + 8 + hash(tx, ty, 98) * 16;
        ctx.fillStyle = hash(tx, ty, 97) > 0.5 ? '#ffe066' : '#ff8fb1';
        for (let k = 0; k < 5; k++) {
          ctx.beginPath();
          ctx.arc(fx + Math.cos((k / 5) * 6.28) * 1.6, y - 5 + Math.sin((k / 5) * 6.28) * 1.6, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(fx, y - 5, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'snow': {
      ctx.beginPath();
      const bump = 2.5 + hash(tx, ty, 1) * 2.5;
      ctx.moveTo(x0 - (l ? 2.5 : 0), y + 6);
      ctx.quadraticCurveTo(x0 - (l ? 3 : 0), y - bump, x + TILE * 0.5, y - bump - 0.5);
      ctx.quadraticCurveTo(x1 + (r ? 3 : 0), y - bump, x1 + (r ? 2.5 : 0), y + 6);
      ctx.closePath();
      paint(ctx, 0xffffff, y - bump, y + 6, { line: 1, outline: 0x7d97b5, hi: 0.3, lo: 0.4 });
      ctx.fillStyle = 'rgba(160,200,240,0.35)';
      ctx.fillRect(x0, y + 3.5, w, 2.5);
      if (hash(tx, ty, 3) > 0.7) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(x + 6 + hash(tx, ty, 4) * 20, y - bump + 1.5, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sand': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 1.5, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 6.5, l || r ? 3 : 0, rim, { line: 0, hi: 0.7 });
      ctx.strokeStyle = hex(shade(rim, 0.82));
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        const yy = y + 1 + i * 2.2;
        ctx.moveTo(x0 + 2, yy);
        ctx.quadraticCurveTo(x + 10, yy - 1.2, x + 16, yy);
        ctx.quadraticCurveTo(x + 22, yy + 1.2, x1 - 2, yy);
        ctx.stroke();
      }
      if (hash(tx, ty, 6) > 0.8) {
        ctx.beginPath();
        ctx.ellipse(x + 8 + hash(tx, ty, 7) * 16, y - 1, 2.6, 1.8, 0, 0, Math.PI * 2);
        paint(ctx, mix(solidC, 0xffffff, 0.2), y - 3, y + 1, { line: 0.8 });
      }
      break;
    }
    case 'magma': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 1.2, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 5, l || r ? 2.5 : 0, shade(solidC, 0.75), { line: 0, hi: 0.6 });
      const gx = x + 4 + hash(tx, ty, 2) * 20;
      const hot = hash(tx, ty, 3);
      if (hot > 0.55) {
        const gr = 6 + hot * 8;
        const g = ctx.createRadialGradient(gx, y + 2, 0, gx, y + 2, gr);
        g.addColorStop(0, hex(tint(rim, 0.4), 0.35 + (hot - 0.55) * 1.2));
        g.addColorStop(1, hex(rim, 0));
        ctx.fillStyle = g;
        ctx.fillRect(gx - gr, y + 2 - gr, gr * 2, gr * 2);
      }
      ctx.strokeStyle = hex(tint(rim, 0.3));
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(x0, y + 1.6);
      for (let i = 1; i <= 4; i++) ctx.lineTo(x0 + (w * i) / 4, y + 1 + hash(tx, ty, 10 + i) * 2.2);
      ctx.stroke();
      ctx.strokeStyle = hex(rim, 0.7);
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, y + 3);
      ctx.lineTo(gx + 3, y + 10);
      ctx.lineTo(gx + 1, y + 16);
      ctx.stroke();
      break;
    }
    case 'neon': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 1, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 5, l || r ? 2 : 0, tint(solidC, 0.12), { line: 0, hi: 0.8 });
      const g = ctx.createLinearGradient(0, y - 6, 0, y + 1);
      g.addColorStop(0, hex(rim, 0));
      g.addColorStop(1, hex(rim, 0.35));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y - 6, w, 7);
      ctx.fillStyle = hex(tint(rim, 0.55));
      ctx.fillRect(x0, y - 0.4, w, 1.6);
      if (hash(tx, ty, 4) > 0.8) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y + 1.5, w, 3);
        ctx.clip();
        ctx.fillStyle = '#1a1c22';
        ctx.fillRect(x0, y + 1.5, w, 3);
        ctx.fillStyle = '#ffcf3a';
        for (let i = -1; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 7, y + 4.5);
          ctx.lineTo(x + i * 7 + 3.5, y + 1.5);
          ctx.lineTo(x + i * 7 + 7, y + 1.5);
          ctx.lineTo(x + i * 7 + 3.5, y + 4.5);
          ctx.fill();
        }
        ctx.restore();
      }
      break;
    }
    case 'dock': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 1.5, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 6, 1, tint(solidC, 0.15), { line: 0.8, hi: 0.8 });
      if (l || r) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y - 1.5, w, 6);
        ctx.clip();
        ctx.fillStyle = hex(rim);
        for (let i = -1; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 8, y + 4.5);
          ctx.lineTo(x + i * 8 + 4, y - 1.5);
          ctx.lineTo(x + i * 8 + 8, y - 1.5);
          ctx.lineTo(x + i * 8 + 4, y + 4.5);
          ctx.fill();
        }
        ctx.restore();
      }
      if (hash(tx, ty, 2) > 0.75) {
        block(ctx, x + 10, y - 6, 8, 5, 2, 0x2a2f38, { line: 0.8 });
      }
      break;
    }
    case 'moss': {
      block(ctx, x0 - (l ? 1.5 : 0), y - 1.5, w + (l ? 1.5 : 0) + (r ? 1.5 : 0), 5, 1.5, tint(solidC, 0.18), { line: 0.8, hi: 0.8 });
      ctx.fillStyle = hex(mix(rim, 0x2a4a2a, 0.5), 0.9);
      for (let i = 0; i < 4; i++) {
        if (hash(tx, ty, i) < 0.45) continue;
        const mx = x + i * 8 + 2;
        ctx.beginPath();
        ctx.ellipse(mx + 2, y - 0.5, 3.2, 1.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(mx + 1.5, y, 1, 3 + hash(tx, ty, 10 + i) * 6);
      }
      break;
    }
    default: {
      // Concrete ledge with a lip that overhangs slightly.
      block(ctx, x0 - (l ? 2.5 : 0), y - 2, w + (l ? 2.5 : 0) + (r ? 2.5 : 0), 6, l || r ? 1.5 : 0, tint(solidC, 0.3), { line: 0.8, hi: 0.9 });
      ctx.fillStyle = hex(rim, 0.55);
      ctx.fillRect(x0, y - 2, w, 1.2);
    }
  }
}

function drawUnderside(ctx: CanvasRenderingContext2D, cap: Cap, x: number, y: number, tx: number, ty: number, rim: number): void {
  const by = y + TILE;
  const v = hash(tx, ty, 77);
  if (cap === 'snow' && v > 0.55) {
    // Icicles.
    for (let i = 0; i < 2; i++) {
      const ix = x + 6 + i * 14 + hash(tx, ty, 78 + i) * 6;
      const ih = 5 + hash(tx, ty, 80 + i) * 9;
      ctx.beginPath();
      ctx.moveTo(ix - 2.4, by - 0.5);
      ctx.lineTo(ix + 2.4, by - 0.5);
      ctx.lineTo(ix, by + ih);
      ctx.closePath();
      paint(ctx, 0xd8f1ff, by, by + ih, { line: 0.8, outline: 0x7d97b5 });
    }
  } else if ((cap === 'grass' || cap === 'moss') && v > 0.6) {
    // Hanging roots.
    ctx.strokeStyle = cap === 'moss' ? hex(mix(rim, 0x2a4a2a, 0.5), 0.9) : '#5a4a2c';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      const rx = x + 6 + i * 14 + hash(tx, ty, 90 + i) * 6;
      const rh = 6 + hash(tx, ty, 92 + i) * 12;
      ctx.beginPath();
      ctx.moveTo(rx, by - 1);
      ctx.quadraticCurveTo(rx + 3, by + rh * 0.5, rx - 1, by + rh);
      ctx.stroke();
    }
  } else if ((cap === 'neon' || cap === 'dock') && v > 0.8) {
    // Under-light.
    block(ctx, x + 8, by - 1, 16, 3, 1.5, 0x2a2f38, { line: 0.6 });
    const g = ctx.createLinearGradient(0, by + 2, 0, by + 26);
    g.addColorStop(0, hex(rim, 0.3));
    g.addColorStop(1, hex(rim, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x + 9, by + 2);
    ctx.lineTo(x + 23, by + 2);
    ctx.lineTo(x + 30, by + 26);
    ctx.lineTo(x + 2, by + 26);
    ctx.closePath();
    ctx.fill();
  } else if (cap === 'magma' && v > 0.75) {
    ctx.fillStyle = hex(rim, 0.8);
    ctx.beginPath();
    ctx.ellipse(x + 10 + v * 12, by + 2, 1.4, 2.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOneWay(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, leftEnd: boolean, rightEnd: boolean, b: Backdrop, solidC: number, rim: number): void {
  const wood = b === 'jungle' || b === 'training' || b === 'desert' || b === 'fortress' || b === 'harbor';
  const x0 = x + (leftEnd ? 1 : 0);
  const x1 = x + TILE - (rightEnd ? 1 : 0);
  // Supports.
  if (leftEnd || rightEnd || tx % 3 === 0) {
    const sx = leftEnd ? x + 4 : rightEnd ? x + TILE - 7 : x + 14;
    ctx.beginPath();
    ctx.moveTo(sx, y + 8);
    ctx.lineTo(sx + 3, y + 8);
    ctx.lineTo(sx + (leftEnd ? 9 : rightEnd ? -6 : 1.5), y + 18);
    ctx.lineTo(sx + (leftEnd ? 7 : rightEnd ? -8 : -0.5), y + 18);
    ctx.closePath();
    paint(ctx, wood ? 0x5a3f26 : shade(solidC, 0.6), y + 8, y + 18, { line: 0.8 });
  }
  if (wood) {
    const plank = b === 'fortress' ? 0x5c4a3a : b === 'harbor' ? 0x7a5a3a : 0x9a6a3e;
    block(ctx, x0, y, x1 - x0, 9, leftEnd || rightEnd ? 2.5 : 0.5, plank, { line: 1, glint: undefined });
    ctx.fillStyle = hex(shade(plank, 0.6));
    ctx.fillRect(x + 15.5, y + 1, 1, 7);
    ctx.strokeStyle = hex(shade(plank, 0.78));
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x0 + 2, y + 4 + hash(tx, ty, 1));
    ctx.lineTo(x1 - 2, y + 4.5 + hash(tx, ty, 2));
    ctx.stroke();
    for (const nx of [x + 4, x + 27]) {
      ctx.fillStyle = '#2a2420';
      ctx.beginPath();
      ctx.arc(nx, y + 4.5, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const c = b === 'snow' ? 0xcfe6f7 : b === 'volcano' ? 0x3a2c28 : tint(solidC, 0.1);
    block(ctx, x0, y, x1 - x0, 8, leftEnd || rightEnd ? 2.5 : 0, c, { line: 1 });
    if (b !== 'snow' && b !== 'volcano') {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let i = 0; i < 5; i++) ctx.fillRect(x + 3 + i * 6, y + 3.4, 3.6, 2.2);
    }
    ctx.fillStyle = hex(rim, 0.95);
    ctx.fillRect(x0, y, x1 - x0, 1.6);
  }
}

function drawVine(ctx: CanvasRenderingContext2D, x: number, y: number, tx: number, ty: number, end: boolean): void {
  const sway = Math.sin(ty * 1.3 + tx) * 4;
  ctx.strokeStyle = '#2f6a2c';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(x + 16 + Math.sin(ty) * 4, y);
  ctx.quadraticCurveTo(x + 10 + sway, y + 16, x + 16 + Math.sin(ty + 1) * 4, y + 32);
  ctx.stroke();
  ctx.strokeStyle = '#5aa64a';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  for (let i = 0; i < 2; i++) {
    const ly = y + 8 + i * 14;
    const lx = x + 16 + (i ? 4 : -4) + Math.sin(ty + i) * 3;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 5.5, 2.8, (i ? 0.6 : -0.6) + hash(tx, ty, i) * 0.3, 0, Math.PI * 2);
    paint(ctx, i ? 0x6fcf4f : 0x58b244, ly - 3, ly + 3, { line: 0.8 });
  }
  if (end) {
    ctx.beginPath();
    ctx.ellipse(x + 16, y + 31, 4, 2.4, 0, 0, Math.PI * 2);
    paint(ctx, 0x7fd85a, y + 29, y + 33, { line: 0.8 });
  }
}

function drawVent(ctx: CanvasRenderingContext2D, x: number, y: number, base: boolean): void {
  const g = ctx.createLinearGradient(0, y, 0, y + TILE);
  g.addColorStop(0, 'rgba(255,150,60,0.0)');
  g.addColorStop(1, 'rgba(255,150,60,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(x + 2, y, TILE - 4, TILE);
  if (!base) return;
  block(ctx, x - 1, y + TILE - 9, TILE + 2, 9, 2, 0x2f333c, { line: 1 });
  for (let k = 0; k < 4; k++) {
    roundRect(ctx, x + 2.5 + k * 7.5, y + TILE - 6.5, 5, 4, 1);
    const sg = ctx.createLinearGradient(0, y + TILE - 6.5, 0, y + TILE - 2.5);
    sg.addColorStop(0, '#ffe08a');
    sg.addColorStop(1, '#ff7a1f');
    ctx.fillStyle = sg;
    ctx.fill();
  }
}

/** Liquid overlays (water/lava) are separate so they can animate. One rect per liquid run row. */
export function liquidRects(map: MapData): { kind: 'water' | 'lava'; x: number; y: number; w: number; h: number; surface: boolean }[] {
  const out: { kind: 'water' | 'lava'; x: number; y: number; w: number; h: number; surface: boolean }[] = [];
  for (let ty = 0; ty < map.height; ty++) {
    let tx = 0;
    while (tx < map.width) {
      const t = map.tiles[ty * map.width + tx];
      if (t !== Tile.Water && t !== Tile.Lava) {
        tx++;
        continue;
      }
      const start = tx;
      while (tx < map.width && map.tiles[ty * map.width + tx] === t) tx++;
      const above = ty > 0 ? map.tiles[(ty - 1) * map.width + start] : Tile.Solid;
      out.push({ kind: t === Tile.Water ? 'water' : 'lava', x: start * TILE, y: ty * TILE, w: (tx - start) * TILE, h: TILE, surface: above !== t });
    }
  }
  return out;
}

// ------------------------------------------------------------------ shared textures

/** Small shared textures: particles, pickups, projectiles, grenades, flags, icons, liquids. */
export function buildCommonTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, scale = 1) => {
    if (scene.textures.exists(key)) return;
    const [c, ctx] = canvas(w * scale, h * scale);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    draw(ctx);
    scene.textures.addCanvas(key, c);
  };
  /** Hi-res sprite (drawn at SPR x; display at scale / SPR). */
  const sprite = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => make(key, w, h, draw, SPR);

  make('px', 4, 4, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 4, 4);
  });
  make('dot', 32, 32, (ctx) => {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
  });
  make('shadow', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
  make('jetflame', 64, 160, (ctx) => {
    // Teardrop plume, white-hot at the nozzle, fading to transparent.
    ctx.beginPath();
    ctx.moveTo(32, 0);
    ctx.bezierCurveTo(62, 10, 46, 80, 32, 160);
    ctx.bezierCurveTo(18, 80, 2, 10, 32, 0);
    const g = ctx.createLinearGradient(0, 0, 0, 160);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fill();
  });
  make('disc', 32, 32, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
  });
  make('ring', 128, 128, (ctx) => {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.stroke();
  });
  make('puff', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fill();
  });
  make('flash', 48, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 48, 0);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, 'rgba(255,246,200,0.2)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(18, 3);
    ctx.lineTo(16, 12);
    ctx.lineTo(48, 16);
    ctx.lineTo(16, 20);
    ctx.lineTo(18, 29);
    ctx.closePath();
    ctx.fill();
  }, 2);
  make('spark', 12, 4, (ctx) => {
    ctx.fillStyle = '#fff';
    roundRect(ctx, 0, 0, 12, 4, 2);
    ctx.fill();
  });
  make('shell', 6, 3, (ctx) => {
    block(ctx, 0.3, 0.3, 5.4, 2.4, 1, 0xe8b84a, { line: 0.4 });
  }, 3);
  make('confetti', 6, 4, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 6, 4);
  });
  make('lava', 64, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, '#ffd54a');
    g.addColorStop(0.18, '#ff8a1f');
    g.addColorStop(0.6, '#e2400f');
    g.addColorStop(1, '#8a1a08');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 32);
    const rand = seededRandom(7);
    for (let i = 0; i < 9; i++) {
      const bx = rand() * 64;
      const by = 8 + rand() * 22;
      const r = 2 + rand() * 4;
      for (const ox of [-64, 0, 64]) {
        const bg = ctx.createRadialGradient(bx + ox, by, 0, bx + ox, by, r);
        bg.addColorStop(0, 'rgba(255,220,90,0.75)');
        bg.addColorStop(1, 'rgba(255,220,90,0)');
        ctx.fillStyle = bg;
        ctx.fillRect(bx + ox - r, by - r, r * 2, r * 2);
      }
    }
  }, 2);
  make('water', 64, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 32);
    g.addColorStop(0, 'rgba(120,210,255,0.75)');
    g.addColorStop(0.3, 'rgba(50,150,240,0.55)');
    g.addColorStop(1, 'rgba(20,70,160,0.7)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 32);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const yy = 10 + i * 7;
      ctx.moveTo(0, yy);
      ctx.quadraticCurveTo(16, yy - 2, 32, yy);
      ctx.quadraticCurveTo(48, yy + 2, 64, yy);
      ctx.stroke();
    }
  }, 2);
  make('surf', 64, 8, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(0, 8);
    ctx.lineTo(0, 4);
    ctx.quadraticCurveTo(16, 0, 32, 4);
    ctx.quadraticCurveTo(48, 8, 64, 4);
    ctx.lineTo(64, 8);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }, 2);

  sprite('rocket', 22, 10, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(1, 2);
    ctx.lineTo(5, 3);
    ctx.lineTo(5, 7);
    ctx.lineTo(1, 8);
    ctx.closePath();
    paint(ctx, 0xff5a4f, 2, 8, { line: 0.8 });
    block(ctx, 3, 2.4, 14.6, 5.2, 2.6, 0xd9dde4, { line: 1, glint: [7, 3.4, 3, 0.7] });
    ctx.beginPath();
    ctx.moveTo(17, 2.4);
    ctx.quadraticCurveTo(22, 3.4, 21.6, 5);
    ctx.quadraticCurveTo(22, 6.6, 17, 7.6);
    ctx.closePath();
    paint(ctx, 0xff5a4f, 2.4, 7.6, { line: 0.9 });
    ctx.fillStyle = '#ffcf3a';
    ctx.fillRect(9, 2.6, 1.6, 4.8);
  });
  sprite('shellgl', 12, 12, (ctx) => {
    ctx.beginPath();
    ctx.arc(6, 6, 4.5, 0, Math.PI * 2);
    paint(ctx, 0x9cff6b, 1.5, 10.5, { line: 1, glint: [4.6, 4.4, 1.3, 0.8] });
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(1.6, 5.4, 8.8, 1.2);
  });
  sprite('blade', 20, 20, (ctx) => {
    ctx.beginPath();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const r = i % 2 ? 7 : 9.6;
      ctx.lineTo(10 + Math.cos(a) * r, 10 + Math.sin(a) * r);
    }
    ctx.closePath();
    paint(ctx, 0xe3e8ef, 0.4, 19.6, { line: 0.9, glint: [7, 6, 2.4, 1.2] });
    ctx.beginPath();
    ctx.arc(10, 10, 2.6, 0, Math.PI * 2);
    paint(ctx, 0x3a3f4a, 7.4, 12.6, { line: 0.7 });
  });
  GRENADES.forEach((g, i) => {
    sprite(`grenade:${i}`, 14, 14, (ctx) => {
      if (g.id === 'mine') {
        block(ctx, 1, 5, 12, 6.4, 2.4, g.color, { line: 1, glint: [4, 6, 2, 0.6] });
        ctx.beginPath();
        ctx.arc(7, 4.6, 1.8, Math.PI, 0);
        ctx.fillStyle = '#ff2a2a';
        ctx.fill();
        return;
      }
      block(ctx, 4.6, 0.8, 4.8, 3.2, 1, 0x4a505c, { line: 0.8 });
      ctx.strokeStyle = '#c9ced6';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(10.4, 2.6, 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(7, 8.2, 5.1, 5.4, 0, 0, Math.PI * 2);
      paint(ctx, g.color, 2.8, 13.6, { line: 1, glint: [5.2, 6.2, 1.5, 1] });
      ctx.strokeStyle = hex(shade(g.color, 0.6), 0.8);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(2.4, 8.2);
      ctx.lineTo(11.6, 8.2);
      ctx.moveTo(7, 3);
      ctx.lineTo(7, 13.4);
      ctx.stroke();
      if (g.id === 'sticky') {
        ctx.fillStyle = 'rgba(200,255,140,0.7)';
        ctx.beginPath();
        ctx.ellipse(7, 13, 3, 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  });
  sprite('medkit', 26, 22, (ctx) => {
    block(ctx, 8, 0.8, 10, 5, 2, 0xc9ced6, { line: 1 });
    block(ctx, 1, 4, 24, 17, 4, 0xf4f6fa, { line: 1.3, glint: [6, 6.6, 3.2, 1] });
    ctx.fillStyle = '#ff4d4d';
    roundRect(ctx, 10.5, 7, 5, 11, 1);
    ctx.fill();
    roundRect(ctx, 7.5, 10, 11, 5, 1);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(11, 7.5, 1.4, 4);
  });
  sprite('crate', 26, 22, (ctx) => {
    block(ctx, 1, 2, 24, 19, 3, 0x7a8a4a, { line: 1.3, glint: [5, 4, 3, 0.8] });
    block(ctx, 3, 9, 20, 4, 1, 0x5a6a32, { line: 0.8 });
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(11.5, 9.5, 3, 3);
  });
  sprite('dual', 28, 22, (ctx) => {
    block(ctx, 1, 1, 26, 20, 6, 0xffd34d, { line: 1.3, glint: [6, 4, 3.6, 1.2] });
    ctx.fillStyle = '#1b1d26';
    ctx.font = `900 13px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('x2', 14, 15.5);
  });
  sprite('pedestal', 36, 12, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 6);
    g.addColorStop(0, 'rgba(110,243,255,0)');
    g.addColorStop(1, 'rgba(110,243,255,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(4, 0, 28, 6);
    block(ctx, 1, 4, 34, 7, 3, 0x3a3f4a, { line: 1 });
    ctx.fillStyle = '#9ff8ff';
    roundRect(ctx, 6, 5.6, 24, 1.8, 0.9);
    ctx.fill();
  });
  for (const [team, color] of [
    [0, 0xff5a4f],
    [1, 0x3fa2ff],
  ] as const) {
    sprite(`flag:${team}`, 40, 56, (ctx) => {
      block(ctx, 3.6, 1, 4, 55, 2, 0x8a919c, { line: 1, horizontal: true });
      ctx.beginPath();
      ctx.arc(5.6, 2, 2.6, 0, Math.PI * 2);
      paint(ctx, 0xffd34d, -0.6, 4.6, { line: 0.8 });
      ctx.beginPath();
      ctx.moveTo(7.6, 4);
      ctx.quadraticCurveTo(24, 0, 38, 8);
      ctx.quadraticCurveTo(26, 16, 38, 26);
      ctx.quadraticCurveTo(24, 22, 7.6, 26);
      ctx.closePath();
      paint(ctx, color, 2, 26, { line: 1.3, glint: [16, 7, 5, 1.2] });
      ctx.fillStyle = '#fff';
      if (team === 0) {
        ctx.beginPath();
        ctx.moveTo(18, 9);
        ctx.lineTo(24, 20);
        ctx.lineTo(12, 20);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(19, 15, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }
  sprite('crown', 22, 16, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(2, 14);
    ctx.lineTo(2, 3);
    ctx.lineTo(7, 8);
    ctx.lineTo(11, 1);
    ctx.lineTo(15, 8);
    ctx.lineTo(20, 3);
    ctx.lineTo(20, 14);
    ctx.closePath();
    paint(ctx, 0xffd34d, 1, 14, { line: 1.2, glint: [7, 10, 2.6, 0.8] });
    ctx.beginPath();
    ctx.arc(11, 10.6, 1.6, 0, Math.PI * 2);
    paint(ctx, 0xe0484d, 9, 12.2, { line: 0.6 });
  });
  sprite('bomb', 24, 24, (ctx) => {
    ctx.beginPath();
    ctx.arc(11, 14, 9, 0, Math.PI * 2);
    paint(ctx, 0x2f333d, 5, 23, { line: 1.2, outline: 0x0b0c10, glint: [7.6, 10.4, 2.6, 1.6] });
    block(ctx, 13.6, 4.6, 5, 4, 1, 0x5a606c, { line: 0.8 });
    ctx.strokeStyle = '#c9a26b';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(17, 5);
    ctx.quadraticCurveTo(20, 1.5, 22.6, 3);
    ctx.stroke();
    const g = ctx.createRadialGradient(22.6, 2.6, 0, 22.6, 2.6, 2.6);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, '#ffd34d');
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(20, 0, 4, 5.4);
  });
  sprite('reticle', 40, 40, (ctx) => {
    for (const [w, col] of [
      [4.4, 'rgba(10,12,18,0.55)'],
      [2.2, '#ffffff'],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.arc(20, 20, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (const [x0, y0, x1, y1] of [
        [20, 3, 20, 9.5],
        [20, 30.5, 20, 37],
        [3, 20, 9.5, 20],
        [30.5, 20, 37, 20],
      ]) {
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(20, 20, 1.4, 0, Math.PI * 2);
    ctx.fill();
  });
  sprite('hitmark', 32, 32, (ctx) => {
    for (const [w, col] of [
      [5, 'rgba(10,12,18,0.5)'],
      [3, '#ffffff'],
    ] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const [a, b] of [
        [4, 4],
        [28, 4],
        [4, 28],
        [28, 28],
      ]) {
        ctx.moveTo(a, b);
        ctx.lineTo(16 + (a - 16) * 0.4, 16 + (b - 16) * 0.4);
      }
      ctx.stroke();
    }
  });
  make('door', 32, 32, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, '#3a3f4a');
    g.addColorStop(0.5, '#2a2e36');
    g.addColorStop(1, '#1e2128');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    for (let i = 0; i < 4; i++) {
      const lg = ctx.createLinearGradient(5 + i * 6, 0, 9 + i * 6, 0);
      lg.addColorStop(0, 'rgba(255,63,111,0)');
      lg.addColorStop(0.5, 'rgba(255,90,140,1)');
      lg.addColorStop(1, 'rgba(255,63,111,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(5 + i * 6, 0, 4, 32);
    }
  }, 2);
  make('bridge', 32, 16, (ctx) => {
    block(ctx, 0, 0, 32, 12, 0, 0x8a6440, { line: 0.8 });
    ctx.fillStyle = '#5a3f26';
    ctx.fillRect(15.4, 0.6, 1.2, 11);
    ctx.fillStyle = '#d6b07a';
    ctx.fillRect(0, 0, 32, 2.4);
    for (const nx of [4, 28]) {
      ctx.fillStyle = '#2a2420';
      ctx.beginPath();
      ctx.arc(nx, 6.5, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 2);
  make('platform', 32, 14, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 14);
    g.addColorStop(0, '#ffcf5a');
    g.addColorStop(1, '#c98a14');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 14);
    ctx.fillStyle = '#1b1d26';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 8, 12);
      ctx.lineTo(i * 8 + 4, 12);
      ctx.lineTo(i * 8 + 8, 2);
      ctx.lineTo(i * 8 + 4, 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 0, 32, 1.6);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 12.4, 32, 1.6);
  }, 2);
}
