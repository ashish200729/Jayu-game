import { DT, PLAYER, TICK_RATE, TILE } from '@game/content';
import { Tile } from '@game/maps';
import { BTN_CROUCH, BTN_JET, type Input } from './input';
import { approach, q8 } from './math';
import type { MoveState } from './types';
import { World } from './world';

export const MEDIUM_WATER = 1;
export const MEDIUM_VINE = 2;
export const MEDIUM_LOWGRAV = 4;
export const MEDIUM_VENT = 8;
export const MEDIUM_LAVA = 16;

const HW = PLAYER.width / 2;
const EPS = 0.01;
const FUEL_Q = 64;

export interface MoveMods {
  speedMult: number;
  fuelMult: number;
  /** Countdown / dead / intermission: no movement input. */
  frozen: boolean;
}

export const DEFAULT_MODS: MoveMods = { speedMult: 1, fuelMult: 1, frozen: false };

export type MoveStateExt = MoveState;

export function newMoveState(x: number, y: number): MoveStateExt {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    onGround: false,
    crouch: false,
    slideT: 0,
    jetT: 0,
    fuel: PLAYER.fuelMax,
    fuelDelay: 0,
    facing: 1,
    wall: 0,
    jetting: false,
    medium: 0,
    prevJet: false,
    ride: -1,
    dropT: 0,
  };
}

export function copyMoveState(src: MoveStateExt, dst: MoveStateExt): MoveStateExt {
  dst.x = src.x;
  dst.y = src.y;
  dst.vx = src.vx;
  dst.vy = src.vy;
  dst.onGround = src.onGround;
  dst.crouch = src.crouch;
  dst.slideT = src.slideT;
  dst.jetT = src.jetT;
  dst.fuel = src.fuel;
  dst.fuelDelay = src.fuelDelay;
  dst.facing = src.facing;
  dst.wall = src.wall;
  dst.jetting = src.jetting;
  dst.medium = src.medium;
  dst.prevJet = src.prevJet;
  dst.ride = src.ride;
  dst.dropT = src.dropT;
  return dst;
}

export function bodyHeight(s: MoveState): number {
  return s.crouch ? PLAYER.crouchHeight : PLAYER.height;
}

const off = { x: 0, y: 0 };
const off2 = { x: 0, y: 0 };

function mediumAt(world: World, s: MoveState, h: number): number {
  let m = 0;
  const x0 = Math.floor((s.x - HW) / TILE);
  const x1 = Math.floor((s.x + HW - EPS) / TILE);
  const y0 = Math.floor((s.y - h) / TILE);
  const y1 = Math.floor((s.y - EPS) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = world.tileAt(tx, ty);
      if (t === Tile.Water) m |= MEDIUM_WATER;
      else if (t === Tile.Vine) m |= MEDIUM_VINE;
      else if (t === Tile.LowGrav) m |= MEDIUM_LOWGRAV;
      else if (t === Tile.Vent) m |= MEDIUM_VENT;
      else if (t === Tile.Lava) m |= MEDIUM_LAVA;
    }
  }
  return m;
}

function overlapsRect(x: number, y: number, h: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return x - HW < rx + rw && x + HW > rx && y - h < ry + rh && y > ry;
}

/** True if the body at (x, y) with height h overlaps a solid tile or a closed door/bridge it was not already inside. */
export function bodyBlocked(world: World, x: number, y: number, h: number, tick: number): boolean {
  const x0 = Math.floor((x - HW) / TILE);
  const x1 = Math.floor((x + HW - EPS) / TILE);
  const y0 = Math.floor((y - h) / TILE);
  const y1 = Math.floor((y - EPS) / TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) if (World.isSolidTile(world.tileAt(tx, ty))) return true;
  for (const m of world.movers) {
    if (m.kind === 'platform') continue;
    if (world.moverSolid(m, tick) && overlapsRect(x, y, h, m.x, m.y, m.w, m.h)) return true;
  }
  return false;
}

function moveX(s: MoveStateExt, dx: number, world: World, tick: number, h: number): void {
  const oldX = s.x;
  let nx = s.x + dx;
  const y0 = Math.floor((s.y - h) / TILE);
  const y1 = Math.floor((s.y - EPS) / TILE);
  if (dx > 0) {
    const tx = Math.floor((nx + HW - EPS) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (World.isSolidTile(world.tileAt(tx, ty))) {
        nx = tx * TILE - HW;
        s.vx = 0;
        s.wall = 1;
        break;
      }
    }
  } else if (dx < 0) {
    const tx = Math.floor((nx - HW) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (World.isSolidTile(world.tileAt(tx, ty))) {
        nx = (tx + 1) * TILE + HW;
        s.vx = 0;
        s.wall = -1;
        break;
      }
    }
  }
  for (const m of world.movers) {
    if (m.kind === 'platform' || !world.moverSolid(m, tick)) continue;
    if (overlapsRect(nx, s.y, h, m.x, m.y, m.w, m.h) && !overlapsRect(oldX, s.y, h, m.x, m.y, m.w, m.h)) {
      if (dx > 0) {
        nx = m.x - HW;
        s.wall = 1;
      } else {
        nx = m.x + m.w + HW;
        s.wall = -1;
      }
      s.vx = 0;
    }
  }
  s.x = nx;
}

function moveY(s: MoveStateExt, dy: number, world: World, tick: number, h: number, dropping: boolean): void {
  const oldBottom = s.y;
  const oldTop = s.y - h;
  let ny = s.y + dy;
  const x0 = Math.floor((s.x - HW) / TILE);
  const x1 = Math.floor((s.x + HW - EPS) / TILE);
  if (dy > 0) {
    const oldRow = Math.floor((oldBottom - EPS) / TILE);
    const row = Math.floor((ny - EPS) / TILE);
    if (row > oldRow) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = world.tileAt(tx, row);
        if (World.isSolidTile(t) || (t === Tile.OneWay && !dropping && oldBottom <= row * TILE + EPS)) {
          ny = row * TILE;
          s.vy = 0;
          s.onGround = true;
          s.ride = -1;
          break;
        }
      }
    }
    for (let i = 0; i < world.movers.length; i++) {
      const m = world.movers[i];
      if (m.kind === 'platform') {
        if (dropping) continue;
        world.platformOffset(m, tick, off);
        const top = m.y + off.y;
        const left = m.x + off.x;
        if (s.x + HW > left && s.x - HW < left + m.w && oldBottom <= top + 6 && ny >= top) {
          ny = top;
          s.vy = 0;
          s.onGround = true;
          s.ride = i;
        }
      } else if (world.moverSolid(m, tick)) {
        if (overlapsRect(s.x, ny, h, m.x, m.y, m.w, m.h) && !overlapsRect(s.x, oldBottom, h, m.x, m.y, m.w, m.h)) {
          ny = m.y;
          s.vy = 0;
          s.onGround = true;
          s.ride = -1;
        }
      }
    }
  } else if (dy < 0) {
    const oldRow = Math.floor(oldTop / TILE);
    const row = Math.floor((ny - h) / TILE);
    if (row < oldRow) {
      for (let tx = x0; tx <= x1; tx++) {
        if (World.isSolidTile(world.tileAt(tx, row))) {
          ny = (row + 1) * TILE + h;
          s.vy = 0;
          break;
        }
      }
    }
    for (const m of world.movers) {
      if (m.kind === 'platform' || !world.moverSolid(m, tick)) continue;
      if (overlapsRect(s.x, ny, h, m.x, m.y, m.w, m.h) && !overlapsRect(s.x, oldBottom, h, m.x, m.y, m.w, m.h)) {
        ny = m.y + m.h + h;
        s.vy = 0;
      }
    }
  }
  s.y = ny;
}

/**
 * Advance one player's movement by one fixed step. Pure function of (state, input, world, tick):
 * the host and client prediction call exactly this.
 */
export function stepMovement(s: MoveStateExt, input: Input, world: World, tick: number, mods: MoveMods = DEFAULT_MODS): void {
  const frozen = mods.frozen;
  const mx = frozen ? 0 : input.moveX / 127;
  const wantJet = !frozen && (input.buttons & BTN_JET) !== 0;
  const wantCrouch = !frozen && ((input.buttons & BTN_CROUCH) !== 0 || input.moveY > 80);
  const wantDrop = !frozen && input.moveY > 100;

  // Ride moving platforms.
  if (s.ride >= 0 && s.onGround) {
    const m = world.movers[s.ride];
    world.platformOffset(m, tick, off);
    world.platformOffset(m, tick - 1, off2);
    const nx = s.x + (off.x - off2.x);
    if (!bodyBlocked(world, nx, s.y, bodyHeight(s), tick)) s.x = nx;
    s.y = m.y + off.y;
  }

  // Crouch (needs headroom to stand back up).
  const wasCrouch = s.crouch;
  if (wantCrouch && s.onGround) s.crouch = true;
  else if (s.crouch) {
    if (!bodyBlocked(world, s.x, s.y, PLAYER.height, tick)) s.crouch = false;
  }
  const h = bodyHeight(s);
  s.medium = mediumAt(world, s, h);
  const inWater = (s.medium & MEDIUM_WATER) !== 0;

  // Drop through one-way platforms.
  if (wantDrop && s.onGround && s.ride >= 0) s.dropT = 12;
  if (wantDrop && s.onGround) {
    const row = Math.floor((s.y + 1) / TILE);
    const x0 = Math.floor((s.x - HW) / TILE);
    const x1 = Math.floor((s.x + HW - EPS) / TILE);
    let allOneWay = true;
    for (let tx = x0; tx <= x1; tx++) {
      const t = world.tileAt(tx, row);
      if (t !== Tile.OneWay && t !== Tile.Empty && t !== Tile.Vine) allOneWay = false;
    }
    if (allOneWay) s.dropT = 12;
  }
  if (s.dropT > 0) s.dropT--;

  // Slide when crouching at speed.
  if (s.crouch && !wasCrouch && s.onGround && Math.abs(s.vx) > PLAYER.runSpeed * 0.75) {
    s.slideT = Math.round(PLAYER.slideTime * TICK_RATE);
    s.vx = s.vx > 0 ? PLAYER.slideSpeed : -PLAYER.slideSpeed;
  }
  if (s.slideT > 0) {
    s.slideT--;
    if (!s.crouch || !s.onGround) s.slideT = 0;
  }

  // Horizontal control.
  const groundTile = s.onGround ? world.tileAtPx(s.x, s.y + 1) : 0;
  const onIce = groundTile === Tile.Ice;
  let speed = PLAYER.runSpeed * mods.speedMult;
  if (s.crouch) speed *= PLAYER.crouchSpeedMult;
  if (inWater) speed *= PLAYER.waterSpeedMult;
  const target = mx * speed;
  if (s.slideT > 0) {
    s.vx = approach(s.vx, 0, PLAYER.slideFriction * DT);
  } else if (s.onGround) {
    if (Math.abs(mx) > 0.05) {
      const accel = onIce ? PLAYER.iceAccel : PLAYER.groundAccel;
      s.vx = approach(s.vx, target, accel * DT);
    } else {
      s.vx = approach(s.vx, 0, (onIce ? PLAYER.iceFriction : PLAYER.groundFriction) * DT);
    }
  } else {
    if (Math.abs(mx) > 0.05) {
      if ((target > 0 && s.vx < target) || (target < 0 && s.vx > target)) s.vx = approach(s.vx, target, PLAYER.airAccel * DT);
    } else {
      s.vx = approach(s.vx, 0, PLAYER.airDrag * DT);
    }
  }
  if (Math.abs(mx) > 0.05) s.facing = mx > 0 ? 1 : -1;

  // Jetpack.
  const fuelMax = PLAYER.fuelMax * mods.fuelMult;
  if (wantJet && s.fuel > 0) {
    if (s.onGround && !s.prevJet) {
      s.vy = -PLAYER.hopImpulse;
    }
    s.jetT++;
    const ramp = Math.min(1, PLAYER.jetRampStart + ((1 - PLAYER.jetRampStart) * s.jetT) / (PLAYER.jetRampTime * TICK_RATE));
    s.vy -= PLAYER.jetAccel * ramp * DT;
    if (s.vy < -PLAYER.jetMaxRise) s.vy = approach(s.vy, -PLAYER.jetMaxRise, PLAYER.jetAccel * 2 * DT);
    s.fuel = Math.max(0, s.fuel - PLAYER.fuelDrain * DT);
    s.fuelDelay = Math.round(PLAYER.fuelRefillDelay * TICK_RATE);
    s.jetting = true;
    s.onGround = false;
    s.ride = -1;
  } else {
    s.jetT = 0;
    s.jetting = false;
  }
  s.prevJet = wantJet;
  if ((s.medium & MEDIUM_VENT) !== 0) {
    s.fuel = Math.min(fuelMax, s.fuel + PLAYER.fuelRefill * 2 * DT);
  } else if (s.onGround && !s.jetting) {
    if (s.fuelDelay > 0) s.fuelDelay--;
    else s.fuel = Math.min(fuelMax, s.fuel + PLAYER.fuelRefill * DT);
  }
  if (s.fuel > fuelMax) s.fuel = fuelMax;

  // Gravity and vertical caps.
  let g = PLAYER.gravity * world.gravityMult;
  if (s.medium & MEDIUM_LOWGRAV) g *= PLAYER.lowGravMult;
  if (inWater) g *= PLAYER.waterGravityMult;
  s.vy += g * DT;
  if (s.medium & MEDIUM_VENT) {
    s.vy -= PLAYER.ventLift * DT;
    if (s.vy < -PLAYER.ventMaxRise) s.vy = -PLAYER.ventMaxRise;
  }
  let maxFall: number = PLAYER.maxFall;
  if (s.medium & MEDIUM_VINE) maxFall = PLAYER.vineMaxFall;
  if (inWater) maxFall = PLAYER.waterMaxFall;
  if (s.wall !== 0 && !s.onGround && Math.sign(mx) === s.wall) maxFall = Math.min(maxFall, PLAYER.wallSlideMaxFall);
  if (s.vy > maxFall) s.vy = approach(s.vy, maxFall, 2400 * DT);
  if (s.vx > PLAYER.maxSpeed) s.vx = PLAYER.maxSpeed;
  if (s.vx < -PLAYER.maxSpeed) s.vx = -PLAYER.maxSpeed;
  if (s.vy > PLAYER.maxSpeed) s.vy = PLAYER.maxSpeed;
  if (s.vy < -PLAYER.maxSpeed) s.vy = -PLAYER.maxSpeed;

  // Integrate with collision in sub-steps no larger than 12 px.
  s.wall = 0;
  const wasGround = s.onGround;
  s.onGround = false;
  const dx = s.vx * DT;
  const dy = s.vy * DT;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 12));
  for (let i = 0; i < steps; i++) {
    moveX(s, dx / steps, world, tick, h);
    moveY(s, dy / steps, world, tick, h, s.dropT > 0);
  }
  if (!s.onGround && wasGround && s.vy >= 0 && s.ride >= 0) {
    // Stay glued to a platform that moved down this tick.
    const m = world.movers[s.ride];
    world.platformOffset(m, tick, off);
    const top = m.y + off.y;
    if (s.x + HW > m.x + off.x && s.x - HW < m.x + off.x + m.w && Math.abs(s.y - top) < 8) {
      s.y = top;
      s.onGround = true;
      s.vy = 0;
    }
  }
  if (!s.onGround) s.ride = -1;
  // Probe for walls the player is pressing into while airborne (wall slide).
  if (!s.onGround && s.wall === 0 && Math.abs(mx) > 0.05) {
    const probeX = s.x + (mx > 0 ? HW + 1 : -HW - 1);
    if (World.isSolidTile(world.tileAtPx(probeX, s.y - h / 2))) s.wall = mx > 0 ? 1 : -1;
  }

  s.x = q8(s.x);
  s.y = q8(s.y);
  s.vx = q8(s.vx);
  s.vy = q8(s.vy);
  s.fuel = Math.round(s.fuel * FUEL_Q) / FUEL_Q;
  s.medium = mediumAt(world, s, h);
}
