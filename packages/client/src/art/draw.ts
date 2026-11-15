/** Canvas helpers for procedural art. */

/** World-art resolution multiplier for small shared textures (pickups, projectiles). */
export const ART_SCALE = 2;
/** Character parts and guns are drawn at 4x so they stay crisp at high camera zoom on retina screens. */
export const CHAR_SCALE = 4;

/** Canvas font stack. Family names containing digits MUST be quoted or the whole font string is rejected. */
export const GAME_FONT = '"Baloo 2", "Noto Sans Devanagari", system-ui, sans-serif';

export const INK = 0x151821;

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

export function hex(c: number, a = 1): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

export function shade(c: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

/** Lighten towards white (keeps saturation better than multiplying for bright colours). */
export function tint(c: number, t: number): number {
  return mix(c, 0xffffff, t);
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
}

/** Outline colour derived from the fill: a deep, slightly saturated version reads richer than flat black. */
export function lineOf(c: number): number {
  return mix(shade(c, 0.32), INK, 0.55);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fill + thick dark outline: the game's cartoon line style. */
export function inked(ctx: CanvasRenderingContext2D, fill: string, line = '#1b1d26', width = 2 * ART_SCALE): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = line;
  ctx.stroke();
}

export interface PaintOpts {
  /** Outline width in art units (0 = none). */
  line?: number;
  /** Outline colour (defaults to a deep version of the fill). */
  outline?: number;
  /** Top highlight strength 0..1. */
  hi?: number;
  /** Bottom shadow strength 0..1. */
  lo?: number;
  /** Gradient direction: vertical (default) or horizontal (x0..x1 passed as y0..y1). */
  horizontal?: boolean;
  /** Specular glint ellipse (x, y, rx, ry) in art units. */
  glint?: [number, number, number, number];
}

/**
 * Fill the current path with a volumetric top-lit gradient, a soft top sheen and a coloured outline.
 * `y0..y1` is the vertical extent of the shape (used for the gradient).
 */
export function paint(ctx: CanvasRenderingContext2D, color: number, y0: number, y1: number, o: PaintOpts = {}): void {
  const hi = o.hi ?? 1;
  const lo = o.lo ?? 1;
  const g = o.horizontal ? ctx.createLinearGradient(y0, 0, y1, 0) : ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, hex(tint(color, 0.22 * hi)));
  g.addColorStop(0.45, hex(color));
  g.addColorStop(1, hex(shade(color, 1 - 0.32 * lo)));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (hi > 0) {
    const h = (y1 - y0) * 0.38;
    const s = o.horizontal ? ctx.createLinearGradient(y0, 0, y0 + h, 0) : ctx.createLinearGradient(0, y0, 0, y0 + h);
    s.addColorStop(0, `rgba(255,255,255,${0.32 * hi})`);
    s.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = s;
    if (o.horizontal) ctx.fillRect(y0, -999, h, 1999);
    else ctx.fillRect(-999, y0, 1999, h);
  }
  if (o.glint) {
    const [gx, gy, rx, ry] = o.glint;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(gx, gy, rx, ry, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const lw = o.line ?? 1.25;
  if (lw > 0) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = lw;
    ctx.strokeStyle = hex(o.outline ?? lineOf(color));
    ctx.stroke();
  }
}

/** Round-rect shorthand for `paint`. */
export function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: number, o: PaintOpts = {}): void {
  roundRect(ctx, x, y, w, h, r);
  paint(ctx, color, y, y + h, o);
}

/** Soft inner shading along the bottom of the current clip region (ambient occlusion). */
export function occlude(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a = 0.35): void {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 4294967296;
  };
}
