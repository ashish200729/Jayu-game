import type Phaser from 'phaser';
import { GRENADES, TILE } from '@game/content';
import { Tile, type MapData, type MapTheme } from '@game/maps';
import { canvas, hex, inked, mix, roundRect, seededRandom, shade } from './draw';

export const CHUNK = 1024;

/** Renders the static tile layer of a map into 1024px chunk textures. Returns the chunk keys + positions. */
export function buildMapChunks(scene: Phaser.Scene, map: MapData): { key: string; x: number; y: number }[] {
  const out: { key: string; x: number; y: number }[] = [];
  const pxW = map.width * TILE;
  const pxH = map.height * TILE;
  const th = map.theme;
  const rand = seededRandom(map.width * 131 + map.height * 17 + map.id.length);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? Tile.Solid : map.tiles[y * map.width + x]);
  const solid = (t: number) => t === Tile.Solid || t === Tile.Ice;
  const speckles: number[] = [];
  for (let i = 0; i < map.width * map.height; i++) speckles.push(rand());
  for (let cy = 0; cy < pxH; cy += CHUNK) {
    for (let cx = 0; cx < pxW; cx += CHUNK) {
      const key = `map:${map.id}:${cx}:${cy}`;
      out.push({ key, x: cx, y: cy });
      if (scene.textures.exists(key)) continue;
      const w = Math.min(CHUNK, pxW - cx);
      const h = Math.min(CHUNK, pxH - cy);
      const [c, ctx] = canvas(w, h);
      ctx.translate(-cx, -cy);
      const tx0 = Math.floor(cx / TILE);
      const ty0 = Math.floor(cy / TILE);
      const tx1 = Math.ceil((cx + w) / TILE);
      const ty1 = Math.ceil((cy + h) / TILE);
      for (let ty = ty0; ty < ty1; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const t = at(tx, ty);
          const x = tx * TILE;
          const y = ty * TILE;
          const sp = speckles[ty * map.width + tx] ?? 0;
          if (solid(t)) {
            const base = t === Tile.Ice ? 0xbfe8ff : th.solid;
            const dark = t === Tile.Ice ? 0x7fb8db : th.solidDark;
            const depth = Math.min(4, (() => {
              let d = 0;
              while (d < 4 && solid(at(tx, ty - d - 1))) d++;
              return d;
            })());
            ctx.fillStyle = hex(mix(base, dark, depth / 4));
            ctx.fillRect(x, y, TILE, TILE);
            // texture: bricks/rocks
            ctx.fillStyle = hex(shade(mix(base, dark, depth / 4), 0.88));
            if (sp < 0.5) ctx.fillRect(x + 4 + sp * 14, y + 6 + sp * 10, 6, 3);
            if (sp > 0.3) ctx.fillRect(x + 18 - sp * 6, y + 18 + sp * 6, 7, 3);
            ctx.fillStyle = hex(shade(base, 1.08), 0.5);
            if (sp > 0.7) ctx.fillRect(x + 10, y + 10, 3, 3);
            const open = (dx: number, dy: number) => !solid(at(tx + dx, ty + dy));
            // Rim light on top edges, shadows on bottoms/sides: keeps the play space readable.
            if (open(0, -1)) {
              ctx.fillStyle = hex(t === Tile.Ice ? 0xffffff : th.rim);
              ctx.fillRect(x, y, TILE, 5);
              ctx.fillStyle = hex(shade(t === Tile.Ice ? 0xffffff : th.rim, 0.7));
              ctx.fillRect(x, y + 5, TILE, 2);
              if (th.backdrop === 'jungle' || th.backdrop === 'training') {
                ctx.fillStyle = hex(th.rim);
                for (let k = 0; k < 4; k++) ctx.fillRect(x + k * 8 + sp * 4, y - 3, 2, 4);
              }
              if (th.backdrop === 'snow') {
                ctx.fillStyle = '#ffffff';
                ctx.beginPath();
                ctx.ellipse(x + TILE / 2, y + 2, TILE / 2 + 2, 4, 0, 0, Math.PI * 2);
                ctx.fill();
              }
            }
            if (open(0, 1)) {
              ctx.fillStyle = hex(shade(dark, 0.7));
              ctx.fillRect(x, y + TILE - 4, TILE, 4);
            }
            if (open(-1, 0)) {
              ctx.fillStyle = hex(shade(base, 1.12), 0.6);
              ctx.fillRect(x, y, 3, TILE);
            }
            if (open(1, 0)) {
              ctx.fillStyle = hex(shade(dark, 0.8), 0.7);
              ctx.fillRect(x + TILE - 3, y, 3, TILE);
            }
            if (t === Tile.Ice) {
              ctx.strokeStyle = 'rgba(255,255,255,0.7)';
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(x + 6, y + 22);
              ctx.lineTo(x + 16, y + 12);
              ctx.stroke();
            }
          } else if (t === Tile.OneWay) {
            ctx.fillStyle = hex(shade(th.solid, 1.15));
            roundRect(ctx, x, y, TILE, 9, 2);
            ctx.fill();
            ctx.fillStyle = hex(th.rim);
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = hex(shade(th.solidDark, 0.8));
            ctx.fillRect(x, y + 7, TILE, 2);
            if (at(tx - 1, ty) !== Tile.OneWay || tx % 4 === 0) {
              ctx.fillStyle = hex(shade(th.solidDark, 0.9), 0.8);
              ctx.fillRect(x + 4, y + 9, 3, 8);
            }
          } else if (t === Tile.Vine) {
            ctx.strokeStyle = hex(0x3f8a3a);
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(x + 16 + Math.sin(ty) * 4, y);
            ctx.quadraticCurveTo(x + 8 + sp * 16, y + 16, x + 16 + Math.sin(ty + 1) * 4, y + 32);
            ctx.stroke();
            ctx.fillStyle = hex(0x6fcf4f);
            ctx.beginPath();
            ctx.ellipse(x + 10 + sp * 12, y + 10 + sp * 10, 5, 3, sp * 3, 0, Math.PI * 2);
            ctx.fill();
          } else if (t === Tile.Vent) {
            if (!(at(tx, ty + 1) === Tile.Vent)) {
              ctx.fillStyle = '#2a2d36';
              ctx.fillRect(x, y + TILE - 8, TILE, 8);
              ctx.fillStyle = '#ff9a3d';
              for (let k = 0; k < 4; k++) ctx.fillRect(x + 3 + k * 8, y + TILE - 6, 4, 4);
            }
            const g = ctx.createLinearGradient(0, y, 0, y + TILE);
            g.addColorStop(0, 'rgba(255,150,60,0.0)');
            g.addColorStop(1, 'rgba(255,150,60,0.18)');
            ctx.fillStyle = g;
            ctx.fillRect(x, y, TILE, TILE);
          } else if (t === Tile.LowGrav) {
            ctx.fillStyle = 'rgba(160,120,255,0.07)';
            ctx.fillRect(x, y, TILE, TILE);
            if (sp > 0.85) {
              ctx.fillStyle = 'rgba(220,200,255,0.6)';
              ctx.fillRect(x + sp * 20, y + sp * 24, 2, 2);
            }
          }
        }
      }
      scene.textures.addCanvas(key, c);
    }
  }
  return out;
}

/** Liquid overlays (water/lava) are separate so they can animate. One texture per liquid run row. */
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

/** Parallax layer textures for a backdrop: [far, mid, near] 1024x512 tiling strips. */
export function buildBackdrop(scene: Phaser.Scene, th: MapTheme, id: string): { sky: string; layers: string[] } {
  const sky = `sky:${id}`;
  if (!scene.textures.exists(sky)) {
    const [c, ctx] = canvas(8, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, hex(th.skyTop));
    g.addColorStop(1, hex(th.skyBottom));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 256);
    scene.textures.addCanvas(sky, c);
  }
  const layers: string[] = [];
  const colors = [th.far, th.mid, th.near];
  for (let li = 0; li < 3; li++) {
    const key = `bg:${id}:${li}`;
    layers.push(key);
    if (scene.textures.exists(key)) continue;
    const W = 1024;
    const H = 512;
    const [c, ctx] = canvas(W, H);
    const rand = seededRandom(li * 977 + id.length * 31 + th.backdrop.length);
    const col = hex(colors[li]);
    const lite = hex(shade(colors[li], 1.18));
    ctx.fillStyle = col;
    const base = H * (0.45 + li * 0.14);
    const b = th.backdrop;
    if (b === 'city' || b === 'harbor' || b === 'lab') {
      let x = 0;
      while (x < W) {
        const bw = 40 + rand() * 70;
        const bh = (b === 'harbor' && li === 2 ? 60 : 120) + rand() * (220 - li * 40);
        ctx.fillStyle = col;
        ctx.fillRect(x, H - bh - (H - base) * 0.2, bw, bh + 200);
        if (li < 2) {
          ctx.fillStyle = hex(0xffe9a8, 0.35 + li * 0.2);
          for (let wy = H - bh + 10; wy < H - 20; wy += 14)
            for (let wx = x + 6; wx < x + bw - 6; wx += 10) if (rand() > 0.55) ctx.fillRect(wx, wy, 4, 6);
        }
        if (b === 'harbor' && li === 1 && rand() > 0.6) {
          ctx.fillStyle = col;
          ctx.fillRect(x + bw / 2, H - bh - 120, 6, 120);
          ctx.fillRect(x + bw / 2 - 60, H - bh - 120, 120, 6);
        }
        x += bw + rand() * 12;
      }
    } else if (b === 'jungle' || b === 'training') {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, base + Math.sin(x * 0.01 + li) * 30 + Math.sin(x * 0.037) * 12);
      ctx.lineTo(W, H);
      ctx.fill();
      for (let i = 0; i < 18 - li * 4; i++) {
        const x = rand() * W;
        const y = base - 20 + rand() * 30;
        const r = 26 + rand() * 40;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.arc(x + r * 0.7, y + 8, r * 0.8, 0, Math.PI * 2);
        ctx.arc(x - r * 0.7, y + 10, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(x - 4, y, 8, H);
      }
      if (b === 'jungle' && li === 1) {
        ctx.fillStyle = lite;
        for (let k = 0; k < 3; k++) {
          const x = 100 + k * 330 + rand() * 60;
          ctx.fillRect(x, base - 140, 120, 160);
          ctx.fillRect(x + 15, base - 175, 90, 40);
          ctx.fillRect(x + 35, base - 200, 50, 30);
        }
      }
    } else if (b === 'snow' || b === 'desert' || b === 'volcano') {
      ctx.beginPath();
      ctx.moveTo(0, H);
      let y = base;
      for (let x = 0; x <= W; x += 32) {
        y = Math.max(base - 180 + li * 40, Math.min(H - 60, y + (rand() - 0.5) * 90));
        ctx.lineTo(x, b === 'desert' && li === 1 ? Math.round(y / 40) * 40 : y);
      }
      ctx.lineTo(W, H);
      ctx.fill();
      if (b === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        for (let i = 0; i < 9; i++) {
          const x = rand() * W;
          ctx.beginPath();
          ctx.moveTo(x - 30, base - 60);
          ctx.lineTo(x, base - 120 - rand() * 60);
          ctx.lineTo(x + 30, base - 60);
          ctx.fill();
        }
      }
      if (b === 'volcano' && li === 0) {
        ctx.fillStyle = hex(0xff6a1f, 0.5);
        ctx.beginPath();
        ctx.moveTo(380, base - 40);
        ctx.lineTo(512, base - 230);
        ctx.lineTo(640, base - 40);
        ctx.fill();
      }
    } else if (b === 'space') {
      if (li === 0) {
        for (let i = 0; i < 160; i++) {
          ctx.fillStyle = `rgba(255,255,255,${0.3 + rand() * 0.7})`;
          const s = rand() * 2 + 0.5;
          ctx.fillRect(rand() * W, rand() * H, s, s);
        }
        ctx.fillStyle = hex(th.accent, 0.7);
        ctx.beginPath();
        ctx.arc(780, 140, 70, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = hex(th.far);
        ctx.beginPath();
        ctx.arc(800, 125, 64, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = 0; i < 6; i++) {
          const x = rand() * W;
          const w = 80 + rand() * 120;
          ctx.fillStyle = col;
          ctx.fillRect(x, base - 40 + rand() * 60, w, 14);
          ctx.fillRect(x + w / 2 - 6, base - 100, 12, 90);
          ctx.fillStyle = hex(th.accent, 0.8);
          ctx.fillRect(x + 6, base - 34, 6, 4);
        }
      }
    } else {
      // fortress
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 24) ctx.lineTo(x, base + Math.sin(x * 0.008 + li * 2) * 40);
      ctx.lineTo(W, H);
      ctx.fill();
      for (let k = 0; k < 3 - li; k++) {
        const x = 150 + k * 340 + rand() * 50;
        ctx.fillRect(x, base - 200, 70, 260);
        for (let m = 0; m < 4; m++) ctx.fillRect(x - 5 + m * 20, base - 215, 12, 16);
        ctx.fillStyle = hex(0xffd27a, 0.5);
        ctx.fillRect(x + 30, base - 150, 8, 14);
        ctx.fillStyle = col;
      }
    }
    // Atmospheric haze at the bottom of distant layers.
    if (li === 0) {
      const g = ctx.createLinearGradient(0, base - 100, 0, H);
      g.addColorStop(0, hex(th.skyBottom, 0));
      g.addColorStop(1, hex(th.skyBottom, 0.6));
      ctx.fillStyle = g;
      ctx.fillRect(0, base - 100, W, H);
    }
    scene.textures.addCanvas(key, c);
  }
  return { sky, layers };
}

/** Small shared textures: particles, pickups, projectiles, grenades, flags, icons. */
export function buildCommonTextures(scene: Phaser.Scene): void {
  const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
    if (scene.textures.exists(key)) return;
    const [c, ctx] = canvas(w, h);
    draw(ctx);
    scene.textures.addCanvas(key, c);
  };
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
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(18, 4);
    ctx.lineTo(16, 12);
    ctx.lineTo(48, 16);
    ctx.lineTo(16, 20);
    ctx.lineTo(18, 28);
    ctx.closePath();
    ctx.fill();
  });
  make('spark', 12, 4, (ctx) => {
    ctx.fillStyle = '#fff';
    roundRect(ctx, 0, 0, 12, 4, 2);
    ctx.fill();
  });
  make('shell', 6, 3, (ctx) => {
    ctx.fillStyle = '#e8b84a';
    ctx.fillRect(0, 0, 6, 3);
  });
  make('confetti', 6, 4, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 6, 4);
  });
  make('rocket', 22, 10, (ctx) => {
    roundRect(ctx, 2, 2, 16, 6, 3);
    inked(ctx, '#d9dde4', '#1b1d26', 2);
    ctx.beginPath();
    ctx.moveTo(18, 2);
    ctx.lineTo(22, 5);
    ctx.lineTo(18, 8);
    ctx.closePath();
    inked(ctx, '#ff5a4f', '#1b1d26', 1.5);
  });
  make('shellgl', 12, 12, (ctx) => {
    ctx.beginPath();
    ctx.arc(6, 6, 4.5, 0, Math.PI * 2);
    inked(ctx, '#9cff6b', '#1b1d26', 2);
  });
  make('blade', 20, 20, (ctx) => {
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const r = i % 2 ? 7 : 10;
      ctx.lineTo(10 + Math.cos(a) * r, 10 + Math.sin(a) * r);
    }
    ctx.closePath();
    inked(ctx, '#e3e8ef', '#1b1d26', 1.5);
    ctx.fillStyle = '#1b1d26';
    ctx.beginPath();
    ctx.arc(10, 10, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  GRENADES.forEach((g, i) => {
    make(`grenade:${i}`, 14, 14, (ctx) => {
      if (g.id === 'mine') {
        roundRect(ctx, 1, 5, 12, 6, 2);
        inked(ctx, hex(g.color), '#1b1d26', 1.6);
        ctx.fillStyle = '#ff2a2a';
        ctx.fillRect(5.5, 3, 3, 3);
        return;
      }
      ctx.beginPath();
      ctx.ellipse(7, 8, 5, 5.5, 0, 0, Math.PI * 2);
      inked(ctx, hex(g.color), '#1b1d26', 1.6);
      ctx.fillStyle = '#3a3f48';
      ctx.fillRect(5, 1, 4, 3);
      if (g.id === 'sticky') {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(4, 6, 2, 2);
      }
    });
  });
  make('medkit', 26, 22, (ctx) => {
    roundRect(ctx, 1, 4, 24, 17, 4);
    inked(ctx, '#ffffff', '#1b1d26', 2);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(10.5, 7, 5, 11);
    ctx.fillRect(7.5, 10, 11, 5);
    roundRect(ctx, 8, 1, 10, 5, 2);
    inked(ctx, '#c9ced6', '#1b1d26', 1.5);
  });
  make('crate', 26, 22, (ctx) => {
    roundRect(ctx, 1, 2, 24, 19, 3);
    inked(ctx, '#7a8a4a', '#1b1d26', 2);
    ctx.fillStyle = '#5a6a32';
    ctx.fillRect(3, 9, 20, 4);
  });
  make('dual', 28, 22, (ctx) => {
    roundRect(ctx, 1, 1, 26, 20, 6);
    inked(ctx, '#ffd34d', '#1b1d26', 2);
    ctx.fillStyle = '#1b1d26';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('x2', 14, 16);
  });
  make('pedestal', 36, 10, (ctx) => {
    roundRect(ctx, 1, 2, 34, 7, 3);
    inked(ctx, '#3a3f48', '#1b1d26', 2);
    ctx.fillStyle = '#6ef3ff';
    ctx.fillRect(6, 4, 24, 2);
  });
  for (const [team, color] of [
    [0, 0xff5a4f],
    [1, 0x3fa2ff],
  ] as const) {
    make(`flag:${team}`, 40, 56, (ctx) => {
      ctx.fillStyle = '#3a3f48';
      ctx.fillRect(4, 2, 4, 54);
      ctx.beginPath();
      ctx.moveTo(8, 4);
      ctx.quadraticCurveTo(24, 0, 38, 8);
      ctx.quadraticCurveTo(26, 16, 38, 26);
      ctx.quadraticCurveTo(24, 22, 8, 26);
      ctx.closePath();
      inked(ctx, hex(color), '#1b1d26', 2);
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
  make('crown', 22, 16, (ctx) => {
    ctx.beginPath();
    ctx.moveTo(2, 14);
    ctx.lineTo(2, 3);
    ctx.lineTo(7, 8);
    ctx.lineTo(11, 1);
    ctx.lineTo(15, 8);
    ctx.lineTo(20, 3);
    ctx.lineTo(20, 14);
    ctx.closePath();
    inked(ctx, '#ffd34d', '#1b1d26', 2);
  });
  make('bomb', 24, 24, (ctx) => {
    ctx.beginPath();
    ctx.arc(11, 14, 9, 0, Math.PI * 2);
    inked(ctx, '#2a2d36', '#000', 2);
    ctx.strokeStyle = '#c9a26b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(16, 7);
    ctx.quadraticCurveTo(20, 2, 23, 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.arc(8, 11, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
  make('reticle', 40, 40, (ctx) => {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(20, 20, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of [
      [20, 2, 20, 9],
      [20, 31, 20, 38],
      [2, 20, 9, 20],
      [31, 20, 38, 20],
    ]) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    ctx.stroke();
  });
  make('hitmark', 32, 32, (ctx) => {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
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
  });
  make('door', 32, 32, (ctx) => {
    ctx.fillStyle = '#2a2d36';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#ff3f6f';
    for (let i = 0; i < 4; i++) ctx.fillRect(6 + i * 6, 0, 2, 32);
  });
  make('bridge', 32, 16, (ctx) => {
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(0, 0, 32, 12);
    ctx.fillStyle = '#5a3f26';
    ctx.fillRect(15, 0, 2, 12);
    ctx.fillStyle = '#c9a26b';
    ctx.fillRect(0, 0, 32, 3);
  });
  make('platform', 32, 14, (ctx) => {
    ctx.fillStyle = '#e0a028';
    ctx.fillRect(0, 0, 32, 14);
    ctx.fillStyle = '#1b1d26';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 8, 14);
      ctx.lineTo(i * 8 + 4, 14);
      ctx.lineTo(i * 8 + 8, 0);
      ctx.lineTo(i * 8 + 4, 0);
      ctx.fill();
    }
  });
}
