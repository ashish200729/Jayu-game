import { TICK_RATE, WEAPONS } from '@game/content';
import type { ClientView } from '@game/net';
import {
  ACT_MELEE,
  ACT_RELOAD,
  ACT_SIGNAL,
  ACT_SWAP,
  ACT_THROW,
  BTN_CROUCH,
  BTN_FIRE,
  BTN_JET,
  BTN_ZOOM,
  angleDiff,
  bumpCounter,
  datan2,
  radToAngle,
  type Input,
} from '@game/sim';

export interface ControlSettings {
  aimToFire: boolean;
  jetButton: boolean;
  deadZone: number;
  sensitivity: number;
  aimAssist: boolean;
  holdToToggle: boolean;
  keymap: Record<string, string[]>;
}

/** Touch state written by the HUD scene each frame. */
export interface TouchState {
  move: { x: number; y: number; active: boolean };
  aim: { x: number; y: number; active: boolean };
  fire: boolean;
  jet: boolean;
  zoomToggle: boolean;
  crouchToggle: boolean;
  grenadeDrag: { active: boolean; x: number; y: number };
}

export type Device = 'touch' | 'keyboard' | 'gamepad';

/**
 * Converts devices into the single device-independent Input the sim understands.
 * The sim never knows which device was used.
 */
export class Controls {
  device: Device = 'keyboard';
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, buttons: 0, moved: false };
  private actions = 0;
  private signalValue = 0;
  private throwPower = 0;
  private throwAim: number | null = null;
  private grenadeHoldStart = -1;
  private zoomOn = false;
  private crouchOn = false;
  private prevKeys = new Set<string>();
  private prevPad: boolean[] = [];
  private lastAim = 0;
  readonly touch: TouchState = {
    move: { x: 0, y: 0, active: false },
    aim: { x: 0, y: 0, active: false },
    fire: false,
    jet: false,
    zoomToggle: false,
    crouchToggle: false,
    grenadeDrag: { active: false, x: 0, y: 0 },
  };
  /** World-space aim target from the mouse (set by the scene each frame). */
  mouseWorld: { x: number; y: number } | null = null;
  /** Screen position of the local player (for mouse aim). */
  playerScreen = { x: 0, y: 0 };
  /** Grenade charge 0..1 while held (for the arc preview), or -1. */
  charge = -1;
  chargeAim = 0;
  onPause: (() => void) | null = null;
  onScoreboard: ((show: boolean) => void) | null = null;
  onEmoteWheel: (() => void) | null = null;
  onDigit: ((n: number) => void) | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private target: HTMLElement,
    public settings: ControlSettings,
  ) {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.device = 'keyboard';
      this.keys.add(e.code);
      if (this.isAction('scoreboard', e.code)) {
        e.preventDefault();
        this.onScoreboard?.(true);
      }
      if (this.isAction('pause', e.code)) this.onPause?.();
      if (this.isAction('emote', e.code)) this.onEmoteWheel?.();
      if (/^Digit[1-9]$/.test(e.code)) this.onDigit?.(Number(e.code.slice(5)));
      if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      if (this.isAction('scoreboard', e.code)) this.onScoreboard?.(false);
    };
    const blur = () => {
      this.keys.clear();
      this.mouse.buttons = 0;
    };
    const mmove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = target.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.moved = true;
      this.device = 'keyboard';
    };
    const mdown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') {
        this.device = 'touch';
        return;
      }
      this.mouse.buttons |= 1 << e.button;
      this.device = 'keyboard';
    };
    const mup = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.buttons &= ~(1 << e.button);
    };
    const ctx = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    target.addEventListener('pointermove', mmove);
    target.addEventListener('pointerdown', mdown);
    window.addEventListener('pointerup', mup);
    target.addEventListener('contextmenu', ctx);
    this.cleanup.push(
      () => window.removeEventListener('keydown', down),
      () => window.removeEventListener('keyup', up),
      () => window.removeEventListener('blur', blur),
      () => target.removeEventListener('pointermove', mmove),
      () => target.removeEventListener('pointerdown', mdown),
      () => window.removeEventListener('pointerup', mup),
      () => target.removeEventListener('contextmenu', ctx),
    );
  }

  destroy(): void {
    this.cleanup.forEach((f) => f());
  }

  private isAction(a: string, code: string): boolean {
    return (this.settings.keymap[a] ?? []).includes(code);
  }

  private held(a: string): boolean {
    for (const code of this.settings.keymap[a] ?? []) {
      if (code.startsWith('Mouse')) {
        if (this.mouse.buttons & (1 << Number(code.slice(5)))) return true;
      } else if (this.keys.has(code)) return true;
    }
    return false;
  }

  private pressed(a: string): boolean {
    for (const code of this.settings.keymap[a] ?? []) if (!code.startsWith('Mouse') && this.keys.has(code) && !this.prevKeys.has(code)) return true;
    return false;
  }

  bump(shift: number): void {
    this.actions = bumpCounter(this.actions, shift);
  }

  /** Emote / quick chat / survival upgrade from the UI. */
  signal(value: number): void {
    this.signalValue = value;
    this.bump(ACT_SIGNAL);
  }

  swap(): void {
    this.bump(ACT_SWAP);
  }
  reload(): void {
    this.bump(ACT_RELOAD);
  }
  melee(): void {
    this.bump(ACT_MELEE);
  }
  throwGrenade(power01: number, aim: number | null): void {
    this.throwPower = Math.round(Math.max(0, Math.min(1, power01)) * 255);
    this.throwAim = aim;
    this.bump(ACT_THROW);
  }

  /** Sampler handed to the GameClient: called once per sim tick. */
  sample = (out: Input, view: ClientView | null): void => {
    const s = this.settings;
    const pad = this.readGamepad();
    let mx = 0;
    let my = 0;
    let fire = false;
    let jet = false;
    let crouch = false;
    let zoom = false;
    let aim: number | null = null;
    // Keyboard + mouse.
    if (this.held('left')) mx -= 1;
    if (this.held('right')) mx += 1;
    if (this.held('jet')) jet = true;
    if (this.held('crouch')) crouch = true;
    if (this.held('fire')) fire = true;
    if (this.held('zoom')) zoom = true;
    if (this.pressed('swap')) this.swap();
    if (this.pressed('reload')) this.reload();
    if (this.pressed('melee')) this.melee();
    if (this.mouseWorld && view?.me && this.device === 'keyboard') {
      const me = view.me;
      aim = datan2(this.mouseWorld.y - (me.y - (me.crouch ? 14 : 28)), this.mouseWorld.x - me.x);
    }
    // Grenade: hold to charge, release to throw.
    const gHeld = this.held('grenade') || (pad?.lb ?? false);
    if (gHeld && this.grenadeHoldStart < 0) this.grenadeHoldStart = performance.now();
    if (gHeld) this.charge = Math.min(1, (performance.now() - this.grenadeHoldStart) / 900);
    if (!gHeld && this.grenadeHoldStart >= 0) {
      this.throwGrenade(Math.max(0.15, this.charge), null);
      this.grenadeHoldStart = -1;
      this.charge = -1;
    }
    // Gamepad.
    if (pad) {
      if (Math.abs(pad.lx) > s.deadZone) mx = pad.lx;
      if (Math.abs(pad.ly) > s.deadZone) my = pad.ly;
      if (pad.lt || pad.ly < -0.6) jet = true;
      if (pad.ly > 0.7) crouch = true;
      if (Math.hypot(pad.rx, pad.ry) > 0.3) aim = datan2(pad.ry, pad.rx);
      if (pad.rt) fire = true;
      if (pad.rb && !this.prevPad[5]) this.swap();
      if (pad.x && !this.prevPad[2]) this.reload();
      if (pad.b && !this.prevPad[1]) this.melee();
      if (pad.y && !this.prevPad[3]) this.zoomOn = !this.zoomOn;
      if (pad.a && !this.prevPad[0]) this.crouchOn = !this.crouchOn;
      if (pad.start && !this.prevPad[9]) this.onPause?.();
      if (pad.back && !this.prevPad[8]) this.onScoreboard?.(true);
      if (!pad.back && this.prevPad[8]) this.onScoreboard?.(false);
      this.prevPad = [pad.a, pad.b, pad.x, pad.y, pad.lb, pad.rb, false, false, pad.back, pad.start];
      if (this.device === 'gamepad') {
        zoom = zoom || this.zoomOn;
        crouch = crouch || this.crouchOn;
      }
    }
    // Touch.
    const t = this.touch;
    if (t.move.active || t.aim.active || t.fire || t.jet) this.device = this.device === 'gamepad' ? 'gamepad' : 'touch';
    if (t.move.active) {
      const mag = Math.hypot(t.move.x, t.move.y);
      if (mag > s.deadZone) {
        mx = t.move.x;
        my = t.move.y;
        if (!s.jetButton && t.move.y < -0.5) jet = true;
        if (t.move.y > 0.75 && Math.abs(t.move.x) < 0.5) crouch = true;
      }
    }
    if (t.jet) jet = true;
    if (t.aim.active) {
      const mag = Math.hypot(t.aim.x, t.aim.y);
      if (mag > 0.15) aim = datan2(t.aim.y, t.aim.x);
      if (s.aimToFire && mag > 0.82) fire = true;
    }
    if (t.fire) fire = true;
    if (this.device === 'touch') {
      if (t.zoomToggle) zoom = true;
      if (t.crouchToggle) crouch = true;
    }
    if (s.holdToToggle && this.device === 'keyboard') {
      if (this.pressed('zoom')) this.zoomOn = !this.zoomOn;
      if (this.pressed('crouch')) this.crouchOn = !this.crouchOn;
      zoom = this.zoomOn;
      crouch = this.crouchOn;
    }
    if (aim === null) aim = this.lastAim;
    // Aim assist (touch/gamepad only): gently pull toward the closest enemy near the aim line.
    if (s.aimAssist && this.device !== 'keyboard' && view?.me && view.me.alive) aim = this.assist(aim, view);
    this.lastAim = aim;
    this.chargeAim = aim;
    out.moveX = Math.round(Math.max(-1, Math.min(1, mx)) * 127);
    out.moveY = Math.round(Math.max(-1, Math.min(1, my)) * 127);
    out.aim = this.throwAim !== null ? this.throwAim : aim;
    this.throwAim = null;
    out.buttons = (fire ? BTN_FIRE : 0) | (jet ? BTN_JET : 0) | (crouch ? BTN_CROUCH : 0) | (zoom ? BTN_ZOOM : 0);
    out.actions = this.actions;
    out.throwPower = this.throwPower;
    out.signal = this.signalValue;
    this.prevKeys = new Set(this.keys);
  };

  private assist(aim: number, view: ClientView): number {
    const me = view.me!;
    const def = WEAPONS[me.slots[me.active].wi];
    if (!def) return aim;
    let best: number | null = null;
    let bestErr = radToAngle(0.2);
    for (const p of view.players) {
      if (p.id === me.id || !p.alive || (p.team >= 0 && p.team === me.team)) continue;
      const dx = p.x - me.x;
      const dy = p.y - 22 - (me.y - 28);
      const d = Math.hypot(dx, dy);
      if (d > def.range * 0.8 || d < 20) continue;
      const a = datan2(dy, dx);
      const err = Math.abs(angleDiff(aim, a));
      if (err < bestErr) {
        bestErr = err;
        best = a;
      }
    }
    if (best === null) return aim;
    return (aim + Math.round(angleDiff(aim, best) * 0.35) + 65536) & 0xffff;
  }

  private readGamepad(): { lx: number; ly: number; rx: number; ry: number; lt: boolean; rt: boolean; lb: boolean; rb: boolean; a: boolean; b: boolean; x: boolean; y: boolean; start: boolean; back: boolean } | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const g of pads) {
      if (!g || !g.connected) continue;
      const b = (i: number) => !!g.buttons[i]?.pressed;
      const v = (i: number) => g.buttons[i]?.value ?? 0;
      const st = {
        lx: g.axes[0] ?? 0,
        ly: g.axes[1] ?? 0,
        rx: g.axes[2] ?? 0,
        ry: g.axes[3] ?? 0,
        lt: v(6) > 0.3,
        rt: v(7) > 0.3,
        lb: b(4),
        rb: b(5),
        a: b(0),
        b: b(1),
        x: b(2),
        y: b(3),
        back: b(8),
        start: b(9),
      };
      const anyInput = Math.abs(st.lx) > 0.3 || Math.abs(st.ly) > 0.3 || Math.abs(st.rx) > 0.3 || Math.abs(st.ry) > 0.3 || g.buttons.some((x) => x.pressed);
      if (anyInput) this.device = 'gamepad';
      return st;
    }
    return null;
  }
}

/** Ticks → seconds helper for HUD timers. */
export const ticksToSec = (t: number) => t / TICK_RATE;
