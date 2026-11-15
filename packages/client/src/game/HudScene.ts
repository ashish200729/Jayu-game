import Phaser from 'phaser';
import { GRENADES, TICK_RATE, TILE, WEAPONS, upgradeChoices } from '@game/content';
import { getMap, Tile, type MapData } from '@game/maps';
import type { ClientView, PlayerView } from '@game/net';
import { KILL_BOMB, KILL_BURN, KILL_GAS, KILL_GRENADE, KILL_LAVA, KILL_MELEE, KILL_WORLD, SIGNAL_UPGRADE } from '@game/sim';
import { audio } from '../audio';
import { CHAR_SCALE, weaponIcon } from '../art/characters';
import { GAME_FONT, canvas, hex, mix, shade } from '../art/draw';
import { SPR } from '../art/world';
import { hudIcon, type HudIcon } from '../art/icons';
import type { GameContext } from './context';

type ButtonId = 'fire' | 'jet' | 'grenade' | 'swap' | 'reload' | 'melee' | 'zoom' | 'crouch' | 'emote' | 'pause' | 'score';

const BUTTON_ICON: Record<ButtonId, HudIcon> = {
  fire: 'fire',
  jet: 'jet',
  grenade: 'grenade',
  swap: 'swap',
  reload: 'reload',
  melee: 'melee',
  zoom: 'zoom',
  crouch: 'crouch',
  emote: 'emote',
  pause: 'pause',
  score: 'score',
};

const PANEL = 0x0b0e16;
const SUN = 0xffd34d;

interface TouchButton {
  id: ButtonId;
  x: number;
  y: number;
  r: number;
  bg: Phaser.GameObjects.Image;
  icon: Phaser.GameObjects.Image;
  pointer: number;
  visible: boolean;
  opacity: number;
}

interface Stick {
  pointer: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  base: Phaser.GameObjects.Image;
  knob: Phaser.GameObjects.Image;
  homeX: number;
  homeY: number;
  r: number;
  opacity: number;
}

const TUTORIAL_STEPS = ['tut.move', 'tut.fly', 'tut.aim', 'tut.shoot', 'tut.swap', 'tut.grenade', 'tut.melee', 'tut.done'];

export class HudScene extends Phaser.Scene {
  ctx!: GameContext;
  private map!: MapData;
  private g!: Phaser.GameObjects.Graphics;
  private under!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private icons = new Map<string, Phaser.GameObjects.Image>();
  private minimap!: Phaser.GameObjects.Image;
  private vignette!: Phaser.GameObjects.Image;
  private lowHp!: Phaser.GameObjects.Image;
  private buttons: TouchButton[] = [];
  private move!: Stick;
  private aim!: Stick;
  private grenadePtr = -1;
  private grenadeOrigin = { x: 0, y: 0 };
  private upgradeRects: { x: number; y: number; w: number; h: number; idx: number }[] = [];
  private u = 1;
  private inset = { l: 0, r: 0, t: 0, b: 0 };
  private tutorialT = 0;
  private tutFlags = { moved: false, flew: false, aimed: false, shot: false, swapped: false, threw: false, melee: false };
  private lastGrenades = -1;

  constructor() {
    super({ key: 'hud' });
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
  }

  create(): void {
    this.map = getMap(this.ctx.client.start!.config.mapId);
    this.buildTextures();
    this.vignette = this.add.image(0, 0, 'hud:vignette').setOrigin(0, 0).setDepth(0).setAlpha(0.9);
    this.lowHp = this.add.image(0, 0, 'hud:lowhp').setOrigin(0, 0).setDepth(1).setVisible(false);
    this.under = this.add.graphics().setDepth(4);
    this.g = this.add.graphics().setDepth(10);
    this.input.addPointer(5);
    this.buildMinimap();
    this.buildTouch();
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.ctx.controls.onDigit = (n) => {
      const r = this.upgradeRects.find((x) => x.idx === n - 1);
      if (r) this.tryUpgradeClick(r.x + 1, r.y + 1);
    };
    // If the web font finishes loading after the HUD was built, re-render every label with it.
    void document.fonts?.ready.then(() => {
      if (!this.sys.isActive()) return;
      for (const t of this.texts.values()) t.updateText();
    });
    this.layout();
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.callbacks.t(key, vars);
  }

  private buildTextures(): void {
    const tex = this.textures;
    if (!tex.exists('hud:vignette')) {
      const [c, g] = canvas(512, 512);
      const r = g.createRadialGradient(256, 256, 150, 256, 256, 370);
      r.addColorStop(0, 'rgba(4,5,10,0)');
      r.addColorStop(1, 'rgba(4,5,10,0.55)');
      g.fillStyle = r;
      g.fillRect(0, 0, 512, 512);
      tex.addCanvas('hud:vignette', c);
    }
    if (!tex.exists('hud:lowhp')) {
      const [c, g] = canvas(512, 512);
      const r = g.createRadialGradient(256, 256, 120, 256, 256, 380);
      r.addColorStop(0, 'rgba(255,30,30,0)');
      r.addColorStop(0.7, 'rgba(255,30,30,0.25)');
      r.addColorStop(1, 'rgba(160,0,0,0.75)');
      g.fillStyle = r;
      g.fillRect(0, 0, 512, 512);
      tex.addCanvas('hud:lowhp', c);
    }
    if (!tex.exists('hud:btn')) {
      const [c, g] = canvas(256, 256);
      const r = g.createRadialGradient(128, 96, 10, 128, 128, 124);
      r.addColorStop(0, 'rgba(60,66,86,0.92)');
      r.addColorStop(1, 'rgba(14,16,24,0.92)');
      g.fillStyle = r;
      g.beginPath();
      g.arc(128, 128, 122, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 6;
      g.strokeStyle = 'rgba(255,255,255,0.28)';
      g.stroke();
      g.beginPath();
      g.arc(128, 128, 112, Math.PI * 1.1, Math.PI * 1.9);
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.lineWidth = 5;
      g.stroke();
      tex.addCanvas('hud:btn', c);
    }
    if (!tex.exists('hud:stick')) {
      const [c, g] = canvas(256, 256);
      const r = g.createRadialGradient(128, 128, 40, 128, 128, 124);
      r.addColorStop(0, 'rgba(20,22,32,0.15)');
      r.addColorStop(1, 'rgba(20,22,32,0.5)');
      g.fillStyle = r;
      g.beginPath();
      g.arc(128, 128, 122, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        g.save();
        g.translate(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100);
        g.rotate(a);
        g.beginPath();
        g.moveTo(8, 0);
        g.lineTo(-6, -9);
        g.lineTo(-6, 9);
        g.closePath();
        g.fill();
        g.restore();
      }
      tex.addCanvas('hud:stick', c);
    }
    if (!tex.exists('hud:knob')) {
      const [c, g] = canvas(128, 128);
      const r = g.createRadialGradient(54, 46, 6, 64, 64, 60);
      r.addColorStop(0, 'rgba(255,255,255,0.95)');
      r.addColorStop(1, 'rgba(190,200,220,0.75)');
      g.fillStyle = r;
      g.beginPath();
      g.arc(64, 64, 58, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(20,22,32,0.35)';
      g.stroke();
      tex.addCanvas('hud:knob', c);
    }
  }

  private text(key: string, x: number, y: number, str: string, size: number, color = '#ffffff', origin: [number, number] = [0, 0], depth = 20, weight = '800'): Phaser.GameObjects.Text {
    let tx = this.texts.get(key);
    const px = Math.round(size * this.u * this.ctx.settings().accessibility.textScale);
    if (!tx) {
      tx = this.add
        .text(0, 0, '', { fontFamily: GAME_FONT, fontSize: `${px}px`, fontStyle: weight, color, stroke: '#0a0c12', strokeThickness: Math.max(2, Math.round(px / 6)) })
        .setDepth(depth)
        .setPadding(0, Math.ceil(px * 0.08), 0, 0);
      tx.setData('px', px);
      this.texts.set(key, tx);
    }
    if (tx.getData('px') !== px) {
      tx.setData('px', px);
      tx.setFontSize(px);
      tx.setStroke('#0a0c12', Math.max(2, Math.round(px / 6)));
    }
    if (tx.text !== str) tx.setText(str);
    if (tx.style.color !== color) tx.setColor(color);
    tx.setPosition(Math.round(x), Math.round(y)).setOrigin(origin[0], origin[1]).setVisible(true).setAlpha(1).setScale(1);
    return tx;
  }

  private icon(key: string, tex: string, x: number, y: number, scale: number, depth = 20): Phaser.GameObjects.Image {
    let im = this.icons.get(key);
    if (!im) {
      im = this.add.image(0, 0, tex).setDepth(depth);
      this.icons.set(key, im);
    }
    if (im.texture.key !== tex) im.setTexture(tex);
    return im.setPosition(x, y).setScale(scale).setVisible(true).setAlpha(1).clearTint();
  }

  private glyph(key: string, name: HudIcon, x: number, y: number, size: number, tint = 0xffffff, depth = 20): Phaser.GameObjects.Image {
    const im = this.icon(key, hudIcon(this, name), x, y, (size * this.u) / 96, depth);
    im.setTint(tint);
    return im;
  }

  private hideAll(): void {
    for (const t of this.texts.values()) t.setVisible(false);
    for (const i of this.icons.values()) i.setVisible(false);
  }

  /** Dark glass panel with a hairline border and top sheen. */
  private panel(x: number, y: number, w: number, h: number, r: number, a = 0.62, border = 0xffffff, ba = 0.1): void {
    const g = this.under;
    const rr = Math.min(r, h / 2, w / 2);
    g.fillStyle(PANEL, a).fillRoundedRect(x, y, w, h, rr);
    g.fillStyle(0xffffff, 0.045).fillRoundedRect(x + 1, y + 1, w - 2, Math.min(h * 0.45, h - 2), { tl: rr, tr: rr, bl: 0, br: 0 });
    g.lineStyle(Math.max(1, this.ctx.dpr), border, ba).strokeRoundedRect(x, y, w, h, rr);
  }

  // ------------------------------------------------------------------ layout

  private layout(): void {
    const s = this.ctx.settings();
    const dpr = this.ctx.dpr;
    const cssW = this.scale.width / dpr;
    const cssH = this.scale.height / dpr;
    this.u = dpr * s.accessibility.uiScale * Math.max(0.78, Math.min(1.2, Math.min(cssW / 900, cssH / 470)));
    const css = getComputedStyle(document.documentElement);
    const read = (n: string) => (parseFloat(css.getPropertyValue(n)) || 0) * dpr;
    this.inset = { l: Math.max(read('--sal'), 10 * dpr), r: Math.max(read('--sar'), 10 * dpr), t: Math.max(read('--sat'), 8 * dpr), b: Math.max(read('--sab'), 8 * dpr) };
    this.vignette.setDisplaySize(this.scale.width, this.scale.height);
    this.lowHp.setDisplaySize(this.scale.width, this.scale.height);
    this.placeTouch();
  }

  private buildMinimap(): void {
    const m = this.map;
    const key = `minimap2:${m.id}`;
    const P = 4;
    if (!this.textures.exists(key)) {
      const [c, g] = canvas(m.width * P, m.height * P);
      const th = m.theme;
      const bg = g.createLinearGradient(0, 0, 0, c.height);
      bg.addColorStop(0, hex(mix(th.skyTop, 0x0b0e16, 0.6), 0.85));
      bg.addColorStop(1, hex(mix(th.skyBottom, 0x0b0e16, 0.7), 0.85));
      g.fillStyle = bg;
      g.fillRect(0, 0, c.width, c.height);
      const solid = hex(mix(th.solid, 0xffffff, 0.45));
      const rim = hex(th.rim);
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
          const t = m.tiles[y * m.width + x];
          if (t === Tile.Solid || t === Tile.Ice) {
            const up = y > 0 ? m.tiles[(y - 1) * m.width + x] : Tile.Solid;
            g.fillStyle = solid;
            g.fillRect(x * P, y * P, P, P);
            if (up !== Tile.Solid && up !== Tile.Ice) {
              g.fillStyle = rim;
              g.fillRect(x * P, y * P, P, 1.5);
            }
          } else if (t === Tile.OneWay) {
            g.fillStyle = 'rgba(230,236,245,0.6)';
            g.fillRect(x * P, y * P, P, 1.6);
          } else if (t === Tile.Lava) {
            g.fillStyle = 'rgba(255,120,40,0.95)';
            g.fillRect(x * P, y * P, P, P);
          } else if (t === Tile.Water) {
            g.fillStyle = 'rgba(70,170,255,0.7)';
            g.fillRect(x * P, y * P, P, P);
          }
        }
      this.textures.addCanvas(key, c);
    }
    this.minimap = this.add.image(0, 0, key).setOrigin(1, 0).setDepth(6);
  }

  private buildTouch(): void {
    const mk = (id: ButtonId): TouchButton => {
      const bg = this.add.image(0, 0, 'hud:btn').setDepth(30);
      const icon = this.add.image(0, 0, hudIcon(this, BUTTON_ICON[id])).setDepth(31);
      return { id, x: 0, y: 0, r: 10, bg, icon, pointer: -1, visible: true, opacity: 0.6 };
    };
    this.buttons = (['fire', 'jet', 'grenade', 'swap', 'reload', 'melee', 'zoom', 'crouch', 'emote', 'pause', 'score'] as ButtonId[]).map(mk);
    const stick = (): Stick => ({
      pointer: -1,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
      homeX: 0,
      homeY: 0,
      r: 60,
      opacity: 0.6,
      base: this.add.image(0, 0, 'hud:stick').setDepth(30),
      knob: this.add.image(0, 0, 'hud:knob').setDepth(31),
    });
    this.move = stick();
    this.aim = stick();
  }

  private placeTouch(): void {
    const s = this.ctx.settings();
    const layout = s.controls.layouts[s.controls.preset] ?? s.controls.layouts[0];
    const W = this.scale.width;
    const H = this.scale.height;
    const base = 30 * this.u;
    const touch = this.ctx.isTouch;
    for (const b of this.buttons) {
      if (b.id === 'pause' || b.id === 'score') {
        b.r = 17 * this.u;
        b.x = W / 2 + (b.id === 'pause' ? 1 : -1) * 160 * this.u;
        b.y = this.inset.t + 24 * this.u;
        b.visible = touch;
        b.opacity = 0.85;
      } else {
        const l = layout[b.id];
        if (!l) continue;
        b.r = Math.max(22 * this.ctx.dpr, base * l.size);
        b.x = Math.max(this.inset.l + b.r, Math.min(W - this.inset.r - b.r, l.x * W));
        b.y = Math.max(this.inset.t + b.r, Math.min(H - this.inset.b - b.r, l.y * H));
        b.visible = touch && l.visible;
        b.opacity = Math.min(1, l.opacity + 0.25);
      }
    }
    const fireBtn = this.buttons.find((b) => b.id === 'fire')!;
    const jetBtn = this.buttons.find((b) => b.id === 'jet')!;
    fireBtn.visible = touch && (!s.controls.aimToFire || layout.fire.visible);
    jetBtn.visible = touch && (s.controls.jetButton || layout.jet.visible);
    for (const b of this.buttons) {
      const pressed = b.pointer >= 0;
      const k = pressed ? 0.92 : 1;
      b.bg.setPosition(b.x, b.y).setDisplaySize(b.r * 2 * k, b.r * 2 * k).setVisible(b.visible).setAlpha(b.opacity).setTint(pressed ? 0xfff2b0 : 0xffffff);
      const on = (b.id === 'zoom' && this.ctx.controls.touch.zoomToggle) || (b.id === 'crouch' && this.ctx.controls.touch.crouchToggle);
      b.icon
        .setPosition(b.x, b.y)
        .setDisplaySize(b.r * 1.05 * k, b.r * 1.05 * k)
        .setVisible(b.visible)
        .setAlpha(Math.min(1, b.opacity + 0.2))
        .setTint(pressed || on ? SUN : 0xffffff);
    }
    for (const [st, l] of [
      [this.move, layout.move],
      [this.aim, layout.aim],
    ] as const) {
      st.r = 62 * this.u * l.size;
      st.opacity = l.opacity;
      st.homeX = Math.max(this.inset.l + st.r, Math.min(W - this.inset.r - st.r, l.x * W));
      st.homeY = Math.max(this.inset.t + st.r, Math.min(H - this.inset.b - st.r, l.y * H));
      if (st.pointer < 0) {
        st.ox = st.homeX;
        st.oy = st.homeY;
      }
      const active = st.pointer >= 0;
      st.base.setDisplaySize(st.r * 2, st.r * 2).setPosition(st.ox, st.oy).setVisible(touch).setAlpha(active ? Math.min(1, l.opacity + 0.3) : l.opacity);
      st.knob
        .setDisplaySize(st.r * 0.86, st.r * 0.86)
        .setPosition(st.ox + st.x * st.r, st.oy + st.y * st.r)
        .setVisible(touch)
        .setAlpha(active ? 0.95 : Math.min(1, l.opacity + 0.15));
    }
  }

  // ------------------------------------------------------------------ touch input

  private hitButton(x: number, y: number): TouchButton | null {
    let best: TouchButton | null = null;
    let bd = Infinity;
    for (const b of this.buttons) {
      if (!b.visible) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r * 1.2 && d < bd) {
        best = b;
        bd = d;
      }
    }
    return best;
  }

  private onDown(p: Phaser.Input.Pointer): void {
    audio.unlock();
    if (p.wasTouch !== true && (p.event as PointerEvent)?.pointerType === 'mouse') {
      // Mouse clicks only matter for HUD buttons like survival upgrades.
      this.tryUpgradeClick(p.x, p.y);
      return;
    }
    this.ctx.controls.device = 'touch';
    if (this.tryUpgradeClick(p.x, p.y)) return;
    const b = this.hitButton(p.x, p.y);
    const c = this.ctx.controls;
    if (b) {
      b.pointer = p.id;
      if (this.ctx.settings().controls.haptics) this.ctx.callbacks.haptic('light');
      switch (b.id) {
        case 'fire':
          c.touch.fire = true;
          break;
        case 'jet':
          c.touch.jet = true;
          break;
        case 'grenade':
          this.grenadePtr = p.id;
          this.grenadeOrigin = { x: p.x, y: p.y };
          c.touch.grenadeDrag = { active: true, x: 0, y: 0 };
          break;
        case 'swap':
          c.swap();
          this.tutFlags.swapped = true;
          break;
        case 'reload':
          c.reload();
          break;
        case 'melee':
          c.melee();
          this.tutFlags.melee = true;
          break;
        case 'zoom':
          c.touch.zoomToggle = !c.touch.zoomToggle;
          break;
        case 'crouch':
          c.touch.crouchToggle = !c.touch.crouchToggle;
          break;
        case 'emote':
          this.ctx.callbacks.onEmoteWheel();
          break;
        case 'pause':
          this.ctx.callbacks.onPause();
          break;
        case 'score':
          this.ctx.callbacks.onScoreboard(true);
          break;
      }
      return;
    }
    const left = p.x < this.scale.width * 0.45;
    const st = left ? this.move : this.aim;
    if (st.pointer >= 0) return;
    st.pointer = p.id;
    const floating = this.ctx.settings().controls.floatingSticks;
    st.ox = floating ? p.x : st.homeX;
    st.oy = floating ? p.y : st.homeY;
    this.updateStick(st, p.x, p.y);
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id === this.move.pointer) this.updateStick(this.move, p.x, p.y);
    else if (p.id === this.aim.pointer) this.updateStick(this.aim, p.x, p.y);
    else if (p.id === this.grenadePtr) {
      const range = 140 * this.u;
      const dx = (p.x - this.grenadeOrigin.x) / range;
      const dy = (p.y - this.grenadeOrigin.y) / range;
      const len = Math.min(1, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      this.ctx.controls.touch.grenadeDrag = { active: true, x: Math.cos(a) * len, y: Math.sin(a) * len };
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const c = this.ctx.controls;
    for (const b of this.buttons) {
      if (b.pointer !== p.id) continue;
      b.pointer = -1;
      if (b.id === 'fire') c.touch.fire = false;
      if (b.id === 'jet') c.touch.jet = false;
      if (b.id === 'score') this.ctx.callbacks.onScoreboard(false);
    }
    if (p.id === this.grenadePtr) {
      const d = c.touch.grenadeDrag;
      const len = Math.hypot(d.x, d.y);
      const aim = len > 0.15 ? ((Math.round((Math.atan2(d.y, d.x) / (Math.PI * 2)) * 65536) % 65536) + 65536) % 65536 : null;
      c.throwGrenade(len > 0.15 ? Math.max(0.2, len) : 0.55, aim);
      c.touch.grenadeDrag = { active: false, x: 0, y: 0 };
      this.grenadePtr = -1;
      this.tutFlags.threw = true;
    }
    for (const st of [this.move, this.aim]) {
      if (st.pointer !== p.id) continue;
      st.pointer = -1;
      st.x = 0;
      st.y = 0;
      st.ox = st.homeX;
      st.oy = st.homeY;
      const target = st === this.move ? c.touch.move : c.touch.aim;
      target.active = false;
      target.x = 0;
      target.y = 0;
    }
  }

  private updateStick(st: Stick, px: number, py: number): void {
    let dx = (px - st.ox) / st.r;
    let dy = (py - st.oy) / st.r;
    const len = Math.hypot(dx, dy);
    const sens = this.ctx.settings().controls.sensitivity;
    if (len > 1) {
      // Drag the floating base along so the thumb never "loses" the stick.
      if (this.ctx.settings().controls.floatingSticks) {
        st.ox += (dx / len) * (len - 1) * st.r;
        st.oy += (dy / len) * (len - 1) * st.r;
      }
      dx /= len;
      dy /= len;
    }
    st.x = dx;
    st.y = dy;
    const target = st === this.move ? this.ctx.controls.touch.move : this.ctx.controls.touch.aim;
    target.active = true;
    const k = st === this.aim ? Math.min(1, sens) : 1;
    target.x = dx * (st === this.aim ? 1 : k);
    target.y = dy * (st === this.aim ? 1 : k);
    if (st === this.move && Math.hypot(dx, dy) > 0.3) this.tutFlags.moved = true;
    if (st === this.aim && Math.hypot(dx, dy) > 0.3) this.tutFlags.aimed = true;
  }

  private tryUpgradeClick(x: number, y: number): boolean {
    for (const r of this.upgradeRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        this.ctx.controls.signal(SIGNAL_UPGRADE + r.idx);
        audio.play('ui_click');
        this.upgradeRects = [];
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ frame

  override update(): void {
    const view = this.ctx.client.view();
    this.g.clear();
    this.under.clear();
    this.hideAll();
    if (!view) return;
    const s = this.ctx.settings();
    this.placeTouch();
    const me = view.me;
    this.drawTopLeft(view, me);
    this.drawTopCenter(view, me);
    this.drawMinimap(view, me);
    this.drawKillFeed();
    this.drawCenter(view, me);
    this.drawOverlays(view, me);
    if (s.graphics.showFps || s.network.showNetStats) this.drawDebug(view);
    if (this.ctx.tutorial) this.drawTutorial(view, me);
    this.drawCaptions();
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: number, ticks = 0): void {
    const g = this.g;
    const f = Math.max(0, Math.min(1, frac));
    g.fillStyle(0x05060a, 0.7).fillRoundedRect(x, y, w, h, h / 2);
    if (f > 0) {
      const fw = Math.max(h, w * f);
      g.fillStyle(shade(color, 0.78), 1).fillRoundedRect(x, y, fw, h, h / 2);
      g.fillStyle(color, 1).fillRoundedRect(x, y, fw, h * 0.62, { tl: h / 2, tr: h / 2, bl: h * 0.2, br: h * 0.2 });
      g.fillStyle(0xffffff, 0.35).fillRoundedRect(x + h * 0.4, y + h * 0.14, Math.max(0, fw - h * 0.8), h * 0.2, h * 0.1);
    }
    if (ticks > 1) {
      g.fillStyle(0x05060a, 0.55);
      for (let i = 1; i < ticks; i++) g.fillRect(x + (w * i) / ticks - this.u * 0.6, y, this.u * 1.2, h);
    }
  }

  private drawTopLeft(view: ClientView, me: PlayerView | null): void {
    if (!me) return;
    const u = this.u;
    const x = this.inset.l;
    const y = this.inset.t;
    const cw = 218 * u;
    const ch = 92 * u;
    this.panel(x, y, cw, ch, 14 * u);
    // Vitals.
    const hpFrac = me.alive ? me.hp / me.maxHp : 0;
    const hpColor = hpFrac > 0.5 ? 0x6dff8a : hpFrac > 0.25 ? 0xffd34d : 0xff5a4f;
    this.glyph('hpIcon', 'heart', x + 16 * u, y + 15 * u, 15, hpColor);
    this.bar(x + 28 * u, y + 9 * u, 140 * u, 12 * u, hpFrac, hpColor, 4);
    this.text('hp', x + cw - 10 * u, y + 15 * u, String(Math.max(0, me.hp)), 16, '#ffffff', [1, 0.5]);
    const fuelFrac = me.fuel / (100 * (1 + me.upgrades.fuel * 0.3));
    const low = fuelFrac < 0.2 && Math.floor(performance.now() / 200) % 2 === 0;
    this.glyph('fuelIcon', 'jet', x + 16 * u, y + 33 * u, 13, low ? 0xff5a4f : 0x5ad1ff);
    this.bar(x + 28 * u, y + 29 * u, 140 * u, 8 * u, fuelFrac, low ? 0xff5a4f : 0x5ad1ff);
    this.text('fuel', x + cw - 10 * u, y + 33 * u, `${Math.round(fuelFrac * 100)}%`, 11, low ? '#ff8a7a' : '#9fe6ff', [1, 0.5]);
    // Divider.
    this.under.fillStyle(0xffffff, 0.07).fillRect(x + 10 * u, y + 44 * u, cw - 20 * u, Math.max(1, this.ctx.dpr));
    // Weapon row.
    const slots = me.slots;
    const act = slots[me.active];
    const wy = y + 46 * u;
    if (act.wi >= 0) {
      const def = WEAPONS[act.wi];
      const ws = (u * 2) / CHAR_SCALE;
      this.icon('w0', weaponIcon(this, act.wi), x + 34 * u, wy + 22 * u, ws * (def.slot === 'sidearm' ? 2.2 : def.slot === 'heavy' ? 1.35 : 1.5));
      const reloading = me.reloadT > 0;
      const mag = this.text('ammo', x + 66 * u, wy + 16 * u, reloading ? this.t('hud.reloading') : String(act.mag), reloading ? 13 : 22, act.mag === 0 && !reloading ? '#ff6b6b' : '#ffffff', [0, 0.5]);
      if (!reloading && act.reserve >= 0) this.text('reserve', mag.x + mag.width + 3 * u, wy + 18 * u, `/ ${act.reserve}`, 12, '#9aa3b8', [0, 0.5], 20, '700');
      const dual = me.dualT > 0 && def.dualWieldable;
      this.text('wname', x + 66 * u, wy + 33 * u, def.name.toUpperCase() + (dual ? '  ×2' : ''), 10, dual ? '#ffd34d' : '#c9d2e0', [0, 0.5], 20, '700');
      if (reloading) this.bar(x + 66 * u, wy + 26 * u, 90 * u, 4 * u, 1 - me.reloadT / Math.max(1, def.reloadTime * TICK_RATE), SUN);
      const other = slots[1 - me.active];
      if (other.wi >= 0) this.icon('w1', weaponIcon(this, other.wi), x + cw - 30 * u, wy + 14 * u, ws * 0.95).setAlpha(0.55);
    }
    // Grenade pips.
    for (let i = 0; i < 3; i++) {
      const k = me.grenades[i];
      const im = this.icon(`gr${i}`, k !== undefined ? `grenade:${k}` : 'grenade:0', x + cw - 44 * u + i * 13 * u, wy + 33 * u, (u * 0.95) / SPR);
      im.setAlpha(k !== undefined ? 1 : 0.18);
    }
    if (this.lastGrenades > me.grenades.length) this.tutFlags.threw = true;
    this.lastGrenades = me.grenades.length;
    // Status chips under the card.
    let cx = x;
    const chip = (key: string, label: string, color: number) => {
      const t = this.text(key, cx + 8 * u, y + ch + 6 * u + 9 * u, label, 10, hex(color), [0, 0.5], 21);
      this.panel(cx, y + ch + 6 * u, t.width + 16 * u, 18 * u, 9 * u, 0.62, color, 0.45);
      cx += t.width + 22 * u;
    };
    if (me.dualT > 0) chip('dual', `×2  ${Math.ceil(me.dualT / TICK_RATE)}s`, SUN);
    if (me.zoom) chip('zoom', this.t('hud.scope'), 0x9ff3ff);
    void view;
  }

  private drawTopCenter(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const cx = this.scale.width / 2;
    const y = this.inset.t;
    const m = view.mode;
    const mode = this.ctx.client.start!.config.mode;
    const timer = m.timeLeft >= 0 ? fmtTime(m.timeLeft / TICK_RATE) : '';
    const teams = mode === 'tdm' || mode === 'ctf' || mode === 'leader' || mode === 'koth';
    const lowTime = m.timeLeft >= 0 && m.timeLeft < 30 * TICK_RATE && m.phase === 'playing';
    if (teams) {
      const [a, b] = m.teamScores;
      const pw = 64 * u;
      const ph = 34 * u;
      const tw = 66 * u;
      const total = pw * 2 + tw;
      const x0 = cx - total / 2;
      this.panel(x0 - 4 * u, y, total + 8 * u, ph + 14 * u, 12 * u, 0.55);
      for (const [team, score, px] of [
        [0, a, x0],
        [1, b, x0 + pw + tw],
      ] as const) {
        const col = this.ctx.teamColor(team);
        const mine = me && me.team === team;
        const g = this.under;
        g.fillStyle(shade(col, 0.55), 1).fillRoundedRect(px, y + 4 * u, pw, ph, 9 * u);
        g.fillStyle(col, 1).fillRoundedRect(px, y + 4 * u, pw, ph * 0.62, { tl: 9 * u, tr: 9 * u, bl: 3 * u, br: 3 * u });
        g.fillStyle(0xffffff, 0.22).fillRoundedRect(px + 4 * u, y + 6 * u, pw - 8 * u, ph * 0.18, 3 * u);
        if (mine) this.g.lineStyle(2.5 * u, 0xffffff, 0.95).strokeRoundedRect(px - 1.5 * u, y + 2.5 * u, pw + 3 * u, ph + 3 * u, 10 * u);
        this.text(`s${team}`, px + pw / 2, y + 4 * u + ph / 2, String(score), 22, '#ffffff', [0.5, 0.5]);
        const lim = Math.max(1, m.scoreLimit);
        const bx = team === 0 ? px : px;
        this.g.fillStyle(0x05060a, 0.6).fillRoundedRect(bx, y + ph + 7 * u, pw, 4 * u, 2 * u);
        this.g.fillStyle(col, 1).fillRoundedRect(team === 0 ? bx + pw - pw * Math.min(1, score / lim) : bx, y + ph + 7 * u, Math.max(2 * u, pw * Math.min(1, score / lim)), 4 * u, 2 * u);
      }
      this.text('timer', cx, y + 4 * u + ph / 2, timer, 18, lowTime ? '#ff8a7a' : '#ffffff', [0.5, 0.5]);
      const lim = this.text('lim', cx + 5 * u, y + ph + 9 * u, String(m.scoreLimit), 9, '#9aa3b8', [0.5, 0.5], 20, '700');
      this.glyph('limIcon', 'trophy', lim.x - lim.width / 2 - 6 * u, y + ph + 9 * u, 9, 0x9aa3b8);
    } else if (mode === 'survival') {
      const drones = view.players.filter((p) => p.drone && p.alive).length;
      this.panel(cx - 100 * u, y, 200 * u, 44 * u, 12 * u);
      this.text('wave', cx, y + 15 * u, this.t('hud.waveN', { n: Math.max(1, m.wave) }), 16, '#ffd34d', [0.5, 0.5]);
      this.text('drones', cx, y + 32 * u, m.phase === 'intermission' ? this.t('hud.nextWave', { s: Math.ceil(m.phaseT / TICK_RATE) }) : this.t('hud.dronesLeft', { n: drones + (m.waveTotal - m.waveSpawned) }), 11, '#e6ecf7', [0.5, 0.5], 20, '700');
    } else if (mode === 'training') {
      this.panel(cx - 130 * u, y, 260 * u, 44 * u, 12 * u);
      this.text('train', cx, y + 15 * u, this.t('hud.training'), 15, '#9cff6b', [0.5, 0.5]);
      const best = this.ctx.courseBest || (me?.bestCourse ?? 0);
      this.text('course', cx, y + 32 * u, best ? this.t('hud.best', { s: (best / TICK_RATE).toFixed(2) }) : this.t('hud.courseHint'), 10, '#e6ecf7', [0.5, 0.5], 20, '700');
    } else {
      const ranked = [...view.players].filter((p) => !p.dummy).sort((a, b) => b.score - a.score);
      const pos = me ? ranked.findIndex((p) => p.id === me.id) + 1 : 0;
      const lead = ranked[0];
      this.panel(cx - 120 * u, y, 240 * u, 46 * u, 12 * u);
      if (mode === 'bomb') {
        const alive = view.players.filter((p) => !p.eliminated && !p.dummy).length;
        this.text('ffa', cx, y + 15 * u, this.t('hud.alive', { n: alive }), 16, '#ffffff', [0.5, 0.5]);
        const holder = view.players.find((p) => p.bomb);
        this.text('bombT', cx, y + 33 * u, holder ? `${(m.bombT / TICK_RATE).toFixed(1)}s` : timer, 13, '#ff8a7a', [0.5, 0.5]);
      } else {
        // Place badge + timer + leader.
        const g = this.under;
        const bx = cx - 112 * u;
        const podium = pos === 1 ? SUN : pos === 2 ? 0xd7dde8 : pos === 3 ? 0xe0a06a : 0x3a4060;
        g.fillStyle(podium, 1).fillRoundedRect(bx, y + 6 * u, 38 * u, 34 * u, 9 * u);
        this.text('pos', bx + 19 * u, y + 23 * u, me ? `#${pos}` : '-', 17, pos > 0 && pos <= 3 ? '#1b1d26' : '#ffffff', [0.5, 0.5]);
        if (pos > 0 && pos <= 3) this.texts.get('pos')!.setStroke('#ffffff', 0);
        else this.texts.get('pos')!.setStroke('#0a0c12', Math.max(2, Math.round(this.texts.get('pos')!.getData('px') / 6)));
        this.text('ffa', bx + 48 * u, y + 15 * u, me ? `${me.score} / ${m.scoreLimit}` : '', 15, '#ffffff', [0, 0.5]);
        this.text('lead', bx + 48 * u, y + 32 * u, `${this.t('hud.leader')}: ${lead ? this.ctx.client.playerName(lead.id) : '-'} ${lead?.score ?? 0}`, 10, '#c9d2e0', [0, 0.5], 20, '700');
        this.text('timer', cx + 112 * u, y + 23 * u, timer, 17, lowTime ? '#ff8a7a' : '#ffffff', [1, 0.5]);
      }
    }
    if (mode === 'ctf') {
      m.flags.forEach((f, i) => {
        const st = f.state === 0 ? this.t('hud.flagHome') : f.state === 1 ? this.t('hud.flagCarried') : this.t('hud.flagDropped2');
        this.text(`flagst${i}`, i === 0 ? cx - 65 * u : cx + 65 * u, y + 58 * u, st, 10, hex(this.ctx.teamColor(i)), [0.5, 0]);
      });
    }
    if (mode === 'koth') {
      const z = m.zone;
      const owner = z.owner === 0 || z.owner === 1 ? this.t(z.owner === 0 ? 'team.red' : 'team.blue') : z.owner === 2 ? this.t('hud.contested') : this.t('hud.neutral');
      this.text('zone', cx, y + 58 * u, `${this.t('hud.zone')}: ${owner} · ${Math.ceil(z.t / TICK_RATE)}s`, 11, '#ffd34d', [0.5, 0]);
    }
  }

  private minimapRect(): { x: number; y: number; w: number; h: number } {
    const u = this.u;
    const w = (this.ctx.isTouch ? 118 : 150) * u;
    const h = (w * this.map.height) / this.map.width;
    return { x: this.scale.width - this.inset.r - w, y: this.inset.t, w, h };
  }

  private drawMinimap(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const r = this.minimapRect();
    const mm = this.minimap;
    const pad = 4 * u;
    this.panel(r.x - pad, r.y - pad + pad, r.w + pad * 2, r.h + pad * 2, 10 * u, 0.55);
    mm.setDisplaySize(r.w, r.h).setPosition(r.x + r.w, r.y + pad).setVisible(true);
    const ox = r.x;
    const oy = r.y + pad;
    const k = r.w / (this.map.width * TILE);
    const now = performance.now();
    for (const p of view.players) {
      if (!p.alive || p.dummy) continue;
      const mine = p.id === me?.id;
      const ally = !!me && p.team >= 0 && p.team === me.team;
      const fired = now - (this.ctx.recentFire.get(p.id) ?? -1e9) < 2500;
      if (!mine && !ally && !fired) continue;
      const color = mine ? SUN : ally ? this.ctx.teamColor(p.team) : 0xff5a4f;
      const px = ox + p.x * k;
      const py = oy + p.y * k - 2 * u;
      this.g.fillStyle(0x05060a, 0.9).fillCircle(px, py, (mine ? 4.4 : 3.4) * u);
      this.g.fillStyle(color, 1).fillCircle(px, py, (mine ? 3.2 : 2.3) * u);
    }
    const m = view.mode;
    if (this.ctx.client.start!.config.mode === 'ctf') {
      for (const f of m.flags) this.g.fillStyle(this.ctx.teamColor(f.team), 1).fillTriangle(ox + f.x * k - 3 * u, oy + f.y * k, ox + f.x * k + 3 * u, oy + f.y * k, ox + f.x * k, oy + f.y * k - 7 * u);
    }
    if (this.ctx.client.start!.config.mode === 'koth') {
      const z = m.zone;
      this.g.lineStyle(2 * u, SUN, 1).strokeRect(ox + z.x * k, oy + z.y * k, z.w * k, z.h * k);
    }
    // Network quality bars.
    const st = this.ctx.client.stats;
    if (this.ctx.client.kind !== 'local') {
      const q = st.rtt < 80 && st.loss < 0.02 ? 3 : st.rtt < 160 && st.loss < 0.05 ? 2 : 1;
      const bx = r.x - 30 * u;
      const by = r.y + 6 * u;
      for (let i = 0; i < 3; i++) {
        this.g.fillStyle(i < q ? (q === 3 ? 0x6dff8a : q === 2 ? SUN : 0xff5a4f) : 0x555a66, 1).fillRoundedRect(bx + i * 6 * u, by + 10 * u - i * 4 * u, 4 * u, 6 * u + i * 4 * u, 1 * u);
      }
      this.text('ping', bx + 8 * u, by + 20 * u, `${st.rtt}ms`, 9, '#ffffff', [0.5, 0], 20, '700');
    }
  }

  private drawKillFeed(): void {
    const u = this.u;
    const now = performance.now();
    const feed = this.ctx.killfeed.filter((k) => now - k.t < 5000);
    const myId = this.ctx.client.playerId;
    const mm = this.minimapRect();
    let y = mm.y + mm.h + 16 * u;
    const right = this.scale.width - this.inset.r;
    const maxRows = this.ctx.isTouch ? 3 : 5;
    feed.slice(-maxRows).forEach((k, i) => {
      const victim = this.ctx.client.playerName(k.victim);
      const killer = k.killer >= 0 ? this.ctx.client.playerName(k.killer) : '';
      const how = killLabel(k.code, this.t.bind(this));
      const mine = k.killer === myId || k.victim === myId;
      const alpha = Math.min(1, (5000 - (now - k.t)) / 600, (now - k.t) / 120);
      const vt = this.text(`kfv${i}`, right - 8 * u, y + 10 * u, victim, 11, k.victim === myId ? '#ffd34d' : '#ffffff', [1, 0.5]);
      let x = vt.x - vt.width - 6 * u;
      let wt: Phaser.GameObjects.Text | Phaser.GameObjects.Image;
      if (k.code < WEAPONS.length) {
        wt = this.icon(`kfw${i}`, weaponIcon(this, k.code), x, y + 10 * u, (u * 2 * 0.7) / CHAR_SCALE).setOrigin(1, 0.5);
        x -= wt.displayWidth + 6 * u;
      } else {
        wt = this.text(`kfh${i}`, x, y + 10 * u, how, 10, '#ffb38a', [1, 0.5], 20, '700');
        x -= wt.width + 6 * u;
      }
      if (k.head) {
        const h = this.text(`kfx${i}`, x, y + 10 * u, '✦', 11, '#ffd34d', [1, 0.5]);
        x -= h.width + 4 * u;
      }
      let kt: Phaser.GameObjects.Text | null = null;
      if (killer) {
        kt = this.text(`kfk${i}`, x, y + 10 * u, killer, 11, k.killer === myId ? '#ffd34d' : '#ffffff', [1, 0.5]);
        x -= kt.width;
      }
      const left = x - 8 * u;
      this.panel(left, y, right - left, 20 * u, 10 * u, mine ? 0.72 : 0.55, mine ? SUN : 0xffffff, mine ? 0.5 : 0.08);
      for (const o of [vt, wt, kt, this.texts.get(`kfx${i}`)]) if (o && o.visible) o.setAlpha(alpha);
      y += 24 * u;
    });
    const chats = this.ctx.chat.filter((c) => now - c.t < 6000);
    let cy = this.scale.height * 0.5;
    chats.forEach((c, i) => {
      const t = this.text(`chat${i}`, this.inset.l + 18 * u, cy + 9 * u, c.text, 11, '#e6f3ff', [0, 0.5], 20, '700');
      this.panel(this.inset.l + 8 * u, cy, t.width + 20 * u, 18 * u, 9 * u, 0.5);
      cy += 22 * u;
    });
  }

  private drawCenter(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const W = this.scale.width;
    const H = this.scale.height;
    const now = performance.now();
    const m = view.mode;
    if (m.phase === 'countdown') {
      const s = Math.ceil(m.phaseT / TICK_RATE);
      const frac = (m.phaseT / TICK_RATE) % 1;
      const pop = 1 + Math.max(0, frac - 0.75) * 1.2;
      const cy = Math.min(H * 0.27, this.inset.t + 150 * u);
      this.g.fillStyle(PANEL, 0.55).fillCircle(W / 2, cy, 46 * u);
      this.g.lineStyle(5 * u, SUN, 0.9).beginPath();
      this.g.arc(W / 2, cy, 46 * u, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      this.g.strokePath();
      this.text('count', W / 2, cy, String(s), 48, '#ffd34d', [0.5, 0.52]).setScale(pop);
      this.text('countSub', W / 2, cy + 62 * u, this.t('hud.getReady').toUpperCase(), 13, '#ffffff', [0.5, 0.5]);
    }
    // Announcements: banner that pops in and slides out.
    const anns = this.ctx.announcements.filter((a) => now - a.t < a.dur * 1000);
    anns.forEach((a, i) => {
      const age = (now - a.t) / 1000;
      const alpha = Math.min(1, age * 7, (a.dur - age) * 3);
      const pop = age < 0.18 ? 0.8 + (age / 0.18) * 0.28 : age < 0.3 ? 1.08 - ((age - 0.18) / 0.12) * 0.08 : 1;
      const yy = H * 0.22 + i * 46 * u;
      const tt = this.text(`ann${i}`, W / 2, yy, a.text, 22, hex(a.color), [0.5, 0.5]);
      tt.setAlpha(alpha).setScale(this.ctx.settings().accessibility.reduceMotion ? 1 : pop);
      const bw = tt.width * tt.scaleX + 48 * u;
      const bh = (a.sub ? 50 : 36) * u;
      this.under.fillStyle(PANEL, 0.6 * alpha).fillRoundedRect(W / 2 - bw / 2, yy - 18 * u, bw, bh, 12 * u);
      this.under.fillStyle(a.color, 0.9 * alpha).fillRoundedRect(W / 2 - bw / 2 + 12 * u, yy - 18 * u, bw - 24 * u, 2.5 * u, 1.2 * u);
      if (a.sub) this.text(`annsub${i}`, W / 2, yy + 20 * u, a.sub, 12, '#ffffff', [0.5, 0.5], 20, '700').setAlpha(alpha);
    });
    if (!me) return;
    // Pickup prompt with a key cap.
    if (me.alive) {
      const near = this.nearbyWeapon(view, me);
      if (near >= 0) {
        const verb = this.ctx.isTouch ? '⇄' : this.ctx.controls.device === 'gamepad' ? 'RB' : 'Q';
        const msg = this.t('hud.pickupPrompt', { key: '', name: WEAPONS[near].name }).replace(/^\s*[—-]\s*/, '');
        const tt = this.text('prompt', W / 2 + 14 * u, H * 0.7, msg, 13, '#ffffff', [0.5, 0.5]);
        const kw = Math.max(24 * u, this.text('promptKey', 0, 0, verb, 12, '#1b1d26', [0.5, 0.5]).width + 12 * u);
        const total = kw + 10 * u + tt.width;
        const x0 = W / 2 - total / 2;
        tt.setPosition(x0 + kw + 10 * u + tt.width / 2, H * 0.7);
        this.panel(x0 - 8 * u, H * 0.7 - 17 * u, total + 16 * u, 34 * u, 17 * u, 0.62);
        this.g.fillStyle(SUN, 1).fillRoundedRect(x0, H * 0.7 - 11 * u, kw, 22 * u, 6 * u);
        this.texts.get('promptKey')!.setPosition(x0 + kw / 2, H * 0.7).setStroke('#000', 0);
      }
    }
    // Death card.
    if (!me.alive && m.phase === 'playing') {
      const cw = Math.min(W * 0.8, 380 * u);
      const ch = 118 * u;
      const x0 = W / 2 - cw / 2;
      const y0 = H * 0.3;
      this.panel(x0, y0, cw, ch, 18 * u, 0.72, 0xff5a4f, 0.35);
      const d = this.ctx.lastDeath;
      const killer = d && d.killer >= 0 ? this.ctx.client.playerName(d.killer) : '';
      this.text('dead', W / 2, y0 + 24 * u, killer ? this.t('hud.takenDownBy', { name: killer }) : this.t('hud.youWentDown'), 19, '#ffffff', [0.5, 0.5]);
      if (d && d.code < WEAPONS.length) this.icon('deadw', weaponIcon(this, d.code), W / 2, y0 + 56 * u, (u * 2 * 1.6) / CHAR_SCALE);
      else if (d) this.text('deadhow', W / 2, y0 + 56 * u, killLabel(d.code, this.t.bind(this)), 15, '#ffd34d', [0.5, 0.5]);
      const msg =
        me.eliminated || me.respawnT > 100000
          ? this.t(me.eliminated ? 'hud.eliminated' : 'hud.waitWave')
          : this.t('hud.respawnIn', { s: Math.max(0, me.respawnT / TICK_RATE).toFixed(1) });
      this.text('respawn', W / 2, y0 + 88 * u, msg, 13, '#c9d2e0', [0.5, 0.5], 20, '700');
      if (!me.eliminated && me.respawnT < 100000) {
        const total = 3 * TICK_RATE;
        this.bar(x0 + 40 * u, y0 + 102 * u, cw - 80 * u, 5 * u, 1 - Math.min(1, me.respawnT / total), SUN);
      }
    }
    // Survival upgrade cards.
    this.upgradeRects = [];
    if (me.pendingUpgrade && m.phase === 'intermission') {
      const choices = upgradeChoices(m.wave);
      const cw = 156 * u;
      const ch = 96 * u;
      const total = choices.length * cw + (choices.length - 1) * 14 * u;
      let x = W / 2 - total / 2;
      const y = H * 0.52;
      choices.forEach((id, i) => {
        this.panel(x, y, cw, ch, 16 * u, 0.82, SUN, 0.75);
        this.text(`up${i}`, x + cw / 2, y + 24 * u, this.t(`upgrade.${id}`), 15, '#ffd34d', [0.5, 0.5]);
        const d = this.text(`upd${i}`, x + cw / 2, y + 52 * u, this.t(`upgrade.${id}.desc`), 11, '#ffffff', [0.5, 0.5], 20, '700');
        d.setWordWrapWidth(cw - 20 * u).setAlign('center');
        if (!this.ctx.isTouch) {
          this.g.fillStyle(SUN, 1).fillRoundedRect(x + cw / 2 - 12 * u, y + ch - 24 * u, 24 * u, 16 * u, 4 * u);
          this.text(`upk${i}`, x + cw / 2, y + ch - 16 * u, `${i + 1}`, 11, '#1b1d26', [0.5, 0.5]).setStroke('#000', 0);
        }
        this.upgradeRects.push({ x, y, w: cw, h: ch, idx: i });
        x += cw + 14 * u;
      });
    }
  }

  private nearbyWeapon(view: ClientView, me: PlayerView): number {
    const held = (wi: number) => me.slots[0].wi === wi || me.slots[1].wi === wi;
    for (const d of view.dropped) if (!held(d.wi) && Math.abs(d.x - me.x) < 24 && Math.abs(d.y - me.y) < 40) return d.wi;
    const objs = this.map.objects.filter((o) => o.kind === 'weapon' || o.kind === 'heavy' || o.kind === 'health' || o.kind === 'grenade' || o.kind === 'dual');
    for (let i = 0; i < view.spawners.length; i++) {
      const s = view.spawners[i];
      const o = objs[i];
      if (!o || !s.available || (o.kind !== 'weapon' && o.kind !== 'heavy') || s.item < 0 || held(s.item)) continue;
      const def = WEAPONS[s.item];
      const slot = me.slots[def.slot === 'sidearm' ? 0 : 1];
      if (slot.wi < 0) continue;
      if (Math.abs(o.x - me.x) < 24 && Math.abs(o.y - me.y) < 40) return s.item;
    }
    return -1;
  }

  private drawOverlays(view: ClientView, me: PlayerView | null): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const s = this.ctx.settings();
    // Damage direction indicators: soft arcs around the screen centre.
    for (let i = this.ctx.damageDirs.length - 1; i >= 0; i--) {
      const d = this.ctx.damageDirs[i];
      d.t -= 1 / 60;
      if (d.t <= 0) {
        this.ctx.damageDirs.splice(i, 1);
        continue;
      }
      const r = Math.min(W, H) * 0.3;
      for (const [w, a] of [
        [14, 0.25],
        [6, 0.85],
      ]) {
        this.g.lineStyle(w * this.u, 0xff3b3b, d.t * a);
        this.g.beginPath();
        this.g.arc(W / 2, H / 2, r, d.angle - 0.28, d.angle + 0.28);
        this.g.strokePath();
      }
    }
    // Hurt flash and low-health vignette.
    if (this.ctx.hurtFlash > 0) {
      this.lowHp.setVisible(true).setAlpha(Math.min(1, this.ctx.hurtFlash * (s.graphics.reduceFlashes ? 1 : 2.2)));
      this.ctx.hurtFlash = Math.max(0, this.ctx.hurtFlash - 0.03);
    } else this.lowHp.setVisible(false);
    if (me && me.alive && me.hp < me.maxHp * 0.3) {
      const pulse = 0.55 + Math.sin(performance.now() * 0.006) * (s.accessibility.reduceMotion ? 0 : 0.25);
      this.lowHp.setVisible(true).setAlpha(Math.max(this.lowHp.alpha * (this.ctx.hurtFlash > 0 ? 1 : 0), pulse));
    }
    void view;
  }

  private drawDebug(view: ClientView): void {
    const s = this.ctx.settings();
    const u = this.u;
    const st = this.ctx.client.stats;
    const ft = this.ctx.frameTimes;
    const avg = ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length);
    const sorted = [...ft].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    const lines: string[] = [];
    if (s.graphics.showFps) lines.push(`${Math.round(1000 / Math.max(1, avg))} fps  p99 ${p99.toFixed(1)}ms  ents ${this.ctx.drawEntities}`);
    if (s.network.showNetStats)
      lines.push(
        `rtt ${st.rtt}ms ±${st.jitter}  loss ${(st.loss * 100).toFixed(1)}%  snaps ${st.snapshotRate}/s`,
        `corr ${st.correctionsPerSec}/s (${st.lastCorrection.toFixed(1)}px)  buf ${st.inputBuffer}`,
        `↓ ${(st.bytesInPerSec / 1024).toFixed(1)} KB/s  ↑ ${(st.bytesOutPerSec / 1024).toFixed(1)} KB/s  tick ${view.tick}`,
      );
    const x0 = this.ctx.isTouch ? this.scale.width * 0.3 : this.inset.l + 8 * u;
    lines.forEach((l, i) => this.text(`dbg${i}`, x0, this.scale.height - this.inset.b - 18 * u * (lines.length - i), l, 10, '#9cff6b', [0, 0], 20, '700'));
    if (s.graphics.showFps) {
      const gx = x0;
      const gy = this.scale.height - this.inset.b - 18 * u * (lines.length + 1) - 30 * u;
      this.g.fillStyle(0x000000, 0.4).fillRect(gx, gy, 120 * u, 30 * u);
      ft.forEach((v, i) => this.g.fillStyle(v > 20 ? 0xff5a4f : 0x7dff7a, 1).fillRect(gx + i * u, gy + 30 * u - Math.min(30, v) * u, u, Math.min(30, v) * u));
    }
  }

  private drawCaptions(): void {
    const now = performance.now();
    const caps = this.ctx.captions.filter((c) => now - c.t < 2500);
    caps.forEach((c, i) => {
      const t = this.text(`cap${i}`, this.scale.width / 2, this.scale.height * 0.8 + i * 22 * this.u, c.text, 12, '#ffffff', [0.5, 0.5], 20, '700');
      this.panel(t.x - t.width / 2 - 10 * this.u, t.y - 10 * this.u, t.width + 20 * this.u, 20 * this.u, 10 * this.u, 0.6);
    });
  }

  private drawTutorial(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const W = this.scale.width;
    const step = this.ctx.tutorialStep;
    const f = this.tutFlags;
    const ctrl = this.ctx.controls;
    if (me) {
      if (Math.abs(me.vx) > 50) f.moved = true;
      if (me.jetting) f.flew = true;
      if (this.ctx.localShots > 0) f.shot = true;
      if (ctrl.device !== 'touch' && ctrl.mouseWorld) f.aimed = f.aimed || this.tutorialT > 1.5;
      if (step === 4 && this.tutorialStartSlot >= 0 && me.active !== this.tutorialStartSlot) f.swapped = true;
      if (this.tutorialStartSlot < 0) this.tutorialStartSlot = me.active;
    }
    const done = [f.moved, f.flew, f.aimed, f.shot, f.swapped, f.threw, f.melee, false][step];
    this.tutorialT += 1 / 60;
    if (done && this.tutorialT > 1.2) {
      this.ctx.tutorialStep++;
      this.tutorialT = 0;
      if (me) this.tutorialStartSlot = me.active;
      audio.play('pickup');
      if (this.ctx.tutorialStep === TUTORIAL_STEPS.length - 1) this.ctx.callbacks.onTutorialDone?.();
    }
    const key = TUTORIAL_STEPS[Math.min(TUTORIAL_STEPS.length - 1, this.ctx.tutorialStep)];
    const device = ctrl.device === 'touch' ? 'touch' : ctrl.device === 'gamepad' ? 'pad' : 'kb';
    const pw = Math.min(W * 0.56, 500 * u);
    const px = W / 2 - pw / 2;
    const py = this.inset.t + 64 * u;
    const ph = 72 * u;
    this.panel(px, py, pw, ph, 18 * u, 0.82, 0x9cff6b, 0.6);
    this.g.fillStyle(0x9cff6b, 1).fillCircle(px + 36 * u, py + ph / 2, 22 * u);
    this.glyph('tutAva', 'star', px + 36 * u, py + ph / 2, 22, 0x1b1d26);
    this.text('tutName', px + 68 * u, py + 10 * u, this.t('tut.instructor').toUpperCase(), 10, '#9cff6b', [0, 0], 20, '800');
    const msg = this.t(`${key}.${device}`);
    const tt = this.text('tutMsg', px + 68 * u, py + 28 * u, msg, 13, '#ffffff', [0, 0], 20, '700');
    tt.setWordWrapWidth(pw - 84 * u);
    // Step dots.
    const n = TUTORIAL_STEPS.length;
    for (let i = 0; i < n; i++) {
      const dx = px + pw - 14 * u - (n - 1 - i) * 9 * u;
      this.g.fillStyle(i <= step ? 0x9cff6b : 0x3a4060, 1).fillCircle(dx, py + 14 * u, 3 * u);
    }
    void view;
  }
  private tutorialStartSlot = -1;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function killLabel(code: number, t: (k: string) => string): string {
  if (code < WEAPONS.length) return WEAPONS[code].name;
  if (code === KILL_MELEE) return t('kill.melee');
  if (code === KILL_LAVA) return t('kill.lava');
  if (code === KILL_WORLD) return t('kill.world');
  if (code === KILL_BOMB) return t('kill.bomb');
  if (code === KILL_BURN) return t('kill.burn');
  if (code === KILL_GAS) return t('kill.gas');
  if (code >= KILL_GRENADE && code < KILL_GRENADE + 10) return GRENADES[code - KILL_GRENADE]?.name ?? '';
  return '';
}
