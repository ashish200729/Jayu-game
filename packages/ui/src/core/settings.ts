export const SETTINGS_VERSION = 2;

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jet'
  | 'fire'
  | 'zoom'
  | 'grenade'
  | 'swap'
  | 'reload'
  | 'melee'
  | 'crouch'
  | 'emote'
  | 'scoreboard'
  | 'pause';

export const ACTIONS: readonly Action[] = ['left', 'right', 'up', 'down', 'jet', 'fire', 'zoom', 'grenade', 'swap', 'reload', 'melee', 'crouch', 'emote', 'scoreboard', 'pause'];

export const DEFAULT_KEYMAP: Record<Action, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jet: ['Space', 'KeyW', 'ArrowUp'],
  fire: ['Mouse0'],
  zoom: ['Mouse2'],
  grenade: ['KeyG'],
  swap: ['KeyQ'],
  reload: ['KeyR'],
  melee: ['KeyF'],
  crouch: ['KeyS', 'ArrowDown', 'ControlLeft'],
  emote: ['KeyT'],
  scoreboard: ['Tab'],
  pause: ['Escape'],
};

export type TouchControl = 'move' | 'aim' | 'fire' | 'jet' | 'grenade' | 'swap' | 'reload' | 'melee' | 'zoom' | 'crouch' | 'emote';

export interface TouchControlLayout {
  /** Centre position as a fraction of the screen (0..1). */
  x: number;
  y: number;
  /** Size multiplier (1 = default). */
  size: number;
  opacity: number;
  visible: boolean;
}

export type TouchLayout = Record<TouchControl, TouchControlLayout>;

/**
 * Thumb-zone layout: movement under the left thumb, aim under the right with the action buttons in an arc
 * above/left of it, nothing under the HUD cards (top-left vitals, top-centre score, top-right minimap).
 * Spacing keeps every pair of controls at least one thumb-width apart on a 915x412 phone.
 */
export function defaultTouchLayout(): TouchLayout {
  const c = (x: number, y: number, size = 1, visible = true): TouchControlLayout => ({ x, y, size, opacity: 0.55, visible });
  return {
    move: c(0.13, 0.72, 1),
    aim: c(0.87, 0.7, 1),
    fire: c(0.62, 0.8, 0.9, false),
    jet: c(0.3, 0.66, 0.9, false),
    grenade: c(0.8, 0.43, 0.85),
    swap: c(0.735, 0.62, 0.85),
    reload: c(0.715, 0.85, 0.8),
    melee: c(0.935, 0.43, 0.8),
    zoom: c(0.665, 0.41, 0.75),
    crouch: c(0.29, 0.86, 0.8),
    emote: c(0.045, 0.42, 0.7),
  };
}

/** The v1 defaults, which overlapped the HUD on phones. Saved layouts still equal to these are upgraded. */
function legacyTouchLayout(): TouchLayout {
  const c = (x: number, y: number, size = 1, visible = true): TouchControlLayout => ({ x, y, size, opacity: 0.55, visible });
  return {
    move: c(0.14, 0.72, 1),
    aim: c(0.84, 0.7, 1),
    fire: c(0.7, 0.86, 0.9, false),
    jet: c(0.26, 0.9, 0.9, false),
    grenade: c(0.9, 0.38, 0.85),
    swap: c(0.78, 0.38, 0.85),
    reload: c(0.66, 0.38, 0.8),
    melee: c(0.95, 0.52, 0.8),
    zoom: c(0.95, 0.24, 0.8),
    crouch: c(0.05, 0.42, 0.8),
    emote: c(0.05, 0.28, 0.75),
  };
}

function sameLayout(a: Partial<TouchLayout>, b: TouchLayout): boolean {
  return (Object.keys(b) as TouchControl[]).every((k) => {
    const x = a[k];
    const y = b[k];
    return !!x && x.x === y.x && x.y === y.y && x.size === y.size && x.visible === y.visible;
  });
}

export interface Settings {
  version: number;
  language: 'en' | 'hi';
  audio: { master: number; music: number; sfx: number; ui: number };
  graphics: { quality: 'low' | 'medium' | 'high'; batterySaver: boolean; shake: boolean; damageNumbers: boolean; showFps: boolean; reduceFlashes: boolean };
  controls: {
    aimToFire: boolean;
    jetButton: boolean;
    floatingSticks: boolean;
    deadZone: number;
    sensitivity: number;
    aimAssist: boolean;
    haptics: boolean;
    holdToToggle: boolean;
    preset: number;
    layouts: TouchLayout[];
    keymap: Record<Action, string[]>;
  };
  accessibility: {
    colorblind: 'none' | 'protan' | 'deutan' | 'tritan';
    highContrast: boolean;
    uiScale: number;
    textScale: number;
    captions: boolean;
    reduceMotion: boolean;
  };
  network: { region: string; showNetStats: boolean; simLatency: number; simJitter: number; simLoss: number };
}

export function defaultSettings(touch = false): Settings {
  return {
    version: SETTINGS_VERSION,
    language: typeof navigator !== 'undefined' && navigator.language?.startsWith('hi') ? 'hi' : 'en',
    audio: { master: 0.8, music: 0.5, sfx: 0.9, ui: 0.7 },
    graphics: { quality: touch ? 'medium' : 'high', batterySaver: false, shake: true, damageNumbers: true, showFps: false, reduceFlashes: false },
    controls: {
      aimToFire: true,
      jetButton: false,
      floatingSticks: true,
      deadZone: 0.15,
      sensitivity: 1,
      aimAssist: touch,
      haptics: true,
      holdToToggle: false,
      preset: 0,
      layouts: [defaultTouchLayout(), defaultTouchLayout(), defaultTouchLayout()],
      keymap: structuredClone(DEFAULT_KEYMAP),
    },
    accessibility: { colorblind: 'none', highContrast: false, uiScale: 1, textScale: 1, captions: false, reduceMotion: false },
    network: { region: 'ap-south', showNetStats: false, simLatency: 0, simJitter: 0, simLoss: 0 },
  };
}

export function migrateSettings(raw: unknown, touch = false): Settings {
  const d = defaultSettings(touch);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Settings>;
  const legacy = legacyTouchLayout();
  const upgrade = (r.version ?? 1) < 2;
  const layouts =
    Array.isArray(r.controls?.layouts) && r.controls!.layouts.length === 3
      ? r.controls!.layouts.map((l) => (upgrade && sameLayout(l, legacy) ? defaultTouchLayout() : { ...defaultTouchLayout(), ...l }))
      : d.controls.layouts;
  return {
    ...d,
    ...r,
    version: SETTINGS_VERSION,
    language: r.language === 'hi' ? 'hi' : 'en',
    audio: { ...d.audio, ...r.audio },
    graphics: { ...d.graphics, ...r.graphics },
    controls: { ...d.controls, ...r.controls, layouts, keymap: { ...d.controls.keymap, ...r.controls?.keymap } },
    accessibility: { ...d.accessibility, ...r.accessibility },
    network: { ...d.network, ...r.network },
  };
}

/** Team colours per colour-blind preset: [red team, blue team]. Teams also differ by marker shape. */
export const TEAM_COLORS: Record<Settings['accessibility']['colorblind'], [number, number]> = {
  none: [0xff5a4f, 0x3fa2ff],
  protan: [0xffb000, 0x3f7fff],
  deutan: [0xff8c1a, 0x2f6fff],
  tritan: [0xff3f6f, 0x22c4a0],
};
