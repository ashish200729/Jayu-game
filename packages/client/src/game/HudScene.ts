import Phaser from 'phaser';
import { GRENADES, TICK_RATE, TILE, WEAPONS, upgradeChoices } from '@game/content';
import { getMap, Tile, type MapData } from '@game/maps';
import type { ClientView, PlayerView } from '@game/net';
import { KILL_BOMB, KILL_BURN, KILL_GAS, KILL_GRENADE, KILL_LAVA, KILL_MELEE, KILL_WORLD, SIGNAL_UPGRADE } from '@game/sim';
import { audio } from '../audio';
import { weaponIcon } from '../art/characters';
import { canvas, hex } from '../art/draw';
import type { GameContext } from './context';

const FONT = 'Baloo 2, system-ui, sans-serif';
const INK = 0x1b1d26;

type ButtonId = 'fire' | 'jet' | 'grenade' | 'swap' | 'reload' | 'melee' | 'zoom' | 'crouch' | 'emote' | 'pause' | 'score';

interface TouchButton {
  id: ButtonId;
  x: number;
  y: number;
  r: number;
  img: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  pointer: number;
  visible: boolean;
}

interface Stick {
  pointer: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
  base: Phaser.GameObjects.Arc;
  knob: Phaser.GameObjects.Arc;
  homeX: number;
  homeY: number;
  r: number;
}

const TUTORIAL_STEPS = ['tut.move', 'tut.fly', 'tut.aim', 'tut.shoot', 'tut.swap', 'tut.grenade', 'tut.melee', 'tut.done'];

export class HudScene extends Phaser.Scene {
  ctx!: GameContext;
  private map!: MapData;
  private g!: Phaser.GameObjects.Graphics;
  private texts = new Map<string, Phaser.GameObjects.Text>();
  private icons = new Map<string, Phaser.GameObjects.Image>();
  private minimapKey = '';
  private minimap!: Phaser.GameObjects.Image;
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
    this.layout();
  }

  private t(key: string, vars?: Record<string, string | number>): string {
    return this.ctx.callbacks.t(key, vars);
  }

  private text(key: string, x: number, y: number, str: string, size: number, color = '#ffffff', origin: [number, number] = [0, 0], depth = 20): Phaser.GameObjects.Text {
    let tx = this.texts.get(key);
    const px = Math.round(size * this.u * this.ctx.settings().accessibility.textScale);
    if (!tx) {
      tx = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: `${px}px`, fontStyle: '800', color, stroke: '#1b1d26', strokeThickness: Math.max(2, Math.round(px / 5)) }).setDepth(depth);
      this.texts.set(key, tx);
    }
    if (tx.style.fontSize !== `${px}px`) tx.setFontSize(px);
    if (tx.text !== str) tx.setText(str);
    if (tx.style.color !== color) tx.setColor(color);
    tx.setPosition(Math.round(x), Math.round(y)).setOrigin(origin[0], origin[1]).setVisible(true);
    return tx;
  }

  private icon(key: string, tex: string, x: number, y: number, scale: number, depth = 20): Phaser.GameObjects.Image {
    let im = this.icons.get(key);
    if (!im) {
      im = this.add.image(0, 0, tex).setDepth(depth);
      this.icons.set(key, im);
    }
    if (im.texture.key !== tex) im.setTexture(tex);
    return im.setPosition(x, y).setScale(scale).setVisible(true);
  }

  private hideAll(): void {
    for (const t of this.texts.values()) t.setVisible(false);
    for (const i of this.icons.values()) i.setVisible(false);
  }

  // ------------------------------------------------------------------ layout

  private layout(): void {
    const s = this.ctx.settings();
    this.u = this.ctx.dpr * s.accessibility.uiScale * Math.max(0.8, Math.min(1.25, Math.min(this.scale.width / this.ctx.dpr, this.scale.height / this.ctx.dpr * 1.8) / 760));
    const css = getComputedStyle(document.documentElement);
    const read = (n: string) => (parseFloat(css.getPropertyValue(n)) || 0) * this.ctx.dpr;
    this.inset = { l: Math.max(read('--sal'), 8 * this.ctx.dpr), r: Math.max(read('--sar'), 8 * this.ctx.dpr), t: Math.max(read('--sat'), 6 * this.ctx.dpr), b: Math.max(read('--sab'), 6 * this.ctx.dpr) };
    this.placeTouch();
  }

  private buildMinimap(): void {
    const m = this.map;
    const key = `minimap:${m.id}`;
    this.minimapKey = key;
    if (!this.textures.exists(key)) {
      const [c, g] = canvas(m.width * 2, m.height * 2);
      g.fillStyle = 'rgba(20,22,32,0.55)';
      g.fillRect(0, 0, c.width, c.height);
      for (let y = 0; y < m.height; y++)
        for (let x = 0; x < m.width; x++) {
          const t = m.tiles[y * m.width + x];
          if (t === Tile.Solid || t === Tile.Ice) g.fillStyle = 'rgba(230,236,245,0.85)';
          else if (t === Tile.OneWay) g.fillStyle = 'rgba(230,236,245,0.45)';
          else if (t === Tile.Lava) g.fillStyle = 'rgba(255,106,31,0.9)';
          else if (t === Tile.Water) g.fillStyle = 'rgba(58,160,255,0.6)';
          else continue;
          g.fillRect(x * 2, y * 2, 2, 2);
        }
      this.textures.addCanvas(key, c);
    }
    this.minimap = this.add.image(0, 0, key).setOrigin(1, 0).setDepth(5);
  }

  private buildTouch(): void {
    const mk = (id: ButtonId, label: string): TouchButton => {
      const img = this.add.circle(0, 0, 10, 0xffffff, 0.18).setStrokeStyle(3, 0xffffff, 0.5).setDepth(30);
      const lt = this.add.text(0, 0, label, { fontFamily: FONT, fontSize: '16px', fontStyle: '800', color: '#ffffff' }).setOrigin(0.5).setDepth(31);
      return { id, x: 0, y: 0, r: 10, img, label: lt, pointer: -1, visible: true };
    };
    this.buttons = [
      mk('fire', '●'),
      mk('jet', '▲'),
      mk('grenade', 'G'),
      mk('swap', '⇄'),
      mk('reload', 'R'),
      mk('melee', '✊'),
      mk('zoom', '◎'),
      mk('crouch', '▼'),
      mk('emote', '☺'),
      mk('pause', 'II'),
      mk('score', '≡'),
    ];
    const stick = (): Stick => ({
      pointer: -1,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
      homeX: 0,
      homeY: 0,
      r: 60,
      base: this.add.circle(0, 0, 60, 0xffffff, 0.1).setStrokeStyle(3, 0xffffff, 0.35).setDepth(30),
      knob: this.add.circle(0, 0, 26, 0xffffff, 0.35).setDepth(31),
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
        b.r = 22 * this.u;
        b.x = W / 2 + (b.id === 'pause' ? 1 : -1) * (180 * this.u);
        b.y = this.inset.t + 26 * this.u;
        b.visible = touch;
      } else {
        const l = layout[b.id];
        if (!l) continue;
        b.r = Math.max(24 * this.ctx.dpr, base * l.size);
        b.x = Math.max(this.inset.l + b.r, Math.min(W - this.inset.r - b.r, l.x * W));
        b.y = Math.max(this.inset.t + b.r, Math.min(H - this.inset.b - b.r, l.y * H));
        b.visible = touch && l.visible && !(b.id === 'fire' && s.controls.aimToFire && !l.visible) && !(b.id === 'jet' && !s.controls.jetButton && !l.visible);
        b.img.setAlpha(l.opacity);
        b.label.setAlpha(Math.min(1, l.opacity + 0.35));
      }
      b.img.setRadius(b.r).setPosition(b.x, b.y).setVisible(b.visible);
      b.label.setPosition(b.x, b.y).setFontSize(Math.round(b.r * 0.7)).setVisible(b.visible);
    }
    const fireL = layout.fire;
    const jetL = layout.jet;
    const fireBtn = this.buttons.find((b) => b.id === 'fire')!;
    const jetBtn = this.buttons.find((b) => b.id === 'jet')!;
    fireBtn.visible = touch && (!s.controls.aimToFire || fireL.visible);
    jetBtn.visible = touch && (s.controls.jetButton || jetL.visible);
    fireBtn.img.setVisible(fireBtn.visible);
    fireBtn.label.setVisible(fireBtn.visible);
    jetBtn.img.setVisible(jetBtn.visible);
    jetBtn.label.setVisible(jetBtn.visible);
    for (const [st, l] of [
      [this.move, layout.move],
      [this.aim, layout.aim],
    ] as const) {
      st.r = 62 * this.u * l.size;
      st.homeX = Math.max(this.inset.l + st.r, Math.min(W - this.inset.r - st.r, l.x * W));
      st.homeY = Math.max(this.inset.t + st.r, Math.min(H - this.inset.b - st.r, l.y * H));
      if (st.pointer < 0) {
        st.ox = st.homeX;
        st.oy = st.homeY;
      }
      st.base.setRadius(st.r).setPosition(st.ox, st.oy).setVisible(touch).setAlpha(l.opacity);
      st.knob.setRadius(st.r * 0.42).setPosition(st.ox + st.x * st.r, st.oy + st.y * st.r).setVisible(touch);
    }
  }

  // ------------------------------------------------------------------ touch input

  private hitButton(x: number, y: number): TouchButton | null {
    for (const b of this.buttons) if (b.visible && Math.hypot(x - b.x, y - b.y) < b.r * 1.15) return b;
    return null;
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
      b.img.setFillStyle(0xffffff, 0.45);
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
      b.img.setFillStyle(0xffffff, 0.18);
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

  private bar(x: number, y: number, w: number, h: number, frac: number, color: number, back = 0x1b1d26): void {
    const g = this.g;
    g.fillStyle(back, 0.75).fillRoundedRect(x - 2, y - 2, w + 4, h + 4, (h + 4) / 2);
    if (frac > 0) g.fillStyle(color, 1).fillRoundedRect(x, y, Math.max(h, w * Math.min(1, frac)), h, h / 2);
    g.fillStyle(0xffffff, 0.25).fillRoundedRect(x + 2, y + 1, Math.max(0, w * Math.min(1, frac) - 4), h * 0.35, h * 0.2);
  }

  private drawTopLeft(view: ClientView, me: PlayerView | null): void {
    if (!me) return;
    const u = this.u;
    const x = this.inset.l + 6 * u;
    let y = this.inset.t + 6 * u;
    const w = 170 * u;
    const hpFrac = me.alive ? me.hp / me.maxHp : 0;
    const hpColor = hpFrac > 0.5 ? 0x7dff7a : hpFrac > 0.25 ? 0xffd34d : 0xff5a4f;
    this.text('hpIcon', x, y - 2 * u, '✚', 18, '#ff6b6b');
    this.bar(x + 22 * u, y + 4 * u, w, 12 * u, hpFrac, hpColor);
    this.text('hp', x + 26 * u + w, y - 1 * u, String(Math.max(0, me.hp)), 16);
    y += 22 * u;
    const fuelFrac = me.fuel / (100 * (1 + me.upgrades.fuel * 0.3));
    const low = fuelFrac < 0.2 && Math.floor(performance.now() / 200) % 2 === 0;
    this.text('fuelIcon', x + 2 * u, y - 3 * u, '♨', 16, '#ffb84d');
    this.bar(x + 22 * u, y + 2 * u, w * 0.8, 8 * u, fuelFrac, low ? 0xff5a4f : 0x5ad1ff);
    y += 18 * u;
    // Weapons panel.
    const slots = me.slots;
    const act = slots[me.active];
    if (act.wi >= 0) {
      const def = WEAPONS[act.wi];
      const panelW = 190 * u;
      this.g.fillStyle(0x1b1d26, 0.55).fillRoundedRect(x, y, panelW, 44 * u, 10 * u);
      this.icon('w0', weaponIcon(this, act.wi), x + 34 * u, y + 22 * u, 0.9 * u * (def.slot === 'sidearm' ? 1.2 : 0.85));
      const ammo = act.reserve < 0 ? `${act.mag}` : `${act.mag} / ${act.reserve}`;
      this.text('ammo', x + 72 * u, y + 4 * u, me.reloadT > 0 ? this.t('hud.reloading') : ammo, 18, act.mag === 0 ? '#ff6b6b' : '#ffffff');
      this.text('wname', x + 72 * u, y + 24 * u, def.name + (me.dualT > 0 && def.dualWieldable ? ' ×2' : ''), 12, '#c9d2e0');
      if (me.reloadT > 0) this.bar(x + 72 * u, y + 40 * u, 100 * u, 3 * u, 1 - me.reloadT / Math.max(1, def.reloadTime * TICK_RATE), 0xffd34d);
      const other = slots[1 - me.active];
      if (other.wi >= 0) {
        this.icon('w1', weaponIcon(this, other.wi), x + panelW + 26 * u, y + 22 * u, 0.55 * u).setAlpha(0.7);
      }
    }
    y += 50 * u;
    for (let i = 0; i < 3; i++) {
      const k = me.grenades[i];
      const im = this.icon(`gr${i}`, k !== undefined ? `grenade:${k}` : 'grenade:0', x + 12 * u + i * 22 * u, y + 8 * u, 1.3 * u);
      im.setAlpha(k !== undefined ? 1 : 0.2);
    }
    if (this.lastGrenades > me.grenades.length) this.tutFlags.threw = true;
    this.lastGrenades = me.grenades.length;
    if (me.dualT > 0) this.text('dual', x + 80 * u, y, `×2 ${Math.ceil(me.dualT / TICK_RATE)}s`, 14, '#ffd34d');
    if (me.zoom) this.text('zoom', x + 140 * u, y, this.t('hud.scope'), 14, '#9ff3ff');
  }

  private drawTopCenter(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const cx = this.scale.width / 2;
    const y = this.inset.t + 6 * u;
    const m = view.mode;
    const mode = this.ctx.client.start!.config.mode;
    const timer = m.timeLeft >= 0 ? fmtTime(m.timeLeft / TICK_RATE) : '';
    const teams = mode === 'tdm' || mode === 'ctf' || mode === 'leader' || mode === 'koth';
    this.g.fillStyle(0x1b1d26, 0.55).fillRoundedRect(cx - 120 * u, y, 240 * u, 40 * u, 12 * u);
    if (teams) {
      const [a, b] = m.teamScores;
      this.g.fillStyle(this.ctx.teamColor(0), 1).fillRoundedRect(cx - 112 * u, y + 6 * u, 60 * u, 28 * u, 8 * u);
      this.g.fillStyle(this.ctx.teamColor(1), 1).fillRoundedRect(cx + 52 * u, y + 6 * u, 60 * u, 28 * u, 8 * u);
      this.text('sa', cx - 82 * u, y + 20 * u, String(a), 20, '#ffffff', [0.5, 0.5]);
      this.text('sb', cx + 82 * u, y + 20 * u, String(b), 20, '#ffffff', [0.5, 0.5]);
      this.text('timer', cx, y + 20 * u, timer, 18, '#ffffff', [0.5, 0.5]);
      if (me && me.team >= 0) this.g.lineStyle(3 * u, 0xffffff, 1).strokeRoundedRect(me.team === 0 ? cx - 114 * u : cx + 50 * u, y + 4 * u, 64 * u, 32 * u, 9 * u);
    } else if (mode === 'survival') {
      const drones = view.players.filter((p) => p.drone && p.alive).length;
      this.text('wave', cx, y + 12 * u, this.t('hud.waveN', { n: Math.max(1, m.wave) }), 16, '#ffd34d', [0.5, 0.5]);
      this.text('drones', cx, y + 30 * u, m.phase === 'intermission' ? this.t('hud.nextWave', { s: Math.ceil(m.phaseT / TICK_RATE) }) : this.t('hud.dronesLeft', { n: drones + (m.waveTotal - m.waveSpawned) }), 12, '#ffffff', [0.5, 0.5]);
    } else if (mode === 'training') {
      this.text('train', cx, y + 12 * u, this.t('hud.training'), 16, '#9cff6b', [0.5, 0.5]);
      const best = this.ctx.courseBest || (me?.bestCourse ?? 0);
      this.text('course', cx, y + 30 * u, best ? this.t('hud.best', { s: (best / TICK_RATE).toFixed(2) }) : this.t('hud.courseHint'), 11, '#ffffff', [0.5, 0.5]);
    } else {
      const ranked = [...view.players].filter((p) => !p.dummy).sort((a, b) => b.score - a.score);
      const pos = me ? ranked.findIndex((p) => p.id === me.id) + 1 : 0;
      const lead = ranked[0];
      if (mode === 'bomb') {
        const alive = view.players.filter((p) => !p.eliminated && !p.dummy).length;
        this.text('ffa', cx, y + 12 * u, this.t('hud.alive', { n: alive }), 16, '#ffffff', [0.5, 0.5]);
        const holder = view.players.find((p) => p.bomb);
        this.text('bombT', cx, y + 30 * u, holder ? `💣 ${(m.bombT / TICK_RATE).toFixed(1)}s` : timer, 13, '#ff8a7a', [0.5, 0.5]);
      } else {
        this.text('ffa', cx, y + 12 * u, me ? this.t('hud.place', { n: pos, of: ranked.length, score: me.score }) : '', 15, '#ffffff', [0.5, 0.5]);
        this.text('lead', cx, y + 30 * u, `${timer}  ·  ${this.t('hud.leader')}: ${lead ? this.ctx.client.playerName(lead.id) : '-'} ${lead?.score ?? 0}/${m.scoreLimit}`, 11, '#c9d2e0', [0.5, 0.5]);
      }
    }
    if (mode === 'ctf') {
      m.flags.forEach((f, i) => {
        const st = f.state === 0 ? this.t('hud.flagHome') : f.state === 1 ? this.t('hud.flagCarried') : this.t('hud.flagDropped2');
        this.text(`flagst${i}`, i === 0 ? cx - 82 * u : cx + 82 * u, y + 46 * u, st, 10, hexS(this.ctx.teamColor(i)), [0.5, 0]);
      });
    }
    if (mode === 'koth') {
      const z = m.zone;
      const owner = z.owner === 0 || z.owner === 1 ? this.t(z.owner === 0 ? 'team.red' : 'team.blue') : z.owner === 2 ? this.t('hud.contested') : this.t('hud.neutral');
      this.text('zone', cx, y + 46 * u, `${this.t('hud.zone')}: ${owner} · ${Math.ceil(z.t / TICK_RATE)}s`, 11, '#ffd34d', [0.5, 0]);
    }
  }

  private drawMinimap(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const W = this.scale.width;
    const mm = this.minimap;
    const scale = (130 * u) / (this.map.width * 2);
    mm.setScale(scale).setPosition(W - this.inset.r - 6 * u, this.inset.t + 6 * u).setVisible(true);
    const ox = mm.x - this.map.width * 2 * scale;
    const oy = mm.y;
    const k = (2 * scale) / TILE;
    const now = performance.now();
    for (const p of view.players) {
      if (!p.alive || p.dummy) continue;
      const mine = p.id === me?.id;
      const ally = !!me && p.team >= 0 && p.team === me.team;
      const fired = now - (this.ctx.recentFire.get(p.id) ?? -1e9) < 2500;
      if (!mine && !ally && !fired) continue;
      const color = mine ? 0xffd34d : ally ? this.ctx.teamColor(p.team) : 0xff5a4f;
      this.g.fillStyle(color, 1).fillCircle(ox + p.x * k, oy + p.y * k - 2 * u, (mine ? 3.5 : 2.5) * u);
    }
    const m = view.mode;
    for (const f of m.flags) {
      if (this.ctx.client.start!.config.mode !== 'ctf') break;
      this.g.fillStyle(this.ctx.teamColor(f.team), 1).fillTriangle(ox + f.x * k - 3 * u, oy + f.y * k, ox + f.x * k + 3 * u, oy + f.y * k, ox + f.x * k, oy + f.y * k - 7 * u);
    }
    if (this.ctx.client.start!.config.mode === 'koth') {
      const z = m.zone;
      this.g.lineStyle(2 * u, 0xffd34d, 1).strokeRect(ox + z.x * k, oy + z.y * k, z.w * k, z.h * k);
    }
    // Network quality bars.
    const st = this.ctx.client.stats;
    if (this.ctx.client.kind !== 'local') {
      const q = st.rtt < 80 && st.loss < 0.02 ? 3 : st.rtt < 160 && st.loss < 0.05 ? 2 : 1;
      const bx = ox - 26 * u;
      for (let i = 0; i < 3; i++) {
        this.g.fillStyle(i < q ? (q === 3 ? 0x7dff7a : q === 2 ? 0xffd34d : 0xff5a4f) : 0x555a66, 1).fillRect(bx + i * 6 * u, oy + 14 * u - i * 4 * u, 4 * u, 6 * u + i * 4 * u);
      }
      this.text('ping', bx + 9 * u, oy + 24 * u, `${st.rtt}ms`, 10, '#ffffff', [0.5, 0]);
    }
  }

  private drawKillFeed(): void {
    const u = this.u;
    const W = this.scale.width;
    const now = performance.now();
    const feed = this.ctx.killfeed.filter((k) => now - k.t < 5000);
    const myId = this.ctx.client.playerId;
    let y = this.inset.t + 6 * u + (this.map.height * 2 * (130 * u)) / (this.map.width * 2) + 30 * u;
    feed.slice(-5).forEach((k, i) => {
      const victim = this.ctx.client.playerName(k.victim);
      const killer = k.killer >= 0 ? this.ctx.client.playerName(k.killer) : '';
      const how = killLabel(k.code, this.t.bind(this));
      const str = killer ? `${killer}  ${how}${k.head ? ' ✦' : ''}  ${victim}` : `${victim} ${how}`;
      const mine = k.killer === myId || k.victim === myId;
      const t = this.text(`kf${i}`, W - this.inset.r - 10 * u, y, str, 12, mine ? '#ffd34d' : '#ffffff', [1, 0]);
      t.setAlpha(Math.min(1, (5000 - (now - k.t)) / 600));
      y += 18 * u;
    });
    const chats = this.ctx.chat.filter((c) => now - c.t < 6000);
    let cy = this.scale.height * 0.62;
    chats.forEach((c, i) => {
      this.text(`chat${i}`, this.inset.l + 10 * u, cy, c.text, 12, '#e6f3ff');
      cy += 17 * u;
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
      this.text('count', W / 2, H * 0.4, String(s), 64, '#ffd34d', [0.5, 0.5]);
      this.text('countSub', W / 2, H * 0.4 + 48 * u, this.t('hud.getReady'), 16, '#ffffff', [0.5, 0.5]);
    }
    // Announcements.
    const anns = this.ctx.announcements.filter((a) => now - a.t < a.dur * 1000);
    anns.forEach((a, i) => {
      const age = (now - a.t) / 1000;
      const alpha = Math.min(1, age * 6, (a.dur - age) * 3);
      const tt = this.text(`ann${i}`, W / 2, H * 0.24 + i * 36 * u, a.text, 22, hexS(a.color), [0.5, 0.5]);
      tt.setAlpha(alpha);
      if (a.sub) this.text(`annsub${i}`, W / 2, H * 0.24 + i * 36 * u + 22 * u, a.sub, 13, '#ffffff', [0.5, 0.5]).setAlpha(alpha);
    });
    if (!me) return;
    // Pickup prompt.
    if (me.alive) {
      const near = this.nearbyWeapon(view, me);
      if (near >= 0) {
        const verb = this.ctx.isTouch ? '⇄' : this.ctx.controls.device === 'gamepad' ? 'RB' : 'Q';
        this.text('prompt', W / 2, H * 0.68, this.t('hud.pickupPrompt', { key: verb, name: WEAPONS[near].name }), 15, '#ffffff', [0.5, 0.5]);
      }
    }
    // Death screen.
    if (!me.alive && m.phase === 'playing') {
      this.g.fillStyle(0x0b0c14, 0.35).fillRect(0, H * 0.32, W, H * 0.24);
      const d = this.ctx.lastDeath;
      const killer = d && d.killer >= 0 ? this.ctx.client.playerName(d.killer) : '';
      this.text('dead', W / 2, H * 0.38, killer ? this.t('hud.takenDownBy', { name: killer }) : this.t('hud.youWentDown'), 22, '#ffffff', [0.5, 0.5]);
      if (d && d.code < WEAPONS.length) this.icon('deadw', weaponIcon(this, d.code), W / 2, H * 0.45, 1.1 * u);
      else if (d) this.text('deadhow', W / 2, H * 0.45, killLabel(d.code, this.t.bind(this)), 16, '#ffd34d', [0.5, 0.5]);
      if (me.eliminated || me.respawnT > 100000) this.text('respawn', W / 2, H * 0.51, this.t(me.eliminated ? 'hud.eliminated' : 'hud.waitWave'), 15, '#c9d2e0', [0.5, 0.5]);
      else this.text('respawn', W / 2, H * 0.51, this.t('hud.respawnIn', { s: Math.max(0, me.respawnT / TICK_RATE).toFixed(1) }), 15, '#c9d2e0', [0.5, 0.5]);
    }
    // Survival upgrade cards.
    this.upgradeRects = [];
    if (me.pendingUpgrade && m.phase === 'intermission') {
      const choices = upgradeChoices(m.wave);
      const cw = 150 * u;
      const ch = 90 * u;
      const total = choices.length * cw + (choices.length - 1) * 14 * u;
      let x = W / 2 - total / 2;
      const y = H * 0.55;
      choices.forEach((id, i) => {
        this.g.fillStyle(0x1b1d26, 0.85).fillRoundedRect(x, y, cw, ch, 14 * u);
        this.g.lineStyle(3 * u, 0xffd34d, 1).strokeRoundedRect(x, y, cw, ch, 14 * u);
        this.text(`up${i}`, x + cw / 2, y + 24 * u, this.t(`upgrade.${id}`), 15, '#ffd34d', [0.5, 0.5]);
        this.text(`upd${i}`, x + cw / 2, y + 52 * u, this.t(`upgrade.${id}.desc`), 11, '#ffffff', [0.5, 0.5]);
        this.text(`upk${i}`, x + cw / 2, y + 74 * u, this.ctx.isTouch ? '' : `[${i + 1}]`, 11, '#c9d2e0', [0.5, 0.5]);
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
    // Damage direction indicators.
    for (let i = this.ctx.damageDirs.length - 1; i >= 0; i--) {
      const d = this.ctx.damageDirs[i];
      d.t -= 1 / 60;
      if (d.t <= 0) {
        this.ctx.damageDirs.splice(i, 1);
        continue;
      }
      const r = Math.min(W, H) * 0.3;
      this.g.lineStyle(8 * this.u, 0xff3b3b, d.t * 0.8);
      this.g.beginPath();
      this.g.arc(W / 2, H / 2, r, d.angle - 0.25, d.angle + 0.25);
      this.g.strokePath();
    }
    // Hurt flash and low-health vignette.
    if (this.ctx.hurtFlash > 0) {
      this.g.fillStyle(0xff2020, this.ctx.hurtFlash * (s.graphics.reduceFlashes ? 0.4 : 0.6)).fillRect(0, 0, W, H);
      this.ctx.hurtFlash = Math.max(0, this.ctx.hurtFlash - 0.03);
    }
    if (me && me.alive && me.hp < me.maxHp * 0.3) {
      const pulse = 0.18 + Math.sin(performance.now() * 0.006) * (s.accessibility.reduceMotion ? 0 : 0.08);
      for (let i = 0; i < 6; i++) {
        this.g.lineStyle(14 * this.u, 0xff2020, pulse * (1 - i / 6));
        this.g.strokeRect(i * 12 * this.u, i * 12 * this.u, W - i * 24 * this.u, H - i * 24 * this.u);
      }
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
    lines.forEach((l, i) => this.text(`dbg${i}`, this.inset.l + 8 * u, this.scale.height - this.inset.b - 20 * u * (lines.length - i), l, 11, '#9cff6b'));
    // Frame-time graph.
    if (s.graphics.showFps) {
      const gx = this.inset.l + 8 * u;
      const gy = this.scale.height - this.inset.b - 20 * u * (lines.length + 1) - 30 * u;
      this.g.fillStyle(0x000000, 0.4).fillRect(gx, gy, 120 * u, 30 * u);
      ft.forEach((v, i) => this.g.fillStyle(v > 20 ? 0xff5a4f : 0x7dff7a, 1).fillRect(gx + i * u, gy + 30 * u - Math.min(30, v) * u, u, Math.min(30, v) * u));
    }
  }

  private drawCaptions(): void {
    const now = performance.now();
    const caps = this.ctx.captions.filter((c) => now - c.t < 2500);
    caps.forEach((c, i) => this.text(`cap${i}`, this.scale.width / 2, this.scale.height * 0.8 + i * 18 * this.u, `[${c.text}]`, 13, '#ffffff', [0.5, 0.5]));
  }

  private drawTutorial(view: ClientView, me: PlayerView | null): void {
    const u = this.u;
    const W = this.scale.width;
    const H = this.scale.height;
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
    const pw = Math.min(W * 0.6, 520 * u);
    const px = W / 2 - pw / 2;
    const py = H * 0.12 + 40 * u;
    this.g.fillStyle(0x1b1d26, 0.85).fillRoundedRect(px, py, pw, 70 * u, 16 * u);
    this.g.lineStyle(3 * u, 0x9cff6b, 1).strokeRoundedRect(px, py, pw, 70 * u, 16 * u);
    this.g.fillStyle(0x9cff6b, 1).fillCircle(px + 34 * u, py + 35 * u, 22 * u);
    this.text('tutAva', px + 34 * u, py + 35 * u, '🧢', 22, '#1b1d26', [0.5, 0.5]);
    this.text('tutName', px + 66 * u, py + 8 * u, this.t('tut.instructor'), 12, '#9cff6b');
    const msg = this.t(`${key}.${device}`);
    const tt = this.text('tutMsg', px + 66 * u, py + 26 * u, msg, 14, '#ffffff');
    tt.setWordWrapWidth(pw - 80 * u);
    this.text('tutStep', px + pw - 12 * u, py + 8 * u, `${Math.min(step + 1, TUTORIAL_STEPS.length)}/${TUTORIAL_STEPS.length}`, 11, '#c9d2e0', [1, 0]);
    void view;
  }
  private tutorialStartSlot = -1;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function hexS(c: number): string {
  return hex(c);
}

function killLabel(code: number, t: (k: string) => string): string {
  if (code < WEAPONS.length) return `[${WEAPONS[code].name}]`;
  if (code === KILL_MELEE) return `[${t('kill.melee')}]`;
  if (code === KILL_LAVA) return t('kill.lava');
  if (code === KILL_WORLD) return t('kill.world');
  if (code === KILL_BOMB) return `[${t('kill.bomb')}]`;
  if (code === KILL_BURN) return `[${t('kill.burn')}]`;
  if (code === KILL_GAS) return `[${t('kill.gas')}]`;
  if (code >= KILL_GRENADE && code < KILL_GRENADE + 10) return `[${GRENADES[code - KILL_GRENADE]?.name ?? ''}]`;
  return '';
}
