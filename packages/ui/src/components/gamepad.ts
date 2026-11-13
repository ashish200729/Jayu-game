import { useEffect } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Dir = 'up' | 'down' | 'left' | 'right';

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Focusable elements in the top-most layer (an open dialog traps navigation). */
function candidates(): HTMLElement[] {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
  const root: ParentNode = dialogs.length ? dialogs[dialogs.length - 1] : document;
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(visible);
}

/** Spatial navigation: the nearest focusable element in a direction, weighted against sideways drift. */
function moveFocus(dir: Dir): void {
  const list = candidates();
  if (!list.length) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || !list.includes(cur)) {
    list[0].focus();
    return;
  }
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    let main = 0;
    let side = 0;
    if (dir === 'up') [main, side] = [-dy, dx];
    else if (dir === 'down') [main, side] = [dy, dx];
    else if (dir === 'left') [main, side] = [-dx, dy];
    else [main, side] = [dx, dy];
    if (main <= 4) continue;
    const score = main + Math.abs(side) * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

/**
 * Menu navigation with a gamepad: D-pad / left stick move focus, A activates, B goes back (Escape).
 * Range inputs are adjusted with left/right. Disabled while `enabled` is false (in a match).
 */
export function useGamepadNav(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let raf = 0;
    const held = new Map<string, number>();
    const repeat = (key: string, on: boolean, now: number, fire: () => void) => {
      if (!on) {
        held.delete(key);
        return;
      }
      const next = held.get(key);
      if (next === undefined) {
        held.set(key, now + 380);
        fire();
      } else if (now >= next) {
        held.set(key, now + 120);
        fire();
      }
    };
    const edge = new Set<string>();
    const press = (key: string, on: boolean, fire: () => void) => {
      if (on && !edge.has(key)) {
        edge.add(key);
        fire();
      } else if (!on) edge.delete(key);
    };
    const nudgeRange = (el: HTMLInputElement, sign: number) => {
      const step = Number(el.step) || 1;
      const v = Math.max(Number(el.min), Math.min(Number(el.max), Number(el.value) + sign * step));
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p) => p && p.connected);
      if (!pad || !document.hasFocus()) return;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      const active = document.activeElement;
      const range = active instanceof HTMLInputElement && active.type === 'range' ? active : null;
      const dirs: [Dir, boolean][] = [
        ['up', b(12) || ay < -0.6],
        ['down', b(13) || ay > 0.6],
        ['left', b(14) || ax < -0.6],
        ['right', b(15) || ax > 0.6],
      ];
      for (const [d, on] of dirs) {
        repeat(d, on, now, () => {
          if (range && (d === 'left' || d === 'right')) nudgeRange(range, d === 'left' ? -1 : 1);
          else moveFocus(d);
        });
      }
      press('a', b(0), () => {
        const el = document.activeElement as HTMLElement | null;
        if (el && el !== document.body) el.click();
        else candidates()[0]?.focus();
      });
      press('b', b(1), () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      // Shoulder buttons cycle tabs on screens that have them.
      const cycleTab = (sign: number) => {
        const tabs = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).filter(visible);
        if (!tabs.length) return;
        const i = tabs.findIndex((x) => x.getAttribute('aria-selected') === 'true');
        const n = tabs[(i + sign + tabs.length) % tabs.length];
        n.click();
        n.focus();
      };
      press('lb', b(4), () => cycleTab(-1));
      press('rb', b(5), () => cycleTab(1));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);
}
