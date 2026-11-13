import type { GameClient } from '@game/net';
import type { Controls } from '../input/controls';

export interface ClientSettings {
  graphics: { quality: 'low' | 'medium' | 'high'; batterySaver: boolean; shake: boolean; damageNumbers: boolean; showFps: boolean; reduceFlashes: boolean };
  accessibility: { colorblind: string; highContrast: boolean; uiScale: number; textScale: number; captions: boolean; reduceMotion: boolean };
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
    layouts: Record<string, { x: number; y: number; size: number; opacity: number; visible: boolean }>[];
    keymap: Record<string, string[]>;
  };
  network: { showNetStats: boolean };
  audio: { master: number; music: number; sfx: number; ui: number };
}

export interface GameCallbacks {
  onPause(): void;
  onScoreboard(show: boolean): void;
  onEmoteWheel(): void;
  haptic(kind: 'light' | 'medium' | 'heavy' | 'success' | 'warning'): void;
  t(key: string, vars?: Record<string, string | number>): string;
  onTutorialDone?(): void;
}

export interface KillFeedEntry {
  killer: number;
  victim: number;
  code: number;
  head: boolean;
  t: number;
}

export interface Announcement {
  text: string;
  sub?: string;
  color: number;
  t: number;
  dur: number;
}

/** Shared state between the world scene and the HUD scene. */
export class GameContext {
  killfeed: KillFeedEntry[] = [];
  announcements: Announcement[] = [];
  captions: { text: string; t: number }[] = [];
  chat: { id: number; text: string; t: number }[] = [];
  damageDirs: { angle: number; t: number }[] = [];
  hitMarker = 0;
  hitHead = false;
  lowHpPulse = 0;
  hurtFlash = 0;
  lastDeath: { killer: number; code: number; t: number } | null = null;
  recentFire = new Map<number, number>();
  courseTime = 0;
  courseBest = 0;
  courseCheckpoint = -1;
  fps = 60;
  frameMs = 16;
  frameTimes: number[] = [];
  drawEntities = 0;
  tutorialStep = 0;
  /** Number of locally predicted shots (tutorial detection). */
  localShots = 0;
  constructor(
    public client: GameClient,
    public controls: Controls,
    public settings: () => ClientSettings,
    public teamColors: [number, number],
    public callbacks: GameCallbacks,
    public isTouch: boolean,
    public tutorial: boolean,
    public dpr: number,
  ) {}

  announce(text: string, color = 0xffffff, sub?: string, dur = 2.2): void {
    this.announcements.push({ text, sub, color, t: performance.now(), dur });
    if (this.announcements.length > 3) this.announcements.shift();
  }

  caption(text: string): void {
    if (!this.settings().accessibility.captions) return;
    this.captions.push({ text, t: performance.now() });
    if (this.captions.length > 4) this.captions.shift();
  }

  teamColor(team: number): number {
    return team === 0 ? this.teamColors[0] : team === 1 ? this.teamColors[1] : 0xffffff;
  }
}
