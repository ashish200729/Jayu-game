import Phaser from 'phaser';
import type { World } from '@game/sim';

interface Particle {
  img: Phaser.GameObjects.Image;
  vx: number;
  vy: number;
  life: number;
  max: number;
  gravity: number;
  drag: number;
  spin: number;
  grow: number;
  fade: boolean;
  bounce: boolean;
  startScale: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: number;
  life: number;
  max: number;
  width: number;
}

interface Floater {
  text: Phaser.GameObjects.Text;
  vy: number;
  life: number;
}

/**
 * Pooled effects: particles, tracers, damage numbers, cartoon ragdoll parts.
 * No allocations per frame once the pools are warm.
 */
export class Fx {
  private pool: Particle[] = [];
  private active: Particle[] = [];
  private tracers: Tracer[] = [];
  private gfx: Phaser.GameObjects.Graphics;
  private floaters: Floater[] = [];
  private floaterPool: Phaser.GameObjects.Text[] = [];
  budget = 600;
  world: World | null = null;

  constructor(private scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(55).setBlendMode(Phaser.BlendModes.ADD);
  }

  setQuality(q: 'low' | 'medium' | 'high'): void {
    this.budget = q === 'low' ? 220 : q === 'medium' ? 450 : 800;
  }

  private get(): Particle | null {
    if (this.active.length >= this.budget) return null;
    let p = this.pool.pop();
    if (!p) {
      const img = this.scene.add.image(0, 0, 'px');
      p = { img, vx: 0, vy: 0, life: 0, max: 1, gravity: 0, drag: 0, spin: 0, grow: 0, fade: true, bounce: false, startScale: 1 };
    }
    p.img.setVisible(true).setActive(true);
    this.active.push(p);
    return p;
  }

  spawn(
    key: string,
    x: number,
    y: number,
    o: {
      vx?: number;
      vy?: number;
      life?: number;
      gravity?: number;
      drag?: number;
      scale?: number;
      grow?: number;
      tint?: number;
      alpha?: number;
      add?: boolean;
      spin?: number;
      rotation?: number;
      depth?: number;
      fade?: boolean;
      bounce?: boolean;
      originX?: number;
      originY?: number;
    } = {},
  ): Particle | null {
    const p = this.get();
    if (!p) return null;
    const img = p.img;
    img.setTexture(key).setPosition(x, y).setScale(o.scale ?? 1).setAlpha(o.alpha ?? 1).setRotation(o.rotation ?? 0).setDepth(o.depth ?? 50);
    img.setOrigin(o.originX ?? 0.5, o.originY ?? 0.5);
    img.setBlendMode(o.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (o.tint !== undefined) img.setTint(o.tint);
    else img.clearTint();
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.life = p.max = o.life ?? 0.5;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.spin = o.spin ?? 0;
    p.grow = o.grow ?? 0;
    p.fade = o.fade ?? true;
    p.bounce = o.bounce ?? false;
    p.startScale = o.scale ?? 1;
    return p;
  }

  tracer(x0: number, y0: number, x1: number, y1: number, color: number, width = 2.5, life = 0.08): void {
    if (this.tracers.length > 120) this.tracers.shift();
    this.tracers.push({ x0, y0, x1, y1, color, life, max: life, width });
  }

  damageNumber(x: number, y: number, amount: number, head: boolean, mine: boolean): void {
    let text = this.floaterPool.pop();
    if (!text) {
      text = this.scene.add
        .text(0, 0, '', { fontFamily: 'Baloo 2, system-ui, sans-serif', fontSize: '16px', fontStyle: '800', color: '#fff', stroke: '#1b1d26', strokeThickness: 4 })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(70);
    }
    text.setText(String(amount)).setPosition(x + (Math.random() - 0.5) * 16, y).setVisible(true).setAlpha(1);
    text.setColor(head ? '#ffd34d' : mine ? '#ffffff' : '#ff9a8a').setScale(head ? 1.25 : 1);
    this.floaters.push({ text, vy: -70, life: 0.8 });
  }

  muzzle(x: number, y: number, angle: number, color: number, big: boolean): void {
    this.spawn('flash', x, y, { rotation: angle, life: 0.05, scale: big ? 0.9 : 0.6, tint: color, add: true, fade: true, originX: 0.15 });
    this.spawn('dot', x, y, { life: 0.08, scale: big ? 2.2 : 1.4, tint: 0xffe6a0, add: true, alpha: 0.6 });
  }

  shell(x: number, y: number, facing: number): void {
    this.spawn('shell', x, y, { vx: -facing * (60 + Math.random() * 60), vy: -140 - Math.random() * 80, gravity: 900, life: 0.9, spin: 18 * -facing, bounce: true, depth: 45 });
  }

  sparks(x: number, y: number, color = 0xffd27a, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 220;
      this.spawn('spark', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.25 + Math.random() * 0.15, gravity: 600, tint: color, add: true, rotation: a, scale: 0.7 });
    }
  }

  explosion(x: number, y: number, r: number, color = 0xff8a3d, quality: 'low' | 'medium' | 'high' = 'high'): void {
    this.spawn('dot', x, y, { life: 0.18, scale: r / 7, tint: 0xfff2c0, add: true, alpha: 0.95 });
    this.spawn('ring', x, y, { life: 0.35, scale: 0.15, grow: (r / 64) * 3.2, tint: 0xffffff, add: true, alpha: 0.8 });
    const n = quality === 'low' ? 6 : quality === 'medium' ? 12 : 20;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * r * 2.2;
      this.spawn('puff', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, drag: 2.5, life: 0.5 + Math.random() * 0.5, scale: 0.4 + Math.random() * 0.5, grow: 0.8, tint: i < n / 2 ? color : 0x6b6f7a, add: i < n / 2, alpha: 0.85 });
    }
    for (let i = 0; i < n / 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 200 + Math.random() * 300;
      this.spawn('px', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s - 100, gravity: 900, life: 0.8, scale: 1.2 + Math.random(), tint: 0x3a3f48, bounce: true });
    }
  }

  cloud(x: number, y: number, r: number, color: number): void {
    for (let i = 0; i < 3; i++) {
      this.spawn('puff', x + (Math.random() - 0.5) * r * 1.4, y + (Math.random() - 0.5) * r, { vx: (Math.random() - 0.5) * 20, vy: -8, life: 1.6, scale: r / 40, grow: 0.15, tint: color, alpha: 0.35, depth: 58 });
    }
  }

  confetti(x: number, y: number, colors: number[]): void {
    for (let i = 0; i < 26; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 180 + Math.random() * 260;
      this.spawn('confetti', x, y, { vx: Math.cos(a) * s, vy: Math.sin(a) * s, gravity: 500, drag: 1.2, life: 1.2 + Math.random() * 0.6, spin: (Math.random() - 0.5) * 20, tint: colors[i % colors.length], depth: 52 });
    }
  }

  ragdoll(parts: { key: string; x: number; y: number; origin: [number, number] }[], vx: number, vy: number): void {
    for (const part of parts) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 180;
      this.spawn(part.key, part.x, part.y, {
        vx: vx * 0.5 + Math.cos(a) * s,
        vy: vy * 0.5 + Math.sin(a) * s - 220,
        gravity: 1200,
        life: 2.2,
        scale: 0.5,
        spin: (Math.random() - 0.5) * 16,
        bounce: true,
        depth: 41,
        originX: part.origin[0],
        originY: part.origin[1],
      });
    }
  }

  jetSmoke(x: number, y: number, color: number): void {
    this.spawn('dot', x, y, { vx: (Math.random() - 0.5) * 30, vy: 140 + Math.random() * 60, life: 0.22, scale: 0.6, grow: -1.5, tint: color, add: true, depth: 39 });
    if (Math.random() < 0.4) this.spawn('puff', x, y + 6, { vx: (Math.random() - 0.5) * 20, vy: 60, drag: 2, life: 0.6, scale: 0.25, grow: 0.9, tint: 0x9aa0aa, alpha: 0.35, depth: 38 });
  }

  update(dt: number): void {
    const w = this.world;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.img.setVisible(false).setActive(false);
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
        this.pool.push(p);
        continue;
      }
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      let nx = p.img.x + p.vx * dt;
      let ny = p.img.y + p.vy * dt;
      if (p.bounce && w) {
        if (w.solidAtPoint(nx, p.img.y, 0)) {
          p.vx *= -0.4;
          nx = p.img.x;
        }
        if (w.solidAtPoint(p.img.x, ny, 0)) {
          p.vy *= -0.35;
          p.vx *= 0.7;
          p.spin *= 0.6;
          ny = p.img.y;
        }
      }
      p.img.setPosition(nx, ny);
      if (p.spin) p.img.rotation += p.spin * dt;
      const t = p.life / p.max;
      if (p.grow) p.img.setScale(Math.max(0.01, p.img.scaleX + p.grow * dt * p.startScale * 2));
      if (p.fade) p.img.setAlpha(Math.min(p.img.alpha, Math.max(0, t * 1.4)));
    }
    this.gfx.clear();
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.tracers.splice(i, 1);
        continue;
      }
      const a = t.life / t.max;
      this.gfx.lineStyle(t.width, t.color, a);
      this.gfx.lineBetween(t.x0, t.y0, t.x1, t.y1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.text.y += f.vy * dt;
      f.vy *= 0.94;
      f.text.setAlpha(Math.min(1, f.life * 2.5));
      if (f.life <= 0) {
        f.text.setVisible(false);
        this.floaterPool.push(f.text);
        this.floaters.splice(i, 1);
      }
    }
  }

  get count(): number {
    return this.active.length;
  }
}
