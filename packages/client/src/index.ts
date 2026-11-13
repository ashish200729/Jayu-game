import Phaser from 'phaser';
import type { GameClient } from '@game/net';
import { audio } from './audio';
import { Controls } from './input/controls';
import { GameContext, type ClientSettings, type GameCallbacks } from './game/context';
import { GameScene } from './game/GameScene';
import { HudScene } from './game/HudScene';

export { audio } from './audio';
export type { ClientSettings, GameCallbacks } from './game/context';

export interface MountOptions {
  client: GameClient;
  settings: () => ClientSettings;
  teamColors: [number, number];
  callbacks: GameCallbacks;
  isTouch: boolean;
  tutorial?: boolean;
}

export interface GameHandle {
  controls: Controls;
  context: GameContext;
  setSettings(s: ClientSettings): void;
  /** Send an emote / quick chat / upgrade signal. */
  signal(value: number): void;
  destroy(): void;
}

function pixelRatio(q: ClientSettings['graphics']['quality']): number {
  const dpr = window.devicePixelRatio || 1;
  return q === 'low' ? 1 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
}

/** Mount the Phaser game into `parent`. Phaser is only used for rendering, audio playback hooks and input capture. */
export function mountGame(parent: HTMLElement, opts: MountOptions): GameHandle {
  const s0 = opts.settings();
  let dpr = pixelRatio(s0.graphics.quality);
  const controls = new Controls(parent, { ...s0.controls });
  const ctx = new GameContext(opts.client, controls, opts.settings, opts.teamColors, opts.callbacks, opts.isTouch, !!opts.tutorial, dpr);
  controls.onPause = opts.callbacks.onPause;
  controls.onScoreboard = opts.callbacks.onScoreboard;
  controls.onEmoteWheel = opts.callbacks.onEmoteWheel;
  opts.client.sampler = controls.sample;
  const w = Math.max(320, parent.clientWidth);
  const h = Math.max(200, parent.clientHeight);
  const fps = s0.graphics.batterySaver ? 30 : 60;
  const game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent,
    width: Math.round(w * dpr),
    height: Math.round(h * dpr),
    backgroundColor: '#10121a',
    antialias: true,
    autoFocus: true,
    disableContextMenu: true,
    banner: false,
    fps: { target: fps, limit: fps, smoothStep: true },
    scale: { mode: Phaser.Scale.NONE, zoom: 1 / dpr },
    input: { activePointers: 6, gamepad: false },
    render: { powerPreference: 'high-performance', antialias: true },
  });
  game.events.once(Phaser.Core.Events.READY, () => {
    game.scene.add('game', GameScene, true, { ctx });
    game.scene.add('hud', HudScene, true, { ctx });
  });
  const resize = () => {
    const nw = Math.max(320, parent.clientWidth);
    const nh = Math.max(200, parent.clientHeight);
    dpr = pixelRatio(opts.settings().graphics.quality);
    ctx.dpr = dpr;
    game.scale.resize(Math.round(nw * dpr), Math.round(nh * dpr));
    game.scale.setZoom(1 / dpr);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(parent);
  audio.unlock();
  const s = opts.settings();
  audio.setVolumes(s.audio);
  return {
    controls,
    context: ctx,
    setSettings(ns: ClientSettings) {
      controls.settings = { ...ns.controls };
      audio.setVolumes(ns.audio);
      resize();
    },
    signal(value: number) {
      controls.signal(value);
    },
    destroy() {
      ro.disconnect();
      controls.destroy();
      opts.client.sampler = null;
      audio.stopAllJets();
      audio.stopMusic();
      game.destroy(true);
    },
  };
}
