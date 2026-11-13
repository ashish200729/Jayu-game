/**
 * Deterministic math for the simulation. Only IEEE-754 basic operations (+ - * / sqrt) are used,
 * which are exactly rounded on every JS engine, so V8 (Node, Chrome, Android WebView) and
 * JavaScriptCore (Safari, iOS) produce bit-identical results. Math.sin/cos/atan2 are NOT exactly
 * specified and must never be used inside the sim.
 *
 * Angles are 16-bit binary angles: 0..65535 maps to 0..2π, increasing clockwise on screen
 * (because screen y points down): 0 = right, 16384 = down, 32768 = left, 49152 = up.
 */
export const ANGLE_ONE = 65536;
const TABLE_BITS = 14;
const TABLE_SIZE = 1 << TABLE_BITS; // quarter-turn resolution * 4
const SIN = new Float64Array(TABLE_SIZE + 1);

function taylorSin(x: number): number {
  // x in [0, π/2]; 11 terms is far below float64 epsilon there.
  let term = x;
  let sum = x;
  const x2 = x * x;
  for (let n = 1; n < 12; n++) {
    term = (-term * x2) / ((2 * n) * (2 * n + 1));
    sum += term;
  }
  return sum;
}

const PI = 3.141592653589793;
for (let i = 0; i <= TABLE_SIZE; i++) {
  const quarter = TABLE_SIZE / 4;
  const k = i % TABLE_SIZE;
  const q = Math.floor(k / quarter);
  const r = k - q * quarter;
  const a = (r / quarter) * (PI / 2);
  let v: number;
  if (q === 0) v = taylorSin(a);
  else if (q === 1) v = taylorSin(PI / 2 - a);
  else if (q === 2) v = -taylorSin(a);
  else v = -taylorSin(PI / 2 - a);
  SIN[i] = v;
}

export function wrapAngle(a: number): number {
  return ((a % ANGLE_ONE) + ANGLE_ONE) % ANGLE_ONE;
}

export function dsin(a: number): number {
  const idx = (wrapAngle(Math.round(a)) >> (16 - TABLE_BITS)) & (TABLE_SIZE - 1);
  return SIN[idx];
}

export function dcos(a: number): number {
  return dsin(a + ANGLE_ONE / 4);
}

/** Deterministic atan2 returning a 16-bit binary angle. Max error ~0.005 rad. */
export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  const mn = ax < ay ? ax : ay;
  const mx = ax < ay ? ay : ax;
  const a = mn / mx;
  const s = a * a;
  // Polynomial approximation of atan on [0,1] (radians).
  let r = ((-0.0464964749 * s + 0.15931422) * s - 0.327622764) * s * a + a;
  if (ay > ax) r = 1.5707963267948966 - r;
  if (x < 0) r = PI - r;
  if (y < 0) r = -r;
  return wrapAngle(Math.round((r / (2 * PI)) * ANGLE_ONE));
}

export function angleToRad(a: number): number {
  return (a / ANGLE_ONE) * 2 * PI;
}

export function radToAngle(r: number): number {
  return wrapAngle(Math.round((r / (2 * PI)) * ANGLE_ONE));
}

/** Smallest signed difference b - a in binary angle units (-32768..32767). */
export function angleDiff(a: number, b: number): number {
  let d = wrapAngle(b - a);
  if (d >= ANGLE_ONE / 2) d -= ANGLE_ONE;
  return d;
}

/** Quantise to 1/8 px (or px/s). All persistent positional state is stored quantised so snapshots are exact. */
export function q8(v: number): number {
  return Math.round(v * 8) / 8;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function approach(v: number, target: number, step: number): number {
  if (v < target) return v + step > target ? target : v + step;
  if (v > target) return v - step < target ? target : v - step;
  return v;
}

/** mulberry32: tiny deterministic PRNG with 32-bit integer state. */
export class Rng {
  state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 0x9e3779b9;
  }
  nextU32(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** Uniform in [0,1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(n: number): number {
    return this.nextU32() % n;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
}

/** FNV-1a over 32-bit words; used for state hashes. */
export class Hasher {
  h = 0x811c9dc5;
  private buf = new DataView(new ArrayBuffer(8));
  int(v: number): void {
    v = v | 0;
    for (let i = 0; i < 4; i++) {
      this.h ^= (v >>> (i * 8)) & 0xff;
      this.h = Math.imul(this.h, 0x01000193);
    }
  }
  num(v: number): void {
    this.buf.setFloat64(0, v);
    this.int(this.buf.getInt32(0));
    this.int(this.buf.getInt32(4));
  }
  get value(): number {
    return this.h >>> 0;
  }
}
