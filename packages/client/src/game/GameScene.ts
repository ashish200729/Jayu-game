import Phaser from 'phaser';
import { COSMETICS, GRENADES, TICK_RATE, TILE, WEAPONS } from '@game/content';
import { getMap, type MapData } from '@game/maps';
import type { ClientView, PlayerView } from '@game/net';
import { EventType, World, angleToRad, type SimEvent } from '@game/sim';
import { audio, type Sfx } from '../audio';
import { weaponIcon } from '../art/characters';
import { buildBackdrop, buildCommonTextures, buildMapChunks, liquidRects } from '../art/world';
import { Fx } from './fx';
import { CharacterRig } from './rig';
import type { GameContext } from './context';

const SHOT_SFX: Record<string, Sfx> = {
  light: 'shot_light',
  heavy: 'shot_heavy',
  shotgun: 'shot_shotgun',
  sniper: 'shot_sniper',
  rocket: 'shot_rocket',
  launcher: 'shot_launcher',
  rail: 'shot_rail',
  blade: 'shot_blade',
  flame: 'flame',
};

interface WeatherFlake {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class GameScene extends Phaser.Scene {
  ctx!: GameContext;
  private map!: MapData;
  private world!: World;
  private fx!: Fx;
  private rigs = new Map<number, CharacterRig>();
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private seenSprites = new Set<string>();
  private bgLayers: Phaser.GameObjects.TileSprite[] = [];
  private sky!: Phaser.GameObjects.Image;
  private liquids: { img: Phaser.GameObjects.Rectangle; surf: Phaser.GameObjects.Rectangle | null; kind: string; y: number }[] = [];
  private movers: Phaser.GameObjects.TileSprite[] = [];
  private zoneGfx!: Phaser.GameObjects.Graphics;
  private arcGfx!: Phaser.GameObjects.Graphics;
  private reticle!: Phaser.GameObjects.Image;
  private hitmark!: Phaser.GameObjects.Image;
  private dark: Phaser.Textures.CanvasTexture | null = null;
  private darkImg: Phaser.GameObjects.Image | null = null;
  private glows: { x: number; y: number; r: number; t: number }[] = [];
  private weather: WeatherFlake[] = [];
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private shakeT = 0;
  private shakeAmp = 0;
  private lastFrame = 0;
  private jetOn = new Set<number>();
  private lowFuelWarned = false;
  private musicStarted = false;
  private lastPhase = '';
  private lastCountdown = -1;
  private ventTimer = 0;

  constructor() {
    super({ key: 'game' });
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
  }

  create(): void {
    const c = this.ctx.client;
    const config = c.start!.config;
    this.map = getMap(config.mapId);
    this.world = new World(this.map, config.lowGravity);
    buildCommonTextures(this);
    const th = this.map.theme;
    // Sky + parallax.
    const { sky, layers } = buildBackdrop(this, th, this.map.id);
    this.sky = this.add.image(0, 0, sky).setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    layers.forEach((key, i) => {
      const ts = this.add.tileSprite(0, 0, this.scale.width, 512, key).setOrigin(0, 1).setScrollFactor(0).setDepth(1 + i);
      this.bgLayers.push(ts);
    });
    // Static tiles.
    for (const ch of buildMapChunks(this, this.map)) this.add.image(ch.x, ch.y, ch.key).setOrigin(0, 0).setDepth(10);
    // Liquids (animated).
    for (const l of liquidRects(this.map)) {
      const color = l.kind === 'water' ? 0x3aa0ff : 0xff6a1f;
      const img = this.add.rectangle(l.x, l.y, l.w, l.h, color, l.kind === 'water' ? 0.42 : 0.92).setOrigin(0, 0).setDepth(l.kind === 'water' ? 48 : 12);
      const surf = l.surface ? this.add.rectangle(l.x, l.y, l.w, 4, l.kind === 'water' ? 0xbfe6ff : 0xffd34d, 0.9).setOrigin(0, 0).setDepth(49) : null;
      this.liquids.push({ img, surf, kind: l.kind, y: l.y });
    }
    // Movers.
    for (const m of this.map.movers) {
      const key = m.kind === 'door' ? 'door' : m.kind === 'bridge' ? 'bridge' : 'platform';
      const ts = this.add.tileSprite(m.x, m.y, m.w, m.kind === 'platform' ? 14 : m.h, key).setOrigin(0, 0).setDepth(11);
      this.movers.push(ts);
    }
    this.zoneGfx = this.add.graphics().setDepth(23);
    this.arcGfx = this.add.graphics().setDepth(94);
    this.reticle = this.add.image(0, 0, 'reticle').setDepth(95).setScale(0.6).setAlpha(0.85);
    this.hitmark = this.add.image(0, 0, 'hitmark').setDepth(96).setScale(0.7).setVisible(false);
    this.fx = new Fx(this);
    this.fx.world = this.world;
    this.fx.setQuality(this.ctx.settings().graphics.quality);
    // Darkness for dark maps.
    if (th.dark) {
      const w = Math.ceil(this.scale.width / 4);
      const h = Math.ceil(this.scale.height / 4);
      this.dark = this.textures.createCanvas('darkness', w, h);
      this.darkImg = this.add.image(0, 0, 'darkness').setOrigin(0, 0).setScrollFactor(0).setDepth(90).setScale(4);
    }
    this.buildWeather();
    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.world.pxW, this.world.pxH);
    cam.setBackgroundColor(th.skyBottom);
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => this.cleanup());
    this.onResize();
    this.lastFrame = performance.now();
  }

  private cleanup(): void {
    this.scale.off('resize', this.onResize, this);
    audio.stopAllJets();
    audio.stopMusic();
    for (const r of this.rigs.values()) r.destroy();
    this.rigs.clear();
    if (this.dark) this.textures.remove('darkness');
  }

  private onResize(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.cameras.main.setSize(w, h);
    this.sky.setDisplaySize(w, h);
    this.bgLayers.forEach((l) => l.setSize(w, 512));
    if (this.dark) {
      this.dark.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    }
  }

  private buildWeather(): void {
    const kind = this.map.theme.weather;
    if (kind === 'none') return;
    const q = this.ctx.settings().graphics.quality;
    const n = q === 'low' ? 30 : q === 'medium' ? 60 : 100;
    const tint = { snow: 0xffffff, rain: 0x9fd0ff, sand: 0xe0c08a, embers: 0xff8a3d, dust: 0xc8c0b0, spores: 0xc8ff7a }[kind];
    for (let i = 0; i < n; i++) {
      const img = this.add
        .image(0, 0, kind === 'rain' ? 'spark' : 'dot')
        .setScrollFactor(0)
        .setDepth(80)
        .setTint(tint)
        .setAlpha(kind === 'rain' ? 0.5 : 0.7)
        .setScale(kind === 'rain' ? 0.8 : kind === 'snow' ? 0.18 + Math.random() * 0.15 : 0.12)
        .setBlendMode(kind === 'embers' || kind === 'spores' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      if (kind === 'rain') img.setRotation(Math.PI / 2 + 0.2);
      const speed = { snow: [-20, 60], rain: [-120, 700], sand: [380, 40], embers: [10, -60], dust: [40, 10], spores: [8, -20] }[kind];
      this.weather.push({ img, x: Math.random() * this.scale.width, y: Math.random() * this.scale.height, vx: speed[0] * (0.7 + Math.random() * 0.6), vy: speed[1] * (0.7 + Math.random() * 0.6) });
    }
  }

  // ------------------------------------------------------------------ frame

  override update(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const ctx = this.ctx;
    ctx.frameTimes.push(dt * 1000);
    if (ctx.frameTimes.length > 120) ctx.frameTimes.shift();
    const view = ctx.client.view();
    if (!view) return;
    if (!this.musicStarted) {
      this.musicStarted = true;
      audio.startMusic(this.map.theme.music);
    }
    const settings = ctx.settings();
    this.handleEvents(ctx.client.takeEvents(), view);
    this.handleLocalShots(view);
    this.updatePhaseCues(view);
    this.updatePlayers(view, dt, now);
    this.updateEntities(view, now);
    this.updateMovers(view);
    this.updateZoneAndFlags(view, now);
    this.updateCamera(view, dt);
    this.updateReticle(view, dt);
    this.updateParallax(now);
    this.updateWeather(dt);
    this.fx.update(dt);
    if (this.dark) this.updateDarkness(view, now);
    ctx.drawEntities = this.rigs.size + this.sprites.size + this.fx.count;
    if (settings.graphics.quality !== 'low' && (this.ventTimer += dt) > 0.12) {
      this.ventTimer = 0;
      this.ventParticles();
    }
  }

  private updatePhaseCues(view: ClientView): void {
    const m = view.mode;
    if (m.phase !== this.lastPhase) {
      if (m.phase === 'playing' && this.lastPhase === 'countdown') {
        audio.play('go');
        this.ctx.announce(this.ctx.callbacks.t('hud.go'), 0x9cff6b, undefined, 1);
      }
      if (m.phase === 'ended') {
        const me = view.me;
        const won = me && (m.winner === me.id || (m.winnerTeam >= 0 && m.winnerTeam === me.team));
        audio.play(won ? 'win' : 'lose', 1, 0, 1, 'music');
        this.ctx.announce(this.ctx.callbacks.t(won ? 'hud.victory' : m.winner < 0 && m.winnerTeam < 0 ? 'hud.draw' : 'hud.defeat'), won ? 0xffd34d : 0xffffff, undefined, 4);
      }
      this.lastPhase = m.phase;
    }
    if (m.phase === 'countdown') {
      const s = Math.ceil(m.phaseT / TICK_RATE);
      if (s !== this.lastCountdown && s > 0) {
        this.lastCountdown = s;
        audio.play('countdown');
      }
    }
  }

  private updatePlayers(view: ClientView, dt: number, now: number): void {
    const ctx = this.ctx;
    const me = view.me;
    const seen = new Set<number>();
    const hc = ctx.settings().accessibility.highContrast;
    for (const p of view.players) {
      seen.add(p.id);
      let rig = this.rigs.get(p.id);
      const roster = ctx.client.roster.get(p.id);
      const look = roster?.look?.length ? roster.look.map((id) => cosmeticIdx(id)) : defaultLook(p.id);
      const teamColor = ctx.teamColor(p.team);
      if (!rig) {
        rig = new CharacterRig(this, look, p.team, teamColor);
        rig.setDepth(p.id === me?.id ? 44 : 40);
        this.rigs.set(p.id, rig);
      } else rig.setLook(look, p.team, teamColor);
      const visible = p.alive && !(p.eliminated && !p.alive);
      rig.setVisible(visible);
      if (!visible) {
        this.setJet(p.id, false, p);
        continue;
      }
      const aim = p.id === me?.id ? view.localAim : p.aim;
      rig.update(p, aim, dt, now);
      // Name tag, health bar, markers.
      const enemy = !!me && p.id !== me.id && (p.team < 0 || p.team !== me.team);
      const name = p.dummy ? ctx.callbacks.t('hud.dummy') : ctx.client.playerName(p.id);
      if (rig.label.text !== name) rig.label.setText(name);
      rig.label.setPosition(p.x, p.y - (p.crouch ? 44 : 56));
      rig.label.setColor(p.id === me?.id ? '#ffd34d' : p.team >= 0 ? hexStr(teamColor) : enemy && hc ? '#ff3b3b' : '#ffffff');
      rig.label.setVisible(p.id !== me?.id || ctx.settings().accessibility.highContrast);
      const g = rig.hpBar;
      g.clear();
      if (p.id !== me?.id && (p.hp < p.maxHp || hc)) {
        const w = 30;
        g.fillStyle(0x1b1d26, 0.8).fillRect(p.x - w / 2 - 1, p.y - (p.crouch ? 42 : 54), w + 2, 5);
        g.fillStyle(enemy ? 0xff5a4f : 0x7dff7a, 1).fillRect(p.x - w / 2, p.y - (p.crouch ? 41 : 53), (w * Math.max(0, p.hp)) / p.maxHp, 3);
      }
      if (hc && enemy) g.lineStyle(2, 0xff3b3b, 0.9).strokeRect(p.x - 13, p.y - (p.crouch ? 32 : 46), 26, p.crouch ? 32 : 46);
      // Team shape marker for colour-blind clarity: triangle (red) / circle (blue).
      if (p.team >= 0 && p.id !== me?.id) {
        g.fillStyle(teamColor, 1);
        if (p.team === 0) g.fillTriangle(p.x - 4, p.y - 66, p.x + 4, p.y - 66, p.x, p.y - 60);
        else g.fillCircle(p.x, p.y - 63, 3.5);
      }
      if (p.leader) rig.marker.setTexture('crown').setVisible(true).setPosition(p.x, p.y - 74);
      else if (p.bomb) rig.marker.setTexture('bomb').setVisible(true).setPosition(p.x, p.y - 76).setScale(0.9 + Math.sin(now * 0.02) * 0.1);
      else if (p.carrying >= 0) rig.marker.setTexture(`flag:${p.carrying}`).setVisible(true).setPosition(p.x - 6, p.y - 40).setScale(0.7);
      else if (p.emoteT > 0 && p.emote > 0) rig.marker.setTexture(`emote:${p.emote}`).setVisible(this.ensureEmote(p.emote)).setPosition(p.x, p.y - 80).setScale(1);
      else rig.marker.setVisible(false);
      // Jetpack audio + smoke.
      this.setJet(p.id, p.jetting, p);
      if (p.jetting && Math.random() < (this.ctx.settings().graphics.quality === 'low' ? 0.3 : 0.8)) {
        const fx = p.x + (rig.flipped ? 10 : -10);
        this.fx.jetSmoke(fx, p.y - (p.crouch ? 10 : 20), 0xffa53d);
      }
      if (p.flaming) this.flameStream(rig, p);
    }
    for (const [id, rig] of this.rigs) {
      if (!seen.has(id)) {
        rig.destroy();
        this.rigs.delete(id);
        this.setJet(id, false);
      }
    }
    // Low fuel warning (haptic) for the local player.
    if (me && me.alive) {
      if (me.fuel < 15 && me.jetting && !this.lowFuelWarned) {
        this.lowFuelWarned = true;
        if (ctx.settings().controls.haptics) ctx.callbacks.haptic('warning');
        audio.play('beep', 0.4);
      }
      if (me.fuel > 40) this.lowFuelWarned = false;
    }
  }

  private emoteKeys = new Set<number>();
  private ensureEmote(v: number): boolean {
    if (this.emoteKeys.has(v)) return true;
    const glyph = ['', '👋', '😂', 'GG', '😠', '❤', '😎'][v] ?? '!';
    const key = `emote:${v}`;
    if (!this.textures.exists(key)) {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#fff';
      g.strokeStyle = '#1b1d26';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(32, 28, 24, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.beginPath();
      g.moveTo(26, 50);
      g.lineTo(32, 62);
      g.lineTo(38, 50);
      g.fill();
      g.fillStyle = '#1b1d26';
      g.font = `bold ${glyph.length > 1 && /[A-Z]/.test(glyph) ? 20 : 26}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(glyph, 32, 29);
      this.textures.addCanvas(key, c);
    }
    this.emoteKeys.add(v);
    return true;
  }

  private flameStream(rig: CharacterRig, p: PlayerView): void {
    const a = rig.muzzle.angle;
    for (let i = 0; i < 2; i++) {
      const s = 420 + Math.random() * 160;
      const sp = (Math.random() - 0.5) * 0.25;
      this.fx.spawn('puff', rig.muzzle.x, rig.muzzle.y, {
        vx: Math.cos(a + sp) * s + p.vx * 0.5,
        vy: Math.sin(a + sp) * s + p.vy * 0.5,
        drag: 2,
        gravity: -150,
        life: 0.38,
        scale: 0.18,
        grow: 1.6,
        tint: i ? 0xff6a1f : 0xffd34d,
        add: true,
        depth: 56,
      });
    }
    if (Math.random() < 0.3) audio.play('flame', 0.5 * this.vol(p.x, p.y), this.pan(p.x));
    this.glows.push({ x: rig.muzzle.x, y: rig.muzzle.y, r: 140, t: 0.08 });
  }

  private setJet(id: number, on: boolean, p?: PlayerView): void {
    if (on && p) {
      if (!this.jetOn.has(id)) {
        this.jetOn.add(id);
        if (id === this.ctx.client.playerId) audio.play('jet_start', 0.5);
      }
      audio.jet(id, true, this.vol(p.x, p.y) * (id === this.ctx.client.playerId ? 1 : 0.6), this.pan(p.x));
    } else if (this.jetOn.has(id)) {
      this.jetOn.delete(id);
      audio.jet(id, false);
    }
  }

  private sprite(key: string, tex: string, depth: number): Phaser.GameObjects.Image {
    let s = this.sprites.get(key);
    if (!s) {
      s = this.add.image(0, 0, tex).setDepth(depth);
      this.sprites.set(key, s);
    } else if (s.texture.key !== tex) s.setTexture(tex);
    this.seenSprites.add(key);
    return s;
  }

  private updateEntities(view: ClientView, now: number): void {
    this.seenSprites.clear();
    for (const pr of view.projectiles) {
      const def = WEAPONS[pr.wi];
      const tex = def.id === 'buzzsaw' ? 'blade' : def.id === 'popper' ? 'shellgl' : 'rocket';
      const s = this.sprite(`p${pr.id}`, tex, 45).setScale(tex === 'rocket' ? 0.9 : 1);
      s.setPosition(pr.x, pr.y);
      if (tex === 'rocket') {
        s.setRotation(Math.atan2(pr.vy, pr.vx));
        if (Math.random() < 0.7) this.fx.spawn('puff', pr.x - Math.cos(s.rotation) * 10, pr.y - Math.sin(s.rotation) * 10, { life: 0.5, scale: 0.18, grow: 0.7, tint: 0xd8dce4, alpha: 0.6, depth: 44, drag: 3 });
        this.glows.push({ x: pr.x, y: pr.y, r: 90, t: 0.02 });
      } else s.rotation += 0.4;
    }
    for (const g of view.grenades) {
      const s = this.sprite(`g${g.id}`, `grenade:${g.kind}`, 46).setScale(0.9);
      s.setPosition(g.x, g.y);
      if (g.stuck === -1) s.rotation += 0.15;
      const def = GRENADES[g.kind];
      if (def.id === 'mine' && g.armed) s.setTint(Math.floor(now / 250) % 2 ? 0xff6060 : 0xffffff);
      else if (g.fuse < 40 && Math.floor(now / 100) % 2) s.setTint(0xff8080);
      else s.clearTint();
    }
    for (const c of view.clouds) {
      if (Math.random() < 0.25) this.fx.cloud(c.x, c.y, c.r, GRENADES[c.kind].id === 'gas' ? 0xa6e04a : 0xd8dce4);
    }
    for (const d of view.dropped) {
      const s = this.sprite(`d${d.id}`, weaponIcon(this, d.wi), 21).setScale(0.55);
      s.setPosition(d.x, d.y - 6).setRotation(0.15);
    }
    let i = 0;
    const objs = this.map.objects.filter((o) => o.kind === 'weapon' || o.kind === 'heavy' || o.kind === 'health' || o.kind === 'grenade' || o.kind === 'dual');
    for (const sp of view.spawners) {
      const o = objs[i];
      if (!o) break;
      const ped = this.sprite(`ped${i}`, 'pedestal', 19).setScale(0.8);
      ped.setPosition(o.x, o.y - 4).setAlpha(sp.available ? 1 : 0.45);
      const key = `pk${i}`;
      if (sp.available) {
        const tex = o.kind === 'health' ? 'medkit' : o.kind === 'grenade' ? `grenade:${Math.max(0, sp.item)}` : o.kind === 'dual' ? 'dual' : sp.item >= 0 ? weaponIcon(this, sp.item) : 'crate';
        const s = this.sprite(key, tex, 20);
        const bob = Math.sin(now * 0.004 + i) * 3;
        s.setPosition(o.x, o.y - 22 + bob).setScale(o.kind === 'grenade' ? 1.4 : o.kind === 'weapon' || o.kind === 'heavy' ? 0.62 : 0.85);
        if (o.kind === 'heavy') {
          const glow = this.sprite(`pkg${i}`, 'dot', 18);
          glow.setPosition(o.x, o.y - 22).setScale(2.4).setTint(0xff8a3d).setAlpha(0.35 + Math.sin(now * 0.006) * 0.15).setBlendMode(Phaser.BlendModes.ADD);
        }
      }
      i++;
    }
    for (const [key, s] of this.sprites) {
      if (!this.seenSprites.has(key)) {
        s.destroy();
        this.sprites.delete(key);
      }
    }
  }

  private moverOff = { x: 0, y: 0 };
  private updateMovers(view: ClientView): void {
    const tick = this.ctx.client.predictedTick || view.tick;
    this.map.movers.forEach((m, i) => {
      const ts = this.movers[i];
      if (m.kind === 'platform') {
        this.world.platformOffset(m, Math.floor(tick), this.moverOff);
        ts.setPosition(m.x + this.moverOff.x, m.y + this.moverOff.y);
      } else {
        const c = this.world.moverClosedness(m, tick);
        if (m.kind === 'door') {
          ts.setAlpha(0.15 + c * 0.85);
          ts.setScale(1, Math.max(0.05, c));
        } else {
          ts.setAlpha(c >= 1 ? 1 : c > 0 ? 0.6 + Math.sin(tick * 0.8) * 0.3 : 0.08);
          ts.y = m.y + (c === 0 ? 18 : 0);
        }
      }
    });
  }

  private updateZoneAndFlags(view: ClientView, now: number): void {
    const g = this.zoneGfx;
    g.clear();
    const m = view.mode;
    const mode = this.ctx.client.start?.config.mode;
    if (mode === 'koth') {
      const z = m.zone;
      const col = z.owner === 0 || z.owner === 1 ? this.ctx.teamColor(z.owner) : z.owner === 2 ? 0xffffff : 0xffd34d;
      g.fillStyle(col, 0.12 + Math.sin(now * 0.005) * 0.05).fillRect(z.x, z.y, z.w, z.h);
      g.lineStyle(4, col, 0.9).strokeRect(z.x, z.y, z.w, z.h);
    }
    for (const f of m.flags) {
      const s = this.sprite(`flag${f.team}`, `flag:${f.team}`, 22);
      if (f.state === 1) {
        s.setVisible(false);
        continue;
      }
      s.setVisible(true).setOrigin(0.15, 1).setPosition(f.x, f.y).setScale(0.9).setRotation(Math.sin(now * 0.004) * 0.05);
      if (f.state === 0) {
        g.fillStyle(this.ctx.teamColor(f.team), 0.25).fillEllipse(f.x, f.y - 2, 64, 12);
      }
    }
    if (mode !== 'koth') return;
  }

  private updateCamera(view: ClientView, dt: number): void {
    const cam = this.cameras.main;
    const me = view.me;
    const s = this.ctx.settings();
    const baseVisible = this.ctx.isTouch ? 600 : 720;
    let target = cam.height / baseVisible;
    let fx = this.camX;
    let fy = this.camY;
    if (me) {
      const def = me.alive ? WEAPONS[me.slots[me.active].wi] : undefined;
      if (me.alive && me.zoom && def && def.zoom < 1) target *= def.zoom;
      const a = angleToRad(view.localAim);
      const look = me.alive ? Math.min(cam.width, cam.height) / this.zoom * (me.zoom ? 0.32 : 0.16) : 0;
      fx = me.x + Math.cos(a) * look;
      fy = me.y - 30 + Math.sin(a) * look;
    }
    this.zoom += (target - this.zoom) * Math.min(1, dt * 6);
    cam.setZoom(this.zoom);
    if (this.camX === 0 && this.camY === 0) {
      this.camX = fx;
      this.camY = fy;
    }
    const k = Math.min(1, dt * 8);
    this.camX += (fx - this.camX) * k;
    this.camY += (fy - this.camY) * k;
    let sx = 0;
    let sy = 0;
    if (this.shakeT > 0 && s.graphics.shake && !s.accessibility.reduceMotion) {
      this.shakeT -= dt;
      const amp = this.shakeAmp * Math.max(0, this.shakeT * 3);
      sx = (Math.random() - 0.5) * amp;
      sy = (Math.random() - 0.5) * amp;
    }
    cam.centerOn(this.camX + sx, this.camY + sy);
    // Mouse aim target in world space.
    const ptr = this.input.activePointer;
    if (this.ctx.controls.device === 'keyboard') {
      const wp = cam.getWorldPoint(ptr.x, ptr.y);
      this.ctx.controls.mouseWorld = { x: wp.x, y: wp.y };
    }
  }

  private updateReticle(view: ClientView, dt: number): void {
    const me = view.me;
    const c = this.ctx.controls;
    if (!me || !me.alive) {
      this.reticle.setVisible(false);
      this.arcGfx.clear();
      return;
    }
    const a = angleToRad(view.localAim);
    const def = WEAPONS[me.slots[me.active].wi];
    let rx: number;
    let ry: number;
    if (c.device === 'keyboard' && c.mouseWorld) {
      rx = c.mouseWorld.x;
      ry = c.mouseWorld.y;
    } else {
      const dist = Math.min(def ? def.range * 0.5 : 200, me.zoom ? 420 : 170);
      rx = me.x + Math.cos(a) * dist;
      ry = me.y - 28 + Math.sin(a) * dist;
    }
    this.reticle.setVisible(true).setPosition(rx, ry).setScale(0.55 / Math.max(0.6, this.zoom) * 1.3);
    if (me.reloadT > 0) this.reticle.setAlpha(0.4).setRotation(this.reticle.rotation + dt * 6);
    else this.reticle.setAlpha(0.9).setRotation(0);
    const hm = this.ctx.hitMarker;
    if (hm > 0) {
      this.ctx.hitMarker = Math.max(0, hm - dt);
      this.hitmark.setVisible(true).setPosition(rx, ry).setTint(this.ctx.hitHead ? 0xffd34d : 0xffffff).setAlpha(Math.min(1, hm * 6)).setScale(this.reticle.scaleX * 1.3);
    } else this.hitmark.setVisible(false);
    // Grenade arc preview while charging (desktop/gamepad hold or touch drag).
    this.arcGfx.clear();
    let power = -1;
    let aim = a;
    const td = c.touch.grenadeDrag;
    if (td.active) {
      const len = Math.hypot(td.x, td.y);
      power = Math.min(1, len / 1);
      if (len > 0.15) aim = Math.atan2(td.y, td.x);
    } else if (c.charge >= 0) power = c.charge;
    if (power >= 0 && me.grenades.length) {
      const speed = 220 + (820 - 220) * power;
      let x = me.x;
      let y = me.y - 28;
      let vx = Math.cos(aim) * speed + me.vx * 0.3;
      let vy = Math.sin(aim) * speed + me.vy * 0.3;
      for (let i = 0; i < 26; i++) {
        for (let k = 0; k < 4; k++) {
          vy += 1500 * 0.9 * (1 / 60);
          x += vx / 60;
          y += vy / 60;
        }
        if (this.world.solidAtPoint(x, y, view.tick)) break;
        this.arcGfx.fillStyle(0xffffff, 0.9 - i * 0.03).fillCircle(x, y, 3);
      }
      void vx;
    }
  }

  private updateParallax(now: number): void {
    const cam = this.cameras.main;
    const factors = [0.12, 0.25, 0.42];
    const q = this.ctx.settings().graphics.quality;
    this.bgLayers.forEach((l, i) => {
      l.setVisible(!(q === 'low' && i === 2));
      l.tilePositionX = cam.scrollX * factors[i] + (this.map.theme.backdrop === 'space' && i === 0 ? now * 0.004 : 0);
      const camCenterFrac = (cam.scrollY + cam.height / 2 / cam.zoom) / this.world.pxH;
      l.y = cam.height * (0.86 + i * 0.07) + (0.5 - camCenterFrac) * 220 * (i + 1) * 0.6;
    });
    for (const l of this.liquids) {
      if (l.kind === 'lava') {
        l.img.setFillStyle(0xff6a1f, 0.85 + Math.sin(now * 0.003 + l.y) * 0.08);
        if (l.surf) l.surf.setAlpha(0.7 + Math.sin(now * 0.008 + l.y) * 0.3);
        if (Math.random() < 0.02) this.fx.spawn('dot', l.img.x + Math.random() * l.img.width, l.y, { vy: -80, gravity: 200, life: 0.6, scale: 0.3, tint: 0xffd34d, add: true });
      } else if (l.surf) l.surf.setAlpha(0.55 + Math.sin(now * 0.004 + l.img.x) * 0.25);
    }
  }

  private updateWeather(dt: number): void {
    const w = this.scale.width;
    const h = this.scale.height;
    for (const f of this.weather) {
      f.x += f.vx * dt + (this.map.theme.weather === 'snow' ? Math.sin(f.y * 0.02) * 20 * dt : 0);
      f.y += f.vy * dt;
      if (f.x < -10) f.x += w + 20;
      if (f.x > w + 10) f.x -= w + 20;
      if (f.y < -10) f.y += h + 20;
      if (f.y > h + 10) f.y -= h + 20;
      f.img.setPosition(f.x, f.y);
    }
  }

  private ventParticles(): void {
    const cam = this.cameras.main;
    const view = cam.worldView;
    const w = this.map.width;
    const tx0 = Math.max(0, Math.floor(view.x / TILE));
    const tx1 = Math.min(w - 1, Math.ceil((view.x + view.width) / TILE));
    const ty0 = Math.max(0, Math.floor(view.y / TILE));
    const ty1 = Math.min(this.map.height - 1, Math.ceil((view.y + view.height) / TILE));
    let n = 0;
    for (let ty = ty0; ty <= ty1 && n < 6; ty++)
      for (let tx = tx0; tx <= tx1 && n < 6; tx++) {
        if (this.map.tiles[ty * w + tx] !== 7 || this.map.tiles[(ty + 1) * w + tx] === 7) continue;
        if (Math.random() > 0.5) continue;
        n++;
        this.fx.spawn('dot', tx * TILE + Math.random() * TILE, (ty + 1) * TILE, { vy: -260 - Math.random() * 120, life: 0.7, scale: 0.35, grow: -0.4, tint: 0xff9a3d, add: true, alpha: 0.6, depth: 13 });
      }
  }

  private updateDarkness(view: ClientView, _now: number): void {
    const tex = this.dark!;
    const g = tex.getContext();
    const cam = this.cameras.main;
    const w = tex.width;
    const h = tex.height;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(8,6,20,0.84)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out';
    const toScreen = (x: number, y: number) => [((x - cam.worldView.x) * cam.zoom) / 4, ((y - cam.worldView.y) * cam.zoom) / 4] as const;
    const hole = (x: number, y: number, r: number, a: number) => {
      const [sx, sy] = toScreen(x, y);
      const rr = (r * cam.zoom) / 4;
      if (sx < -rr || sy < -rr || sx > w + rr || sy > h + rr) return;
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, rr);
      grad.addColorStop(0, `rgba(0,0,0,${a})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    };
    const me = view.me;
    if (me && me.alive) hole(me.x, me.y - 24, 260, 1);
    for (const p of view.players) {
      if (p.id === me?.id || !p.alive) continue;
      if (p.jetting) hole(p.x, p.y - 10, 90, 0.8);
      else hole(p.x, p.y - 24, 34, 0.5);
    }
    for (const o of this.map.objects) if (o.kind === 'spawn' || o.kind === 'health') hole(o.x, o.y - 20, 70, 0.55);
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const l = this.glows[i];
      hole(l.x, l.y, l.r, 1);
      l.t -= 1 / 60;
      if (l.t <= 0) this.glows.splice(i, 1);
    }
    tex.refresh();
  }

  // ------------------------------------------------------------------ audio helpers

  private vol(x: number, y: number): number {
    const cam = this.cameras.main;
    const cx = cam.worldView.centerX;
    const cy = cam.worldView.centerY;
    const d = Math.hypot(x - cx, y - cy);
    return Math.max(0, 1 - d / 1600);
  }

  private pan(x: number): number {
    const cam = this.cameras.main;
    return Math.max(-0.8, Math.min(0.8, (x - cam.worldView.centerX) / (cam.worldView.width / 2 || 1)));
  }

  shake(amp: number, t = 0.3): void {
    this.shakeAmp = Math.max(this.shakeAmp * (this.shakeT > 0 ? 1 : 0), amp);
    this.shakeT = Math.max(this.shakeT, t);
  }

  // ------------------------------------------------------------------ events

  private handleLocalShots(view: ClientView): void {
    const me = view.me;
    const rig = me ? this.rigs.get(me.id) : undefined;
    for (const s of this.ctx.client.takeLocalShots()) {
      this.ctx.localShots++;
      const def = WEAPONS[s.wi];
      const mx = rig ? rig.muzzle.x : s.x0;
      const my = rig ? rig.muzzle.y : s.y0;
      this.fx.muzzle(mx, my, Math.atan2(s.y1 - s.y0, s.x1 - s.x0), def.tracer, def.sound !== 'light');
      if (!s.projectile) this.fx.tracer(mx, my, s.x1, s.y1, def.tracer, def.kind === 'rail' ? 5 : def.sound === 'sniper' ? 3 : 2, def.kind === 'rail' ? 0.25 : 0.07);
      if (!s.projectile && def.pellets > 1) {
        for (let i = 1; i < def.pellets; i++) {
          const a = Math.atan2(s.y1 - s.y0, s.x1 - s.x0) + (Math.random() - 0.5) * def.spread * 2;
          const len = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * (0.85 + Math.random() * 0.15);
          this.fx.tracer(mx, my, mx + Math.cos(a) * len, my + Math.sin(a) * len, def.tracer, 1.5, 0.06);
        }
      }
      audio.play(SHOT_SFX[def.sound], 0.9);
      if (rig) {
        rig.recoil = def.sound === 'light' ? 2 : 4;
        if (def.kind === 'hitscan' && Math.random() < 0.7) this.fx.shell(mx, my, rig.flipped ? -1 : 1);
      }
      this.glows.push({ x: mx, y: my, r: 200, t: 0.06 });
      if (this.ctx.settings().controls.haptics && def.sound !== 'light') this.ctx.callbacks.haptic('light');
      this.shake(def.sound === 'heavy' || def.sound === 'shotgun' || def.sound === 'sniper' ? 3 : 1.5, 0.08);
    }
  }

  private handleEvents(events: SimEvent[], view: ClientView): void {
    const ctx = this.ctx;
    const meId = ctx.client.playerId;
    const t = ctx.callbacks.t;
    const settings = ctx.settings();
    for (const e of events) {
      const d = e.d;
      switch (e.type) {
        case EventType.Shot: {
          const [pid, wi, x0, y0, x1, y1, hit] = d;
          ctx.recentFire.set(pid, performance.now());
          if (pid === meId) break; // already predicted locally
          const def = WEAPONS[wi];
          const rig = this.rigs.get(pid);
          const mx = rig ? rig.muzzle.x : x0;
          const my = rig ? rig.muzzle.y : y0;
          const v = this.vol(x0, y0);
          if (v > 0.02) {
            this.fx.muzzle(mx, my, Math.atan2(y1 - y0, x1 - x0), def.tracer, def.sound !== 'light');
            if (def.kind === 'hitscan' || def.kind === 'rail') this.fx.tracer(mx, my, x1, y1, def.tracer, def.kind === 'rail' ? 5 : 2, def.kind === 'rail' ? 0.25 : 0.07);
            if (hit === 2) this.fx.sparks(x1, y1, 0xffe0a0, 3);
            if (rig) rig.recoil = 3;
            this.glows.push({ x: mx, y: my, r: 180, t: 0.05 });
          }
          audio.play(SHOT_SFX[def.sound], 0.75 * v, this.pan(x0));
          if (v > 0 && v < 0.5 && def.sound !== 'light') ctx.caption(t('caption.gunfire'));
          break;
        }
        case EventType.Explode: {
          const [x, y, r, kind] = d;
          const v = this.vol(x, y);
          if (kind >= 10) {
            for (let i = 0; i < 8; i++) this.fx.cloud(x, y, r * 0.7, kind === 13 ? 0xd8dce4 : 0xa6e04a);
            audio.play('throw', v * 0.6, this.pan(x), 0.6);
            break;
          }
          this.fx.explosion(x, y, r, kind === 9 ? 0xff3f6f : 0xff8a3d, settings.graphics.quality);
          audio.play(r > 100 ? 'explosion' : 'explosion_small', Math.max(0.15, v), this.pan(x));
          this.glows.push({ x, y, r: r * 3, t: 0.25 });
          const me = view.me;
          if (me) {
            const dist = Math.hypot(me.x - x, me.y - y);
            if (dist < 900) this.shake(Math.max(2, 14 * (1 - dist / 900)), 0.35);
            if (dist < 300 && settings.controls.haptics) ctx.callbacks.haptic('heavy');
          }
          if (v < 0.6) ctx.caption(t('caption.explosion'));
          break;
        }
        case EventType.Hit: {
          const [victim, attacker, dmg, head, x, y] = d;
          this.fx.sparks(x, y, head ? 0xffd34d : 0xff9a8a, head ? 6 : 3);
          if (attacker === meId && victim !== meId) {
            ctx.hitMarker = 0.18;
            ctx.hitHead = !!head;
            audio.play(head ? 'hit_head' : 'hit', 0.7);
            if (settings.graphics.damageNumbers) this.fx.damageNumber(x, y - 20, dmg, !!head, true);
          }
          if (victim === meId) {
            audio.play('hurt', 0.8);
            ctx.hurtFlash = settings.graphics.reduceFlashes ? 0.15 : 0.35;
            const src = view.players.find((p) => p.id === attacker);
            const me = view.me;
            if (src && me && attacker !== meId) ctx.damageDirs.push({ angle: Math.atan2(src.y - me.y, src.x - me.x), t: 1 });
            if (settings.controls.haptics) ctx.callbacks.haptic('medium');
          }
          break;
        }
        case EventType.Kill: {
          const [victim, killer, code, head] = d;
          ctx.killfeed.push({ killer, victim, code, head: !!head, t: performance.now() });
          if (ctx.killfeed.length > 6) ctx.killfeed.shift();
          const rig = this.rigs.get(victim);
          const vp = view.players.find((p) => p.id === victim);
          if (rig && vp) {
            this.fx.ragdoll(rig.parts(), vp.vx, vp.vy);
            this.fx.confetti(vp.x, vp.y - 24, [0xffd34d, 0xff5a4f, 0x3fa2ff, 0x9cff6b, 0xff7ab8]);
          }
          if (killer === meId && victim !== meId) {
            audio.play('kill', 0.9);
            if (settings.controls.haptics) ctx.callbacks.haptic('success');
            const name = ctx.client.playerName(victim);
            ctx.announce(t('hud.youTookDown', { name }), 0xffd34d, undefined, 1.4);
          }
          if (victim === meId) {
            audio.play('death', 0.9);
            ctx.lastDeath = { killer, code, t: performance.now() };
            if (settings.controls.haptics) ctx.callbacks.haptic('heavy');
          }
          break;
        }
        case EventType.Pickup: {
          const [pid, kind, item] = d;
          if (pid !== meId) break;
          audio.play(kind === 2 ? 'health' : 'pickup', 0.8);
          if (kind === 1) ctx.announce(t('hud.picked', { name: WEAPONS[item]?.name ?? '' }), 0xffffff, undefined, 1);
          if (kind === 3) ctx.announce(t('hud.grenades'), 0xffffff, undefined, 1);
          if (kind === 4) ctx.announce(t('hud.dual'), 0xffd34d, undefined, 1.4);
          break;
        }
        case EventType.Throw: {
          const p = view.players.find((x) => x.id === d[0]);
          if (p) audio.play('throw', this.vol(p.x, p.y), this.pan(p.x));
          if (p && p.id !== meId && this.vol(p.x, p.y) > 0) ctx.caption(t('caption.grenade'));
          break;
        }
        case EventType.Melee: {
          const p = view.players.find((x) => x.id === d[0]);
          if (p) audio.play('melee', this.vol(p.x, p.y), this.pan(p.x));
          break;
        }
        case EventType.Reload:
          if (d[0] === meId) audio.play('reload', 0.8);
          break;
        case EventType.Deny:
          if (d[0] === meId) audio.play('empty', 0.6);
          break;
        case EventType.Bounce: {
          const v = this.vol(d[0], d[1]);
          if (v > 0) audio.play('bounce', v * 0.5, this.pan(d[0]));
          break;
        }
        case EventType.Flag: {
          const [team, action, pid] = d;
          const who = pid >= 0 ? ctx.client.playerName(pid) : '';
          const key = action === 1 ? 'hud.flagTaken' : action === 2 ? 'hud.flagDropped' : action === 3 ? 'hud.flagReturned' : 'hud.flagCaptured';
          ctx.announce(t(key, { team: t(team === 0 ? 'team.red' : 'team.blue'), name: who }), ctx.teamColor(team), undefined, 2);
          audio.play(action === 4 ? 'score' : 'flag', 0.9);
          break;
        }
        case EventType.Zone:
          ctx.announce(t('hud.zoneMoved'), 0xffd34d, undefined, 1.6);
          audio.play('beep', 0.7);
          break;
        case EventType.Bomb: {
          const [holder] = d;
          if (holder === meId) {
            ctx.announce(t('hud.youHaveBomb'), 0xff5a4f, t('hud.passIt'), 1.6);
            if (settings.controls.haptics) ctx.callbacks.haptic('warning');
          } else ctx.announce(t('hud.bombPassed', { name: ctx.client.playerName(holder) }), 0xffffff, undefined, 1.2);
          audio.play('beep', 0.8);
          break;
        }
        case EventType.Wave: {
          const [n, total] = d;
          if (total > 0) ctx.announce(t('hud.wave', { n }), 0xffd34d, t('hud.waveSub', { n: total }), 2.5);
          else ctx.announce(t('hud.waveCleared', { n }), 0x9cff6b, t('hud.pickUpgrade'), 2.5);
          audio.play('wave', 1, 0, 1, 'music');
          break;
        }
        case EventType.Chat: {
          const [pid, idx] = d;
          const name = ctx.client.playerName(pid);
          ctx.chat.push({ id: pid, text: `${name}: ${t(['chat.hello', 'chat.gg', 'chat.nice', 'chat.help', 'chat.follow', 'chat.defend', 'chat.attack', 'chat.oops'][idx] ?? 'chat.hello')}`, t: performance.now() });
          if (ctx.chat.length > 4) ctx.chat.shift();
          audio.play('ui_hover', 0.6);
          break;
        }
        case EventType.Spawn: {
          const [, x, y] = d;
          this.fx.spawn('ring', x, y - 20, { life: 0.4, scale: 0.1, grow: 2, tint: 0x9ff3ff, add: true, alpha: 0.7 });
          break;
        }
        case EventType.Checkpoint:
          if (d[0] === meId) {
            audio.play('pickup', 0.7, 0, 1.2);
            ctx.courseCheckpoint = d[1];
          }
          break;
        case EventType.Course:
          if (d[0] === meId) {
            ctx.courseTime = d[1];
            ctx.courseBest = ctx.courseBest ? Math.min(ctx.courseBest, d[1]) : d[1];
            ctx.announce(t('hud.courseTime', { s: (d[1] / TICK_RATE).toFixed(2) }), 0x9cff6b, undefined, 3);
            audio.play('score');
          }
          break;
        case EventType.Upgrade:
          if (d[0] === meId) audio.play('level_up', 0.8);
          break;
      }
    }
  }
}

function hexStr(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function cosmeticIdx(id: string): number {
  const i = COSMETICS.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}

/** Deterministic varied looks for bots / players without roster data yet. */
function defaultLook(id: number): number[] {
  const by = (cat: string) => COSMETICS.map((c, i) => [c, i] as const).filter(([c]) => c.category === cat);
  const pick = (cat: string, k: number) => {
    const l = by(cat);
    return l[(id * 7 + k) % l.length][1];
  };
  return [pick('head', 1), pick('outfit', 3), pick('jetpack', 5), pick('skin', 2), pick('emote', 0), pick('pose', 0)];
}
