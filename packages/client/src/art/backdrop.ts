import type Phaser from 'phaser';
import type { MapTheme } from '@game/maps';
import { canvas, hex, mix, seededRandom, shade, tint } from './draw';

/** Parallax layer texture size (tiles horizontally, seamless). */
export const BG_W = 2048;
export const BG_H = 720;

type Ctx = CanvasRenderingContext2D;
type Rand = () => number;

/** Seamless ridge height at x: sum of sines with an integer number of cycles across BG_W. */
function ridgeFn(rand: Rand, amp: number, rough = 1): (x: number) => number {
  const ks = [1, 2, 3, 5, 8, 13, 21];
  const terms = ks.map((k, i) => ({ k, a: (amp / (1 + i * 0.9)) * (i > 2 ? rough : 1), p: rand() * Math.PI * 2 }));
  return (x) => terms.reduce((s, t) => s + t.a * Math.sin((t.k * Math.PI * 2 * x) / BG_W + t.p), 0);
}

/** Draw `fn` at x offsets -W, 0, +W so shapes crossing the seam tile seamlessly. */
function wrapped(fn: (ox: number) => void): void {
  for (const ox of [-BG_W, 0, BG_W]) fn(ox);
}

/** Vertical fill for a silhouette: rim-lit top edge, body colour, hazy bottom. */
function silhouetteFill(ctx: Ctx, top: number, color: number, haze: number, hazeAmt: number, rimColor: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, BG_H);
  g.addColorStop(0, hex(mix(color, rimColor, 0.28)));
  g.addColorStop(0.08, hex(color));
  g.addColorStop(0.75, hex(mix(color, haze, hazeAmt * 0.6)));
  g.addColorStop(1, hex(mix(color, haze, hazeAmt)));
  return g;
}

function ridge(ctx: Ctx, base: number, f: (x: number) => number, fill: CanvasGradient | string): void {
  ctx.beginPath();
  ctx.moveTo(0, BG_H);
  for (let x = 0; x <= BG_W; x += 8) ctx.lineTo(x, base + f(x));
  ctx.lineTo(BG_W, BG_H);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function rimLine(ctx: Ctx, base: number, f: (x: number) => number, color: number, a: number, w = 2): void {
  ctx.beginPath();
  for (let x = 0; x <= BG_W; x += 8) ctx.lineTo(x, base + f(x) + 1);
  ctx.strokeStyle = hex(color, a);
  ctx.lineWidth = w;
  ctx.stroke();
}

function haze(ctx: Ctx, from: number, color: number, a: number): void {
  const g = ctx.createLinearGradient(0, from, 0, BG_H);
  g.addColorStop(0, hex(color, 0));
  g.addColorStop(1, hex(color, a));
  ctx.fillStyle = g;
  ctx.fillRect(0, from, BG_W, BG_H - from);
}

function windowsGrid(ctx: Ctx, x: number, y: number, w: number, h: number, rand: Rand, color: number, a: number, density = 0.45): void {
  for (let wy = y + 12; wy < y + h - 10; wy += 16)
    for (let wx = x + 8; wx < x + w - 8; wx += 12) {
      if (rand() > density) continue;
      ctx.fillStyle = hex(color, a * (0.5 + rand() * 0.5));
      ctx.fillRect(wx, wy, 5, 7);
    }
}

function pine(ctx: Ctx, x: number, base: number, h: number, color: number, snow: boolean): void {
  const w = h * 0.42;
  ctx.fillStyle = hex(shade(color, 0.8));
  ctx.fillRect(x - h * 0.03, base - h * 0.12, h * 0.06, h * 0.14);
  for (let i = 0; i < 3; i++) {
    const ty = base - h * 0.12 - i * h * 0.26;
    const tw = w * (1 - i * 0.24);
    ctx.beginPath();
    ctx.moveTo(x - tw, ty);
    ctx.lineTo(x, ty - h * 0.42);
    ctx.lineTo(x + tw, ty);
    ctx.closePath();
    ctx.fillStyle = hex(color);
    ctx.fill();
    if (snow) {
      ctx.beginPath();
      ctx.moveTo(x - tw * 0.45, ty - h * 0.24);
      ctx.lineTo(x, ty - h * 0.42);
      ctx.lineTo(x + tw * 0.45, ty - h * 0.24);
      ctx.quadraticCurveTo(x, ty - h * 0.2, x - tw * 0.45, ty - h * 0.24);
      ctx.fillStyle = 'rgba(245,250,255,0.85)';
      ctx.fill();
    }
  }
}

function roundTree(ctx: Ctx, x: number, base: number, h: number, color: number, rim: number): void {
  ctx.fillStyle = hex(shade(color, 0.85));
  ctx.fillRect(x - h * 0.04, base - h * 0.5, h * 0.08, h * 0.5);
  const blobs = [
    [0, -0.62, 0.32],
    [-0.24, -0.5, 0.24],
    [0.24, -0.5, 0.25],
    [-0.1, -0.82, 0.22],
    [0.14, -0.78, 0.2],
  ];
  for (const [bx, by, br] of blobs) {
    ctx.beginPath();
    ctx.arc(x + bx * h, base + by * h, br * h, 0, Math.PI * 2);
    ctx.fillStyle = hex(color);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x - 0.12 * h, base - 0.86 * h, 0.14 * h, Math.PI * 1.05, Math.PI * 1.7);
  ctx.strokeStyle = hex(rim, 0.35);
  ctx.lineWidth = 3;
  ctx.stroke();
}

function glowDisc(ctx: Ctx, x: number, y: number, r: number, core: number, glowC: number, glowR: number, a = 1): void {
  const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, glowR);
  g.addColorStop(0, hex(glowC, 0.55 * a));
  g.addColorStop(0.35, hex(glowC, 0.2 * a));
  g.addColorStop(1, hex(glowC, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);
  if (r > 0) {
    const d = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    d.addColorStop(0, hex(tint(core, 0.5)));
    d.addColorStop(1, hex(core));
    ctx.fillStyle = d;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cloud(ctx: Ctx, x: number, y: number, s: number, color: number, a: number): void {
  const puffs = [
    [0, 0, 1],
    [-0.9, 0.25, 0.7],
    [0.95, 0.2, 0.75],
    [-0.4, -0.35, 0.65],
    [0.45, -0.3, 0.7],
    [1.7, 0.35, 0.5],
    [-1.6, 0.4, 0.45],
  ];
  for (const [px, py, pr] of puffs) {
    const r = pr * s;
    const g = ctx.createRadialGradient(x + px * s, y + py * s - r * 0.2, 0, x + px * s, y + py * s, r);
    g.addColorStop(0, hex(tint(color, 0.3), a));
    g.addColorStop(0.7, hex(color, a * 0.7));
    g.addColorStop(1, hex(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x + px * s, y + py * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ------------------------------------------------------------------ layer painters

interface LayerSpec {
  li: number;
  color: number;
  haze: number;
  hazeAmt: number;
  rim: number;
  th: MapTheme;
  rand: Rand;
}

function paintCity(ctx: Ctx, s: LayerSpec, harbor: boolean): void {
  const { li, color, rand, th } = s;
  const base = BG_H * (0.42 + li * 0.13);
  const grad = silhouetteFill(ctx, base - 260, color, s.haze, s.hazeAmt, s.rim);
  let x = 0;
  const shapes: { x: number; w: number; h: number; kind: number }[] = [];
  while (x < BG_W) {
    const w = (harbor ? 70 : 46) + rand() * (harbor ? 110 : 80) - li * 4;
    const h = (harbor ? (li === 2 ? 40 : 90) : 140) + rand() * (harbor ? 120 : 250 - li * 50);
    shapes.push({ x, w, h, kind: rand() });
    x += w + rand() * (harbor ? 40 : 10);
  }
  for (const b of shapes) {
    wrapped((ox) => {
      const bx = b.x + ox;
      const top = base - b.h;
      ctx.fillStyle = grad;
      if (harbor && li === 1) {
        // Stacked shipping containers.
        const cols = [0xc0503a, 0x3a7ab8, 0xd9a03a, 0x4a9a6a];
        const rows = 2 + Math.floor(b.kind * 3);
        for (let r = 0; r < rows; r++) {
          const cw = b.w * (0.9 - r * 0.1);
          const cy = base + 40 - (r + 1) * 30;
          const cc = mix(cols[(r + Math.floor(b.kind * 10)) % 4], color, 0.55);
          ctx.fillStyle = hex(cc);
          ctx.fillRect(bx + r * 6, cy, cw, 28);
          ctx.fillStyle = hex(shade(cc, 0.8));
          for (let k = 6; k < cw - 2; k += 7) ctx.fillRect(bx + r * 6 + k, cy + 3, 2, 22);
        }
        if (b.kind > 0.55) {
          // Gantry crane.
          const cx = bx + b.w * 0.5;
          const ch = 300 + b.kind * 80;
          ctx.strokeStyle = hex(mix(color, s.rim, 0.1));
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(cx - 30, base + 40);
          ctx.lineTo(cx - 8, base - ch);
          ctx.moveTo(cx + 30, base + 40);
          ctx.lineTo(cx + 8, base - ch);
          ctx.moveTo(cx - 140, base - ch);
          ctx.lineTo(cx + 120, base - ch);
          ctx.stroke();
          ctx.lineWidth = 2;
          for (let k = 0; k < 9; k++) {
            ctx.beginPath();
            ctx.moveTo(cx - 140 + k * 29, base - ch);
            ctx.lineTo(cx - 126 + k * 29, base - ch + 18);
            ctx.lineTo(cx - 112 + k * 29, base - ch);
            ctx.stroke();
          }
          ctx.beginPath();
          ctx.moveTo(cx - 100, base - ch + 18);
          ctx.lineTo(cx - 100, base - ch + 120);
          ctx.stroke();
          ctx.fillStyle = hex(th.accent);
          ctx.beginPath();
          ctx.arc(cx, base - ch - 6, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
      if (harbor && li === 0) {
        // Distant ships on the horizon.
        ctx.beginPath();
        ctx.moveTo(bx, base + 30);
        ctx.lineTo(bx + b.w, base + 30);
        ctx.lineTo(bx + b.w - 14, base + 52);
        ctx.lineTo(bx + 10, base + 52);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(bx + b.w * 0.55, base + 6, b.w * 0.3, 26);
        ctx.fillRect(bx + b.w * 0.62, base - 18, 6, 26);
        return;
      }
      ctx.fillRect(bx, top, b.w, b.h + 400);
      // Rooftop variety: setbacks, water tanks, antennas, billboards.
      if (b.kind > 0.75) {
        ctx.fillRect(bx + b.w * 0.2, top - 26, b.w * 0.6, 28);
        ctx.fillRect(bx + b.w * 0.48, top - 70, 3, 46);
        if (li < 2) {
          ctx.fillStyle = hex(0xff4040, 0.9);
          ctx.beginPath();
          ctx.arc(bx + b.w * 0.48 + 1.5, top - 72, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (b.kind > 0.55 && li > 0) {
        const tw = 24;
        const tx = bx + b.w * 0.3;
        ctx.fillRect(tx + 2, top - 14, 3, 14);
        ctx.fillRect(tx + tw - 5, top - 14, 3, 14);
        ctx.beginPath();
        ctx.moveTo(tx, top - 14);
        ctx.lineTo(tx, top - 36);
        ctx.quadraticCurveTo(tx + tw / 2, top - 46, tx + tw, top - 36);
        ctx.lineTo(tx + tw, top - 14);
        ctx.closePath();
        ctx.fill();
      } else if (b.kind < 0.12 && li === 1) {
        // Rooftop billboard: dim backlit panel with a frame and a couple of glowing text lines.
        ctx.fillStyle = hex(shade(color, 0.8));
        ctx.fillRect(bx + 4, top - 52, b.w - 8, 38);
        ctx.fillStyle = hex(mix(th.accent, color, 0.62));
        ctx.fillRect(bx + 8, top - 48, b.w - 16, 30);
        ctx.fillStyle = hex(tint(th.accent, 0.5), 0.55);
        ctx.fillRect(bx + 14, top - 42, (b.w - 28) * 0.62, 5);
        ctx.fillRect(bx + 14, top - 32, (b.w - 28) * 0.38, 4);
        ctx.fillStyle = grad;
        ctx.fillRect(bx + 10, top - 16, 3, 16);
        ctx.fillRect(bx + b.w - 13, top - 16, 3, 16);
      }
      if (li < 2) windowsGrid(ctx, bx, top, b.w, b.h, rand, 0xffe2a0, 0.25 + li * 0.25, 0.35);
    });
  }
  if (harbor && li === 0) {
    // Sea band.
    const g = ctx.createLinearGradient(0, base + 30, 0, BG_H);
    g.addColorStop(0, hex(mix(color, s.rim, 0.25)));
    g.addColorStop(1, hex(shade(color, 0.7)));
    ctx.fillStyle = g;
    ctx.fillRect(0, base + 52, BG_W, BG_H);
    ctx.fillStyle = hex(tint(color, 0.35), 0.4);
    for (let i = 0; i < 60; i++) ctx.fillRect(rand() * BG_W, base + 60 + rand() * 120, 20 + rand() * 50, 2);
  }
}

function paintNature(ctx: Ctx, s: LayerSpec): void {
  const { li, color, rand, th } = s;
  const b = th.backdrop;
  const base = BG_H * (0.38 + li * 0.15);
  const amp = b === 'snow' ? 150 - li * 40 : b === 'desert' ? 70 : b === 'volcano' ? 110 - li * 20 : 60 - li * 10;
  const f = ridgeFn(rand, amp, b === 'snow' || b === 'volcano' ? 1.6 : 0.7);
  const fill = silhouetteFill(ctx, base - amp * 1.6, color, s.haze, s.hazeAmt, s.rim);
  if (b === 'desert' && li === 0) {
    // Mesas: flat-topped buttes with striped strata.
    const flat = (x: number) => Math.round(f(x) / 46) * 46 - 40;
    ridge(ctx, base, flat, fill);
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = hex(shade(color, 0.9 + (k % 2) * 0.12), 0.5);
      ctx.fillRect(0, base - 120 + k * 26, BG_W, 9);
    }
    ctx.restore();
  } else if (b === 'volcano' && li === 0) {
    ridge(ctx, base + 40, f, fill);
    // The volcano: a broad cone with a glowing crater, lava rivulets and a smoke plume.
    wrapped((ox) => {
      const cx = BG_W * 0.5 + ox;
      const top = base - 250;
      const cone = ctx.createLinearGradient(0, top, 0, BG_H);
      cone.addColorStop(0, hex(mix(color, 0xff6a1f, 0.35)));
      cone.addColorStop(0.15, hex(color));
      cone.addColorStop(1, hex(mix(color, s.haze, s.hazeAmt)));
      ctx.fillStyle = cone;
      ctx.beginPath();
      ctx.moveTo(cx - 520, BG_H);
      ctx.quadraticCurveTo(cx - 200, top + 120, cx - 70, top);
      ctx.quadraticCurveTo(cx, top + 18, cx + 70, top);
      ctx.quadraticCurveTo(cx + 200, top + 120, cx + 520, BG_H);
      ctx.closePath();
      ctx.fill();
      glowDisc(ctx, cx, top + 6, 0, 0, 0xff8a2a, 170, 0.9);
      ctx.strokeStyle = hex(0xff7a1f, 0.85);
      ctx.lineCap = 'round';
      for (const [dx, len, curve] of [
        [-30, 200, -40],
        [24, 260, 50],
        [-8, 140, 10],
      ]) {
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cx + dx * 0.6, top + 8);
        ctx.quadraticCurveTo(cx + dx + curve, top + len * 0.5, cx + dx * 3 + curve, top + len);
        ctx.stroke();
      }
      ctx.lineWidth = 2;
      ctx.strokeStyle = hex(0xffd23f, 0.8);
      ctx.beginPath();
      ctx.moveTo(cx - 18, top + 8);
      ctx.quadraticCurveTo(cx - 70, top + 100, cx - 80, top + 200);
      ctx.stroke();
      for (let i = 0; i < 9; i++) cloud(ctx, cx + Math.sin(i * 1.3) * 30 + i * 22, top - 40 - i * 34, 40 + i * 7, mix(0x3a2420, 0xff6a1f, Math.max(0, 0.3 - i * 0.05)), 0.55 - i * 0.04);
    });
  } else ridge(ctx, base, f, fill);
  if (b === 'snow') {
    // Snow caps on the ridge peaks.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, BG_H);
    for (let x = 0; x <= BG_W; x += 8) ctx.lineTo(x, base + f(x));
    ctx.lineTo(BG_W, BG_H);
    ctx.clip();
    // Snow only on the high ground: thick on peaks, nothing in the valleys, with a ragged lower edge.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let x = 0; x <= BG_W; x += 8) {
      const h = -f(x);
      const depth = Math.max(0, h - amp * 0.15) * (li === 0 ? 0.9 : 0.6) + Math.sin(x * 0.09) * 4;
      ctx.lineTo(x, base + f(x) + Math.max(0, depth));
    }
    ctx.lineTo(BG_W, 0);
    ctx.closePath();
    const sg = ctx.createLinearGradient(0, base - amp, 0, base + amp);
    sg.addColorStop(0, 'rgba(255,255,255,0.95)');
    sg.addColorStop(1, 'rgba(220,235,255,0.65)');
    ctx.fillStyle = sg;
    ctx.fill();
    ctx.restore();
    if (li > 0) {
      for (let i = 0; i < 26 + li * 10; i++) {
        const x = rand() * BG_W;
        const h = (50 + rand() * 60) * (0.8 + li * 0.35);
        wrapped((ox) => pine(ctx, x + ox, base + f(x) + 14, h, shade(color, 0.92), true));
      }
    }
  }
  if (b === 'jungle' || b === 'training') {
    const n = b === 'jungle' ? 22 - li * 4 : 9 - li * 2;
    for (let i = 0; i < n; i++) {
      const x = rand() * BG_W;
      const h = (90 + rand() * 90) * (0.75 + li * 0.25);
      wrapped((ox) => roundTree(ctx, x + ox, base + f(x) + 20, h, color, s.rim));
    }
    if (b === 'jungle' && li === 1) {
      // Stepped temple ziggurat.
      wrapped((ox) => {
        const tx = BG_W * 0.3 + ox;
        ctx.fillStyle = hex(mix(color, s.rim, 0.12));
        for (let k = 0; k < 5; k++) ctx.fillRect(tx - 150 + k * 30, base - 30 - k * 40, 300 - k * 60, 44);
        ctx.fillRect(tx - 22, base - 250, 44, 60);
        ctx.fillStyle = hex(shade(color, 0.6));
        ctx.fillRect(tx - 9, base - 232, 18, 42);
      });
    }
    if (b === 'training' && li === 1) {
      // Hangar + control tower.
      wrapped((ox) => {
        const hx = BG_W * 0.62 + ox;
        ctx.fillStyle = hex(mix(color, s.rim, 0.1));
        ctx.beginPath();
        ctx.moveTo(hx - 180, base + 40);
        ctx.lineTo(hx - 180, base - 60);
        ctx.quadraticCurveTo(hx, base - 170, hx + 180, base - 60);
        ctx.lineTo(hx + 180, base + 40);
        ctx.fill();
        ctx.fillRect(hx + 260, base - 220, 30, 260);
        ctx.fillRect(hx + 240, base - 260, 70, 44);
        ctx.fillStyle = hex(0xbfe8ff, 0.6);
        ctx.fillRect(hx + 246, base - 252, 58, 14);
      });
    }
    if (b === 'jungle' && li === 2) {
      ctx.strokeStyle = hex(shade(color, 0.9));
      ctx.lineWidth = 4;
      for (let i = 0; i < 14; i++) {
        const x = rand() * BG_W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.quadraticCurveTo(x + 30, 120 + rand() * 80, x - 10, 220 + rand() * 160);
        ctx.stroke();
      }
    }
  }
  if (b === 'desert' && li > 0) {
    for (let i = 0; i < 7; i++) {
      const x = rand() * BG_W;
      const h = 50 + rand() * 50;
      wrapped((ox) => {
        const cx = x + ox;
        const cb = base + f(x) + 10;
        ctx.fillStyle = hex(shade(color, 0.9));
        ctx.lineCap = 'round';
        ctx.strokeStyle = hex(shade(color, 0.9));
        ctx.lineWidth = 12 + li * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cb);
        ctx.lineTo(cx, cb - h);
        ctx.moveTo(cx, cb - h * 0.45);
        ctx.lineTo(cx - 18, cb - h * 0.45);
        ctx.lineTo(cx - 18, cb - h * 0.75);
        ctx.moveTo(cx, cb - h * 0.6);
        ctx.lineTo(cx + 16, cb - h * 0.6);
        ctx.lineTo(cx + 16, cb - h * 0.9);
        ctx.stroke();
      });
    }
  }
  if (b === 'volcano' && li > 0) {
    // Basalt spires with glowing fissures.
    for (let i = 0; i < 10 + li * 4; i++) {
      const x = rand() * BG_W;
      const h = 80 + rand() * 140;
      const w = 26 + rand() * 30;
      wrapped((ox) => {
        const sx = x + ox;
        const sb = base + f(x) + 20;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(sx - w, sb);
        ctx.lineTo(sx - w * 0.3, sb - h);
        ctx.lineTo(sx + w * 0.2, sb - h * 0.9);
        ctx.lineTo(sx + w, sb);
        ctx.fill();
        ctx.strokeStyle = hex(0xff7a1f, 0.5 - li * 0.1);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - w * 0.1, sb - h * 0.75);
        ctx.lineTo(sx + w * 0.1, sb - h * 0.4);
        ctx.lineTo(sx - w * 0.05, sb - h * 0.1);
        ctx.stroke();
      });
    }
    const g = ctx.createLinearGradient(0, BG_H - 140, 0, BG_H);
    g.addColorStop(0, 'rgba(255,90,20,0)');
    g.addColorStop(1, 'rgba(255,90,20,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, BG_H - 140, BG_W, 140);
  }
  rimLine(ctx, base, f, s.rim, 0.25 - li * 0.06);
}

function paintSpace(ctx: Ctx, s: LayerSpec): void {
  const { li, color, rand, th } = s;
  if (li === 0) {
    // Nebula + star field.
    for (let i = 0; i < 7; i++) {
      const x = rand() * BG_W;
      const y = 80 + rand() * 360;
      const r = 160 + rand() * 260;
      const c = i % 2 ? th.accent : 0x5a6cff;
      wrapped((ox) => {
        const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        g.addColorStop(0, hex(c, 0.16));
        g.addColorStop(1, hex(c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y - r, r * 2, r * 2);
      });
    }
    for (let i = 0; i < 520; i++) {
      const sz = rand() < 0.9 ? 1 + rand() * 1.2 : 2 + rand() * 1.6;
      const x = rand() * BG_W;
      const y = rand() * BG_H * 0.9;
      ctx.fillStyle = `rgba(${220 + rand() * 35},${220 + rand() * 35},255,${0.35 + rand() * 0.65})`;
      ctx.beginPath();
      ctx.arc(x, y, sz * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (sz > 2.4) glowDisc(ctx, x, y, 0, 0, 0xcfe0ff, 8, 0.6);
    }
    return;
  }
  // Station modules and trusses.
  const base = BG_H * (0.5 + li * 0.12);
  const fill = silhouetteFill(ctx, base - 200, color, s.haze, s.hazeAmt * 0.6, s.rim);
  for (let i = 0; i < 4 + li; i++) {
    const x = rand() * BG_W;
    const w = 160 + rand() * 220;
    const y = base - 60 - rand() * 160;
    wrapped((ox) => {
      const mx = x + ox;
      ctx.fillStyle = fill;
      ctx.fillRect(mx, y + 26, w, 8);
      ctx.beginPath();
      ctx.roundRect(mx + w * 0.3, y, w * 0.4, 60, 30);
      ctx.fill();
      ctx.fillRect(mx + w * 0.48, y + 60, 10, BG_H);
      // Solar panels.
      ctx.fillStyle = hex(mix(0x2a3a8a, color, 0.4));
      for (const side of [0, 1]) {
        const px = side ? mx + w - 70 : mx;
        ctx.fillRect(px, y + 6, 70, 48);
        ctx.strokeStyle = hex(tint(color, 0.25), 0.5);
        ctx.lineWidth = 1;
        for (let k = 1; k < 5; k++) {
          ctx.beginPath();
          ctx.moveTo(px + k * 14, y + 6);
          ctx.lineTo(px + k * 14, y + 54);
          ctx.stroke();
        }
      }
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = hex(k % 2 ? th.rim : th.accent, 0.9);
        ctx.fillRect(mx + w * 0.34 + k * (w * 0.065), y + 26, 4, 4);
      }
    });
  }
}

function paintLab(ctx: Ctx, s: LayerSpec): void {
  const { li, color, rand, th } = s;
  const fill = silhouetteFill(ctx, 0, color, s.haze, s.hazeAmt * 0.5, s.rim);
  if (li === 0) {
    // Cavern wall with pipes and distant lit windows.
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, BG_W, BG_H);
    for (let i = 0; i < 18; i++) {
      const y = 40 + rand() * (BG_H - 120);
      ctx.fillStyle = hex(shade(color, 1.25), 0.6);
      ctx.fillRect(0, y, BG_W, 6 + rand() * 6);
    }
    for (let i = 0; i < 26; i++) {
      const x = rand() * BG_W;
      const y = 80 + rand() * (BG_H - 220);
      ctx.fillStyle = hex(shade(color, 0.7));
      ctx.fillRect(x, y, 70, 40);
      ctx.fillStyle = hex(rand() > 0.7 ? th.accent : th.rim, 0.45);
      ctx.fillRect(x + 6, y + 6, 58, 12);
    }
    return;
  }
  const base = BG_H * (0.45 + li * 0.15);
  for (let i = 0; i < 5 + li * 2; i++) {
    const x = rand() * BG_W;
    const w = 60 + rand() * 80;
    const h = 120 + rand() * 180;
    wrapped((ox) => {
      const tx = x + ox;
      ctx.fillStyle = fill;
      // Tank with glowing level window.
      ctx.beginPath();
      ctx.roundRect(tx, base - h, w, h + 400, [w / 2, w / 2, 0, 0]);
      ctx.fill();
      const g = ctx.createLinearGradient(0, base - h * 0.7, 0, base - 20);
      g.addColorStop(0, hex(th.rim, 0.1));
      g.addColorStop(1, hex(th.rim, 0.45 - li * 0.1));
      ctx.fillStyle = g;
      ctx.fillRect(tx + w * 0.38, base - h * 0.7, w * 0.24, h * 0.7 - 20);
    });
  }
  ctx.fillStyle = fill;
  for (let i = 0; i < 3; i++) {
    const y = base - 260 + i * 70 + rand() * 30;
    ctx.fillRect(0, y, BG_W, 10 + li * 3);
  }
}

function paintFortress(ctx: Ctx, s: LayerSpec): void {
  const { li, color, rand, th } = s;
  const base = BG_H * (0.45 + li * 0.13);
  const f = ridgeFn(rand, 50 - li * 10, 0.6);
  const fill = silhouetteFill(ctx, base - 300, color, s.haze, s.hazeAmt, s.rim);
  ridge(ctx, base, f, fill);
  if (li === 0) {
    // Castle on the hill.
    wrapped((ox) => {
      const cx = BG_W * 0.58 + ox;
      const cb = base + f(BG_W * 0.58) + 10;
      ctx.fillStyle = fill;
      ctx.fillRect(cx - 160, cb - 140, 320, 160);
      for (const [tx, tw, th2] of [
        [-190, 60, 260],
        [130, 60, 230],
        [-40, 80, 330],
      ]) {
        ctx.fillRect(cx + tx, cb - th2, tw, th2 + 10);
        ctx.beginPath();
        ctx.moveTo(cx + tx - 8, cb - th2);
        ctx.lineTo(cx + tx + tw / 2, cb - th2 - 70);
        ctx.lineTo(cx + tx + tw + 8, cb - th2);
        ctx.fill();
        ctx.fillStyle = hex(0xffd27a, 0.55);
        ctx.fillRect(cx + tx + tw / 2 - 5, cb - th2 + 40, 10, 16);
        ctx.fillStyle = fill;
      }
      for (let k = 0; k < 12; k++) ctx.fillRect(cx - 160 + k * 28, cb - 156, 16, 18);
    });
  } else {
    for (let i = 0; i < 8 + li * 4; i++) {
      const x = rand() * BG_W;
      const h = 70 + rand() * 90;
      wrapped((ox) => {
        const tx = x + ox;
        const tb = base + f(x) + 10;
        ctx.strokeStyle = fill;
        ctx.lineCap = 'round';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(tx, tb);
        ctx.quadraticCurveTo(tx + 6, tb - h * 0.6, tx - 4, tb - h);
        ctx.stroke();
        ctx.lineWidth = 3;
        for (let k = 0; k < 4; k++) {
          const by = tb - h * (0.45 + k * 0.14);
          ctx.beginPath();
          ctx.moveTo(tx + 1, by);
          ctx.quadraticCurveTo(tx + (k % 2 ? 22 : -22), by - 14, tx + (k % 2 ? 34 : -30), by - 30);
          ctx.stroke();
        }
      });
    }
    if (li === 2) {
      for (let i = 0; i < 12; i++) {
        const x = rand() * BG_W;
        wrapped((ox) => {
          ctx.fillStyle = fill;
          ctx.beginPath();
          ctx.roundRect(x + ox, base + f(x) - 26, 22, 40, [11, 11, 0, 0]);
          ctx.fill();
        });
      }
    }
  }
  rimLine(ctx, base, f, th.accent, 0.18);
}

/** Paint parallax layer `li` (0 far .. 2 near) for a theme. Cached per map id. */
export function backdropLayer(scene: Phaser.Scene, th: MapTheme, id: string, li: number): string {
  const key = `bg2:${id}:${li}`;
  if (scene.textures.exists(key)) return key;
  const [c, ctx] = canvas(BG_W, BG_H);
  ctx.lineJoin = 'round';
  const color = [th.far, th.mid, th.near][li];
  const spec: LayerSpec = {
    li,
    color,
    haze: th.skyBottom,
    hazeAmt: [0.55, 0.35, 0.18][li],
    rim: mix(th.skyBottom, 0xffffff, 0.2),
    th,
    rand: seededRandom(li * 977 + id.length * 31 + th.backdrop.length * 7 + 3),
  };
  switch (th.backdrop) {
    case 'city':
      paintCity(ctx, spec, false);
      break;
    case 'harbor':
      paintCity(ctx, spec, true);
      break;
    case 'space':
      paintSpace(ctx, spec);
      break;
    case 'lab':
      paintLab(ctx, spec);
      break;
    case 'fortress':
      paintFortress(ctx, spec);
      break;
    default:
      paintNature(ctx, spec);
  }
  // Atmospheric perspective: distant layers dissolve into the horizon haze.
  if (li < 2 && th.backdrop !== 'space' && th.backdrop !== 'lab') haze(ctx, BG_H * 0.45, th.skyBottom, li === 0 ? 0.55 : 0.3);
  scene.textures.addCanvas(key, c);
  return key;
}

/** Sky: tall gradient + celestial body + soft glow, drawn for a given aspect so discs stay round. */
export function skyTexture(scene: Phaser.Scene, th: MapTheme, id: string): string {
  const key = `sky2:${id}`;
  if (scene.textures.exists(key)) return key;
  const W = 1024;
  const H = 640;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, hex(th.skyTop));
  g.addColorStop(0.55, hex(mix(th.skyTop, th.skyBottom, 0.55)));
  g.addColorStop(1, hex(th.skyBottom));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const b = th.backdrop;
  const rand = seededRandom(id.length * 13 + 5);
  if (b === 'city' || b === 'desert') glowDisc(ctx, W * 0.7, H * (b === 'city' ? 0.62 : 0.3), b === 'city' ? 70 : 46, b === 'city' ? 0xffb36a : 0xfff4c8, b === 'city' ? 0xff9a5a : 0xffe8a0, 420);
  else if (b === 'fortress') {
    glowDisc(ctx, W * 0.72, H * 0.26, 64, 0xe8ecff, 0xb0b8ff, 360, 0.9);
    ctx.fillStyle = 'rgba(160,165,200,0.35)';
    for (const [x, y, r] of [
      [0.7, 0.24, 12],
      [0.74, 0.3, 8],
      [0.69, 0.3, 6],
    ]) {
      ctx.beginPath();
      ctx.arc(W * x, H * y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (b === 'space') {
    // Ringed gas giant with terminator shading.
    const px = W * 0.74;
    const py = H * 0.32;
    const pr = 110;
    glowDisc(ctx, px, py, 0, 0, th.accent, 260, 0.6);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.35);
    ctx.strokeStyle = hex(tint(th.accent, 0.4), 0.5);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.75, pr * 0.32, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const pg = ctx.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr);
    pg.addColorStop(0, hex(tint(th.accent, 0.45)));
    pg.addColorStop(0.6, hex(th.accent));
    pg.addColorStop(1, hex(shade(th.accent, 0.25)));
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.clip();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = hex(i % 2 ? shade(th.accent, 0.75) : tint(th.accent, 0.2), 0.35);
      ctx.fillRect(px - pr, py - pr * 0.7 + i * pr * 0.26, pr * 2, pr * 0.1);
    }
    const sh = ctx.createLinearGradient(px - pr, 0, px + pr, 0);
    sh.addColorStop(0.45, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(0,0,10,0.7)');
    ctx.fillStyle = sh;
    ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    ctx.restore();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-0.35);
    ctx.strokeStyle = hex(tint(th.accent, 0.5), 0.75);
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.ellipse(0, 0, pr * 1.75, pr * 0.32, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();
  } else if (b === 'volcano') {
    const vg = ctx.createRadialGradient(W * 0.5, H, 0, W * 0.5, H, H * 0.9);
    vg.addColorStop(0, 'rgba(255,110,40,0.45)');
    vg.addColorStop(1, 'rgba(255,110,40,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  } else if (b === 'snow') {
    // Soft aurora ribbons.
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, H * (0.18 + i * 0.07) + Math.sin(x * 0.006 + i) * 30);
      ctx.strokeStyle = hex(i === 1 ? 0x9affd8 : 0xb8d8ff, 0.18);
      ctx.lineWidth = 34 - i * 8;
      ctx.stroke();
    }
    glowDisc(ctx, W * 0.25, H * 0.22, 34, 0xffffff, 0xffffff, 200, 0.7);
  } else if (b === 'jungle' || b === 'training' || b === 'harbor') {
    glowDisc(ctx, W * 0.2, H * 0.18, b === 'harbor' ? 0 : 40, 0xfffbe0, 0xfff1b0, 340, b === 'harbor' ? 0.4 : 0.8);
    if (b === 'jungle') {
      // God rays through the canopy.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const x0 = W * 0.1 + i * 70;
        const rg = ctx.createLinearGradient(x0, 0, x0 + 300, H);
        rg.addColorStop(0, 'rgba(255,250,200,0.12)');
        rg.addColorStop(1, 'rgba(255,250,200,0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0 + 30, 0);
        ctx.lineTo(x0 + 360, H);
        ctx.lineTo(x0 + 240, H);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (b !== 'space' && b !== 'lab' && b !== 'volcano') {
    for (let i = 0; i < 7; i++) {
      const cc = b === 'fortress' ? 0x3a3658 : b === 'harbor' ? 0x50687e : b === 'city' ? 0xff9f80 : 0xffffff;
      cloud(ctx, rand() * W, 60 + rand() * H * 0.4, 30 + rand() * 40, cc, b === 'fortress' ? 0.35 : 0.5);
    }
  }
  if (b === 'volcano') for (let i = 0; i < 6; i++) cloud(ctx, rand() * W, 40 + rand() * 180, 40 + rand() * 50, 0x2a1210, 0.6);
  scene.textures.addCanvas(key, c);
  return key;
}
