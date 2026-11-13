/**
 * One player input per sim step. Device independent: touch, keyboard/mouse and gamepad all map to this.
 * One-shot actions (throw, swap, reload, melee, signal) are 4-bit rolling counters instead of flags,
 * so a lost, duplicated or repeated input packet can never trigger an action twice or drop it.
 */
export interface Input {
  seq: number;
  /** -127..127 */
  moveX: number;
  /** -127..127 (negative = up) */
  moveY: number;
  /** 16-bit binary angle */
  aim: number;
  buttons: number;
  /** packed counters: throw | swap<<4 | reload<<8 | melee<<12 | signal<<16 */
  actions: number;
  /** 0..255 grenade throw strength, read when the throw counter changes */
  throwPower: number;
  /** Signal payload read when the signal counter changes: emote (1..6), quick chat (16..23), survival upgrade (32..34). */
  signal: number;
  /** Server tick of the remote players the client was looking at (lag compensation). */
  viewTick: number;
}

export const BTN_FIRE = 1;
export const BTN_JET = 2;
export const BTN_CROUCH = 4;
export const BTN_ZOOM = 8;

export const ACT_THROW = 0;
export const ACT_SWAP = 4;
export const ACT_RELOAD = 8;
export const ACT_MELEE = 12;
export const ACT_SIGNAL = 16;

export const SIGNAL_EMOTE = 0;
export const SIGNAL_CHAT = 16;
export const SIGNAL_UPGRADE = 32;

export function counter(actions: number, shift: number): number {
  return (actions >>> shift) & 0xf;
}

export function bumpCounter(actions: number, shift: number): number {
  const c = (counter(actions, shift) + 1) & 0xf;
  return (actions & ~(0xf << shift)) | (c << shift);
}

export function emptyInput(seq = 0): Input {
  return { seq, moveX: 0, moveY: 0, aim: 0, buttons: 0, actions: 0, throwPower: 0, signal: 0, viewTick: 0 };
}

export function copyInput(src: Input, dst: Input = emptyInput()): Input {
  dst.seq = src.seq;
  dst.moveX = src.moveX;
  dst.moveY = src.moveY;
  dst.aim = src.aim;
  dst.buttons = src.buttons;
  dst.actions = src.actions;
  dst.throwPower = src.throwPower;
  dst.signal = src.signal;
  dst.viewTick = src.viewTick;
  return dst;
}

/** Clamp and quantise an input received from the network (never trust clients). */
export function sanitizeInput(i: Input): Input {
  i.moveX = Math.max(-127, Math.min(127, Math.round(i.moveX) || 0));
  i.moveY = Math.max(-127, Math.min(127, Math.round(i.moveY) || 0));
  i.aim = (Math.round(i.aim) || 0) & 0xffff;
  i.buttons = (i.buttons | 0) & 0xf;
  i.actions = (i.actions | 0) & 0xfffff;
  i.throwPower = Math.max(0, Math.min(255, i.throwPower | 0));
  i.signal = Math.max(0, Math.min(255, i.signal | 0));
  i.viewTick = Math.max(0, i.viewTick | 0);
  return i;
}
