import type Phaser from 'phaser';
import { COSMETICS, WEAPONS } from '@game/content';
import { CHAR_SCALE as S, block, canvas, hex, lineOf, mix, paint, roundRect, shade, tint } from './draw';

export { CHAR_SCALE } from './draw';

/**
 * Character parts and guns. Every part keeps a fixed footprint + anchor (documented per function)
 * so the rig, menus and ragdoll compose them without knowing how they are drawn.
 * Drawn facing right, lit from the upper left, at CHAR_SCALE for crisp zoomed rendering.
 */

const SKIN = 0xf2c79b;
const GLOVE = 0x2c313d;
const STRAP = 0x2a2f3a;
const METAL = 0x9aa3b0;
const GOLD = 0xffc93d;

function ensure(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  if (scene.textures.exists(key)) return key;
  const [c, ctx] = canvas(w * S, h * S);
  ctx.scale(S, S);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx);
  scene.textures.addCanvas(key, c);
  return key;
}

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, a = 0.8): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hex(tint(color, 0.6), a));
  g.addColorStop(0.4, hex(color, a * 0.6));
  g.addColorStop(1, hex(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ------------------------------------------------------------------ head

function face(ctx: CanvasRenderingContext2D, skin: number, covered: boolean): void {
  const line = lineOf(skin);
  // Ear (back of the head when facing right).
  ellipse(ctx, 9.6, 17.4, 2.3, 2.9);
  paint(ctx, shade(skin, 0.95), 14.5, 20.3, { line: 1.1 });
  ellipse(ctx, 9.8, 17.5, 0.9, 1.5);
  ctx.fillStyle = hex(shade(skin, 0.75));
  ctx.fill();
  // Face.
  ctx.beginPath();
  ctx.arc(15, 16, 10, 0, Math.PI * 2);
  paint(ctx, skin, 6, 26, { line: 1.3, hi: 0.7, lo: 0.8 });
  // Nose (profile bump past the face edge).
  ctx.beginPath();
  ctx.moveTo(24.4, 15.2);
  ctx.quadraticCurveTo(26.9, 17.2, 24.6, 18.9);
  ctx.closePath();
  ctx.fillStyle = hex(shade(skin, 0.97));
  ctx.fill();
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = hex(line);
  ctx.beginPath();
  ctx.moveTo(24.75, 15.3);
  ctx.quadraticCurveTo(26.9, 17.2, 24.6, 18.9);
  ctx.stroke();
  // Cheek blush.
  const b = ctx.createRadialGradient(20.2, 19.8, 0, 20.2, 19.8, 3);
  b.addColorStop(0, 'rgba(255,120,110,0.45)');
  b.addColorStop(1, 'rgba(255,120,110,0)');
  ctx.fillStyle = b;
  ctx.fillRect(16, 16, 8, 8);
  // Jaw shading.
  ctx.save();
  ctx.beginPath();
  ctx.arc(15, 16, 9.4, 0, Math.PI * 2);
  ctx.clip();
  const j = ctx.createLinearGradient(0, 20, 0, 26);
  j.addColorStop(0, 'rgba(120,60,40,0)');
  j.addColorStop(1, 'rgba(120,60,40,0.22)');
  ctx.fillStyle = j;
  ctx.fillRect(4, 20, 22, 7);
  // Helmet brim shadow on the forehead.
  const hs = ctx.createLinearGradient(0, 11.6, 0, 14.4);
  hs.addColorStop(0, 'rgba(40,20,20,0.3)');
  hs.addColorStop(1, 'rgba(40,20,20,0)');
  ctx.fillStyle = hs;
  ctx.fillRect(4, 11.6, 22, 3);
  ctx.restore();
  if (!covered) {
    // Eye: glossy dark iris with two catch-lights (reads clearly at small sizes).
    ellipse(ctx, 20.2, 16, 1.55, 2.15);
    const ig = ctx.createLinearGradient(0, 13.8, 0, 18.2);
    ig.addColorStop(0, '#1d1c28');
    ig.addColorStop(1, '#3a3550');
    ctx.fillStyle = ig;
    ctx.fill();
    ellipse(ctx, 20.75, 15.1, 0.6, 0.7);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ellipse(ctx, 19.7, 17.2, 0.3, 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
    // Brow.
    ctx.strokeStyle = hex(mix(line, 0x3a2418, 0.5));
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(17.3, 12.6);
    ctx.quadraticCurveTo(19.8, 11.6, 22.6, 12.4);
    ctx.stroke();
  }
  // Confident half-smile.
  ctx.strokeStyle = hex(line);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(19.2, 21.7);
  ctx.quadraticCurveTo(21.4, 22.9, 23.3, 21);
  ctx.stroke();
}

/** Head + helmet/hair. 30x30 art units; the rig anchors it at the neck (0.5, 0.82). */
export function headTexture(scene: Phaser.Scene, cosmeticIdx: number): string {
  const c = COSMETICS[cosmeticIdx] ?? COSMETICS[0];
  const [helmet, second] = c.colors;
  const skin = c.variant === 5 ? 0xe9b98c : second && c.variant !== 1 && c.variant !== 4 && c.variant !== 3 ? second : c.variant === 3 ? 0xd9a274 : SKIN;
  return ensure(scene, `head2:${c.id}`, 30, 30, (ctx) => {
    if (c.variant === 4) {
      // Diver dome: the head sits inside a glass bubble.
      face(ctx, skin, false);
      ctx.beginPath();
      ctx.arc(15, 15.5, 13.2, 0, Math.PI * 2);
      const gg = ctx.createRadialGradient(10, 9, 2, 15, 15.5, 14);
      gg.addColorStop(0, hex(tint(helmet, 0.6), 0.25));
      gg.addColorStop(0.75, hex(helmet, 0.22));
      gg.addColorStop(1, hex(shade(helmet, 0.7), 0.55));
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = hex(lineOf(helmet));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(15, 15.5, 10.6, Math.PI * 1.08, Math.PI * 1.42);
      ctx.stroke();
      ellipse(ctx, 22.5, 9.2, 1.2, 0.8, 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fill();
      block(ctx, 3.6, 24.6, 22.8, 4.4, 2, METAL, { line: 1.1, glint: [9, 25.6, 3, 0.7] });
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = hex(shade(METAL, 0.6));
        ctx.beginPath();
        ctx.arc(6.5 + i * 4.3, 26.8, 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    face(ctx, skin, c.variant === 1);
    const hl = helmet;
    switch (c.variant) {
      case 0: {
        // Cadet cap: rounded crown, band, forward brim, gold star badge.
        ctx.beginPath();
        ctx.moveTo(4.4, 13);
        ctx.quadraticCurveTo(4.6, 2.6, 15, 2.6);
        ctx.quadraticCurveTo(25.2, 2.6, 25.6, 11.2);
        ctx.lineTo(25.6, 13);
        ctx.closePath();
        paint(ctx, hl, 2.6, 13, { line: 1.3, glint: [10, 5.8, 3.4, 1.3] });
        block(ctx, 4.4, 10.4, 21.2, 2.8, 1.2, shade(hl, 0.72), { line: 0.9, hi: 0.5 });
        ctx.beginPath();
        ctx.moveTo(23.4, 10.6);
        ctx.lineTo(29.6, 11.6);
        ctx.quadraticCurveTo(30, 13.4, 27.8, 13.6);
        ctx.lineTo(23.4, 13.3);
        ctx.closePath();
        paint(ctx, shade(hl, 0.82), 10.6, 13.6, { line: 1.1 });
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? 0.85 : 2;
          ctx.lineTo(19.4 + Math.cos(a) * r, 7.2 + Math.sin(a) * r);
        }
        ctx.closePath();
        paint(ctx, GOLD, 5.2, 9.2, { line: 0.6 });
        break;
      }
      case 1: {
        // Flight visor: full helmet with a tinted wrap-around visor.
        ctx.beginPath();
        ctx.arc(15, 15, 11.6, Math.PI * 0.93, Math.PI * 2.09);
        ctx.lineTo(26.4, 18.6);
        ctx.lineTo(4.4, 18.6);
        ctx.closePath();
        paint(ctx, hl, 3.4, 18.6, { line: 1.3, glint: [9.5, 7, 3.2, 1.4] });
        block(ctx, 3.8, 16.6, 8, 3, 1.4, shade(hl, 0.7), { line: 0.9 });
        roundRect(ctx, 13.4, 10.2, 14, 6.6, 3.2);
        const vg = ctx.createLinearGradient(0, 10.2, 0, 16.8);
        const vc = second ?? 0x6ff0ff;
        vg.addColorStop(0, hex(tint(vc, 0.45)));
        vg.addColorStop(0.5, hex(vc));
        vg.addColorStop(1, hex(shade(vc, 0.45)));
        ctx.fillStyle = vg;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = hex(lineOf(hl));
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.moveTo(16, 11.4);
        ctx.lineTo(20.5, 11.4);
        ctx.lineTo(18.8, 13);
        ctx.lineTo(15.4, 13);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hex(tint(hl, 0.5));
        ctx.fillRect(8, 4.4, 1.4, 1.4);
        break;
      }
      case 2: {
        // Bobble beanie: knit crown, ribbed fold, pom-pom.
        ctx.beginPath();
        ctx.moveTo(4.6, 13);
        ctx.quadraticCurveTo(5, 3.4, 15, 3.4);
        ctx.quadraticCurveTo(25, 3.4, 25.4, 13);
        ctx.closePath();
        paint(ctx, hl, 3.4, 13, { line: 1.3 });
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = hex(shade(hl, 0.82));
        ctx.lineWidth = 0.6;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(6 + i * 3.6, 9.5);
          ctx.quadraticCurveTo(9 + i * 2.4, 5, 15, 3.6);
          ctx.stroke();
        }
        ctx.restore();
        block(ctx, 4.2, 9.6, 21.6, 3.8, 1.8, tint(hl, 0.82), { line: 1, hi: 0.4 });
        ctx.fillStyle = hex(shade(tint(hl, 0.82), 0.82));
        for (let i = 0; i < 10; i++) ctx.fillRect(5.6 + i * 2.05, 10.2, 0.7, 2.6);
        ctx.beginPath();
        ctx.arc(15, 2.8, 3.1, 0, Math.PI * 2);
        paint(ctx, 0xffffff, -0.3, 5.9, { line: 1, glint: [13.9, 1.8, 1, 0.6] });
        break;
      }
      case 3: {
        // Spike crest: a sculpted mohawk with gradient tips and shaved sides.
        ctx.save();
        ctx.beginPath();
        ctx.arc(15, 16, 9.7, Math.PI, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = hex(shade(hl, 0.55), 0.35);
        ctx.fillRect(4, 6, 22, 7);
        ctx.restore();
        ctx.beginPath();
        ctx.moveTo(6.2, 11.4);
        const tips = [
          [6.4, 4],
          [9.6, 0.6],
          [13.4, 2.8],
          [16.6, -0.4],
          [20.2, 2.2],
          [23.6, 0.8],
          [24.4, 6],
        ];
        let px = 6.2;
        for (const [tx, ty] of tips) {
          ctx.quadraticCurveTo((px + tx) / 2 - 0.4, 8.4, tx, ty);
          px = tx;
        }
        ctx.quadraticCurveTo(25.8, 9, 24.8, 11.4);
        ctx.quadraticCurveTo(15, 9.4, 6.2, 11.4);
        ctx.closePath();
        const mg = ctx.createLinearGradient(0, 0, 0, 11.4);
        mg.addColorStop(0, hex(tint(hl, 0.55)));
        mg.addColorStop(0.5, hex(hl));
        mg.addColorStop(1, hex(shade(hl, 0.6)));
        ctx.fillStyle = mg;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = hex(lineOf(hl));
        ctx.stroke();
        break;
      }
      case 5: {
        // Ram helm: bronze dome with a curled horn.
        ctx.beginPath();
        ctx.moveTo(4.4, 13.4);
        ctx.quadraticCurveTo(4.6, 3.2, 15, 3.2);
        ctx.quadraticCurveTo(25.4, 3.2, 25.6, 13.4);
        ctx.closePath();
        paint(ctx, hl, 3.2, 13.4, { line: 1.3, glint: [10, 6, 3.2, 1.2] });
        ctx.strokeStyle = hex(shade(hl, 0.7));
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(15, 3.6);
        ctx.lineTo(15, 13);
        ctx.stroke();
        const horn = second ?? 0x8a6a4a;
        ctx.lineCap = 'round';
        for (const [w, col] of [
          [4.4, lineOf(horn)],
          [3, horn],
          [1, tint(horn, 0.45)],
        ] as const) {
          ctx.beginPath();
          ctx.arc(8.2, 12.6, 4.6, Math.PI * 0.55, Math.PI * 2.05);
          ctx.lineWidth = w;
          ctx.strokeStyle = hex(col);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Tin crown over a tidy fringe.
        ctx.beginPath();
        ctx.moveTo(5, 13);
        ctx.quadraticCurveTo(5.4, 6, 15, 6);
        ctx.quadraticCurveTo(24.6, 6, 25, 12);
        ctx.quadraticCurveTo(20, 10, 15, 11.8);
        ctx.quadraticCurveTo(9, 10.2, 5, 13);
        ctx.closePath();
        paint(ctx, 0x5a3a26, 6, 13, { line: 1.1 });
        ctx.beginPath();
        ctx.moveTo(6.4, 9.4);
        ctx.lineTo(7, 1.6);
        ctx.lineTo(11, 5.6);
        ctx.lineTo(15, 0.4);
        ctx.lineTo(19, 5.6);
        ctx.lineTo(23, 1.6);
        ctx.lineTo(23.6, 9.4);
        ctx.closePath();
        paint(ctx, hl, 0.4, 9.4, { line: 1.2, glint: [11, 6.8, 2.6, 0.8] });
        for (const [x, y] of [
          [7, 1.6],
          [15, 0.4],
          [23, 1.6],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, 1.1, 0, Math.PI * 2);
          paint(ctx, tint(hl, 0.5), y - 1.1, y + 1.1, { line: 0.6 });
        }
        ctx.beginPath();
        ctx.arc(15, 6.6, 1.7, 0, Math.PI * 2);
        paint(ctx, 0xe0484d, 4.9, 8.3, { line: 0.7, glint: [14.5, 6, 0.6, 0.4] });
      }
    }
  });
}

// ------------------------------------------------------------------ body

/** Torso 22x22 art units, origin centre. colors: [main, accent, boots] */
export function torsoTexture(scene: Phaser.Scene, outfitIdx: number, team: number, teamColor: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main, accent] = c.colors;
  const chrome = c.id === 'outfit_chrome';
  return ensure(scene, `torso2:${c.id}:${team}:${teamColor}`, 22, 22, (ctx) => {
    // Shirt / suit body.
    roundRect(ctx, 2.4, 1.8, 17.2, 18.6, 6.2);
    paint(ctx, main, 1.8, 20.4, { line: 1.3, glint: chrome ? [7, 5, 3, 1.4] : undefined });
    ctx.save();
    roundRect(ctx, 2.4, 1.8, 17.2, 18.6, 6.2);
    ctx.clip();
    if (c.id === 'outfit_candy') {
      ctx.fillStyle = hex(accent, 0.75);
      for (let i = -3; i < 7; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5, 1);
        ctx.lineTo(i * 5 + 2.6, 1);
        ctx.lineTo(i * 5 + 13, 22);
        ctx.lineTo(i * 5 + 10.4, 22);
        ctx.fill();
      }
    }
    // Tactical vest panel.
    roundRect(ctx, 6.2, 3.4, 13.8, 12.6, 3.4);
    paint(ctx, chrome ? tint(accent, 0.25) : accent, 3.4, 16, { line: 1, hi: 0.6, glint: chrome ? [9, 5.6, 2.4, 0.9] : undefined });
    // Vest pouches.
    block(ctx, 8.4, 9.6, 4.6, 4.6, 1.2, shade(accent, 0.86), { line: 0.8, hi: 0.5 });
    block(ctx, 13.6, 9.6, 4.6, 4.6, 1.2, shade(accent, 0.86), { line: 0.8, hi: 0.5 });
    ctx.fillStyle = hex(shade(accent, 0.6));
    ctx.fillRect(8.4, 10.6, 4.6, 0.6);
    ctx.fillRect(13.6, 10.6, 4.6, 0.6);
    // Harness strap from the jetpack over the shoulder.
    ctx.strokeStyle = hex(lineOf(STRAP));
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(4.4, 1.8);
    ctx.quadraticCurveTo(7, 9, 6.6, 16);
    ctx.stroke();
    ctx.strokeStyle = hex(STRAP);
    ctx.lineWidth = 1.9;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(4, 2.2);
    ctx.quadraticCurveTo(6.4, 9, 6, 15.6);
    ctx.stroke();
    block(ctx, 5, 8.2, 3.2, 2.4, 0.7, METAL, { line: 0.6 });
    // Waist shading + belt with buckle.
    const ao = ctx.createLinearGradient(0, 12, 0, 16);
    ao.addColorStop(0, 'rgba(0,0,0,0)');
    ao.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = ao;
    ctx.fillRect(0, 12, 22, 4);
    ctx.restore();
    block(ctx, 2.6, 15.4, 16.8, 3.2, 1.2, shade(main, 0.42), { line: 0.9, hi: 0.6 });
    block(ctx, 10.2, 15.1, 3.6, 3.8, 0.8, GOLD, { line: 0.7, glint: [11, 15.9, 0.8, 0.4] });
    // Collar.
    ctx.beginPath();
    ctx.moveTo(9.4, 2.2);
    ctx.quadraticCurveTo(13.6, 4.8, 17.4, 2.6);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = hex(shade(main, 0.6));
    ctx.stroke();
    if (team >= 0) {
      // Team shoulder pad (back) + chest patch (front): readable from either facing.
      block(ctx, 1.6, 3.4, 5.4, 6.8, 2, teamColor, { line: 1, glint: [3.4, 4.8, 1.1, 0.6] });
      block(ctx, 14.6, 4.6, 4.2, 3.2, 1, teamColor, { line: 0.7, hi: 0.8 });
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      if (team === 0) {
        ctx.beginPath();
        ctx.moveTo(15.8, 7);
        ctx.lineTo(16.7, 5.4);
        ctx.lineTo(17.6, 7);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(16.7, 6.2, 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

/** Leg with boot: 10x18 art units, anchored at the hip (0.5, 0.1). */
export function legTexture(scene: Phaser.Scene, outfitIdx: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main, accent, boots] = c.colors;
  return ensure(scene, `leg2:${c.id}`, 10, 18, (ctx) => {
    block(ctx, 2.1, 0.6, 5.8, 12.4, 2.9, shade(main, 0.84), { line: 1.2, hi: 0.6 });
    block(ctx, 2.4, 6.4, 5.3, 3.4, 1.4, shade(accent, 0.95), { line: 0.8, glint: [3.8, 7.2, 1, 0.45] });
    // Boot: shaft, toe cap, chunky sole.
    ctx.beginPath();
    ctx.moveTo(1.6, 11);
    ctx.lineTo(7.6, 11);
    ctx.quadraticCurveTo(9.6, 12.2, 9.6, 14.6);
    ctx.lineTo(9.6, 15.6);
    ctx.lineTo(1, 15.6);
    ctx.lineTo(1, 12);
    ctx.closePath();
    paint(ctx, boots, 11, 15.6, { line: 1.1, glint: [7.6, 12.6, 1.1, 0.5] });
    block(ctx, 0.7, 15.2, 9.3, 2.3, 1, shade(boots, 0.55), { line: 0.9, hi: 0.3 });
    ctx.strokeStyle = hex(tint(boots, 0.3), 0.8);
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(3 + i * 1.6, 12.2);
      ctx.lineTo(4.4 + i * 1.6, 13.4);
      ctx.stroke();
    }
  });
}

/** Arm: 8x14 art units, anchored at the shoulder (0.5, 0.15). */
export function armTexture(scene: Phaser.Scene, outfitIdx: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main] = c.colors;
  return ensure(scene, `arm2:${c.id}`, 8, 14, (ctx) => {
    block(ctx, 1.5, 0.7, 5, 9.2, 2.5, main, { line: 1.1, hi: 0.7 });
    block(ctx, 1.3, 7.6, 5.4, 2, 0.9, shade(main, 0.68), { line: 0.8, hi: 0.4 });
    ctx.beginPath();
    ctx.arc(4, 11.1, 2.6, 0, Math.PI * 2);
    paint(ctx, GLOVE, 8.5, 13.7, { line: 1, glint: [3.1, 10.2, 0.9, 0.55] });
  });
}

// ------------------------------------------------------------------ jetpack

function nozzle(ctx: CanvasRenderingContext2D, cx: number, y: number, w: number, flame: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.36, y);
  ctx.lineTo(cx + w * 0.36, y);
  ctx.lineTo(cx + w * 0.5, y + 3.4);
  ctx.lineTo(cx - w * 0.5, y + 3.4);
  ctx.closePath();
  paint(ctx, 0x4a505c, y, y + 3.4, { line: 0.9, hi: 0.6 });
  ellipse(ctx, cx, y + 3.3, w * 0.42, 0.7);
  ctx.fillStyle = hex(flame, 0.85);
  ctx.fill();
}

/** Jetpack: 16x24 art units, anchored at the strap (0.85, 0.3). */
export function jetpackTexture(scene: Phaser.Scene, jetIdx: number): string {
  const c = COSMETICS[jetIdx] ?? COSMETICS[15];
  const [body, flame] = c.colors;
  return ensure(scene, `jet2:${c.id}`, 16, 24, (ctx) => {
    switch (c.variant) {
      case 1: {
        // Bubble pack: glass sphere of coolant.
        nozzle(ctx, 8, 16.6, 5, flame);
        ctx.beginPath();
        ctx.arc(8, 9.4, 7, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(5.6, 6.6, 0.5, 8, 9.4, 7.4);
        g.addColorStop(0, hex(tint(body, 0.75)));
        g.addColorStop(0.6, hex(body));
        g.addColorStop(1, hex(shade(body, 0.55)));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = hex(lineOf(body));
        ctx.stroke();
        ellipse(ctx, 5.4, 6.4, 1.8, 1.2, -0.6);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fill();
        for (const [x, y, r] of [
          [9.4, 11.4, 0.9],
          [7, 12.6, 0.6],
          [10.6, 8.6, 0.5],
        ]) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fill();
        }
        block(ctx, 2.6, 14.6, 10.8, 2.6, 1.2, METAL, { line: 0.9 });
        break;
      }
      case 2: {
        // Retro rocket with fins and a porthole.
        nozzle(ctx, 8, 17.4, 6, flame);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(8 + s * 4.6, 12.4);
          ctx.lineTo(8 + s * 7.6, 20.6);
          ctx.lineTo(8 + s * 3.8, 18);
          ctx.closePath();
          paint(ctx, shade(body, 0.8), 12.4, 20.6, { line: 0.9 });
        }
        ctx.beginPath();
        ctx.moveTo(8, 0.4);
        ctx.quadraticCurveTo(14.4, 5.6, 13, 18);
        ctx.lineTo(3, 18);
        ctx.quadraticCurveTo(1.6, 5.6, 8, 0.4);
        ctx.closePath();
        paint(ctx, body, 0.4, 18, { line: 1.2, glint: [5.4, 6, 1, 3] });
        ctx.beginPath();
        ctx.arc(8, 8.6, 2.7, 0, Math.PI * 2);
        paint(ctx, METAL, 5.9, 11.3, { line: 0.8 });
        ctx.beginPath();
        ctx.arc(8, 8.6, 1.8, 0, Math.PI * 2);
        const pg = ctx.createRadialGradient(7.4, 8, 0.2, 8, 8.6, 2);
        pg.addColorStop(0, '#d9f7ff');
        pg.addColorStop(1, '#3a7fa8');
        ctx.fillStyle = pg;
        ctx.fill();
        block(ctx, 3.2, 13.2, 9.6, 1.6, 0.6, shade(body, 0.55), { line: 0.6, hi: 0.2 });
        break;
      }
      case 3: {
        // Leaf glider: organic wing pack.
        nozzle(ctx, 8, 17.4, 4.4, flame);
        ellipse(ctx, 8, 9.6, 5.6, 9.2);
        paint(ctx, body, 2.4, 13.6, { line: 1.2, horizontal: true });
        ctx.strokeStyle = hex(shade(body, 0.55));
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(8, 1.4);
        ctx.lineTo(8, 18);
        for (let i = 0; i < 5; i++) {
          ctx.moveTo(8, 4.2 + i * 3);
          ctx.quadraticCurveTo(6, 3 + i * 3, 4, 2.6 + i * 3.2);
          ctx.moveTo(8, 4.2 + i * 3);
          ctx.quadraticCurveTo(10, 3 + i * 3, 12, 2.6 + i * 3.2);
        }
        ctx.stroke();
        ctx.strokeStyle = hex(tint(body, 0.5), 0.6);
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(5.4, 3.4);
        ctx.quadraticCurveTo(3.4, 9, 5, 15);
        ctx.stroke();
        break;
      }
      case 4: {
        // Void engine: dark casing with a glowing core and runes.
        nozzle(ctx, 8, 17.4, 6, flame);
        block(ctx, 1.6, 0.8, 12.8, 17.6, 3.2, body, { line: 1.2, glint: [4.4, 3.2, 1.6, 0.7] });
        glow(ctx, 8, 9, 6.5, flame, 0.9);
        ctx.beginPath();
        ctx.arc(8, 9, 3.4, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.strokeStyle = hex(tint(flame, 0.3));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(8, 9, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = hex(flame, 0.75);
        ctx.lineWidth = 0.55;
        for (const y of [3, 15]) {
          ctx.beginPath();
          ctx.moveTo(4, y);
          ctx.lineTo(6, y - 0.8);
          ctx.lineTo(8, y);
          ctx.lineTo(10, y - 0.8);
          ctx.lineTo(12, y);
          ctx.stroke();
        }
        break;
      }
      default: {
        // Twin tank: two brushed-metal cylinders, banded, with nozzles and a status light.
        nozzle(ctx, 4.4, 17, 5.4, flame);
        nozzle(ctx, 11.6, 17, 5.4, flame);
        block(ctx, 6, 3, 4, 12, 1, shade(body, 0.55), { line: 0.9 });
        for (const x of [1.2, 8.6]) {
          roundRect(ctx, x, 0.8, 6.2, 17, 3.1);
          paint(ctx, body, x, x + 6.2, { line: 1.2, horizontal: true, glint: [x + 1.7, 7, 0.7, 4.2] });
          for (const y of [4.4, 12.2]) block(ctx, x - 0.2, y, 6.6, 1.7, 0.6, shade(body, 0.62), { line: 0.6, hi: 0.4 });
          block(ctx, x + 1.9, -0.1, 2.4, 1.8, 0.6, METAL, { line: 0.6 });
        }
        ctx.beginPath();
        ctx.arc(8, 9, 0.95, 0, Math.PI * 2);
        ctx.fillStyle = hex(tint(flame, 0.4));
        ctx.fill();
        glow(ctx, 8, 9, 2.6, flame, 0.6);
      }
    }
  });
}

// ------------------------------------------------------------------ guns

/** Gun silhouettes, drawn pointing right with the grip at (gx, gy). */
export interface GunArt {
  key: string;
  w: number;
  h: number;
  gripX: number;
  gripY: number;
  muzzleX: number;
  muzzleY: number;
}

type GunDraw = (ctx: CanvasRenderingContext2D, body: number, dark: number, accent: number) => void;

const L = 0.85;
const part = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: number, glint = false) =>
  block(ctx, x, y, w, h, r, color, { line: L, glint: glint ? [x + w * 0.3, y + h * 0.3, Math.max(0.6, w * 0.18), Math.max(0.35, h * 0.14)] : undefined });

/** Glowing accent strip (energy cells, sights). */
function strip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: number): void {
  roundRect(ctx, x, y, w, h, Math.min(w, h) / 2);
  ctx.fillStyle = hex(tint(color, 0.35));
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(x + 0.3, y + 0.15, Math.max(0, w - 0.6), Math.min(0.45, h * 0.35));
}

function grip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, dark: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - 0.6, y + h);
  ctx.quadraticCurveTo(x + w * 0.4, y + h + 0.6, x - 1, y + h - 0.2);
  ctx.closePath();
  paint(ctx, dark, y, y + h, { line: L, hi: 0.5 });
  ctx.strokeStyle = hex(shade(dark, 0.6));
  ctx.lineWidth = 0.4;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + 0.4, y + (h * i) / 3);
    ctx.lineTo(x + w - 0.8, y + (h * i) / 3);
    ctx.stroke();
  }
}

const GUN_SHAPES: Record<string, { w: number; h: number; gx: number; gy: number; mx: number; my: number; draw: GunDraw }> = {
  sparrow: {
    w: 18, h: 10, gx: 5, gy: 6, mx: 17, my: 3,
    draw: (ctx, b, d, a) => {
      grip(ctx, 3.2, 4.6, 4.2, 5, d);
      part(ctx, 2, 1.4, 14.6, 4.4, 1.4, b, true);
      part(ctx, 14.6, 2, 2.6, 2.4, 0.6, d);
      strip(ctx, 4.4, 2.4, 3.6, 0.9, a);
      ctx.strokeStyle = hex(shade(b, 0.65));
      ctx.lineWidth = 0.4;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(9.6 + i * 1.2, 1.9);
        ctx.lineTo(9.6 + i * 1.2, 3.6);
        ctx.stroke();
      }
    },
  },
  thunderclap: {
    w: 24, h: 11, gx: 5, gy: 7, mx: 23, my: 3.5,
    draw: (ctx, b, d, a) => {
      grip(ctx, 2.4, 5.2, 4.8, 5.6, d);
      part(ctx, 6, 1.8, 17, 3.6, 1, b, true);
      part(ctx, 21, 1.4, 2.4, 4.4, 0.6, d);
      ctx.beginPath();
      ctx.arc(9.4, 5, 3.6, 0, Math.PI * 2);
      paint(ctx, d, 1.4, 8.6, { line: L, glint: [8.4, 3.8, 1, 0.6] });
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(9.4 + Math.cos((i / 6) * Math.PI * 2) * 2.1, 5 + Math.sin((i / 6) * Math.PI * 2) * 2.1, 0.55, 0, Math.PI * 2);
        ctx.fillStyle = hex(shade(d, 0.5));
        ctx.fill();
      }
      strip(ctx, 14, 2.6, 6, 0.8, a);
    },
  },
  hornet: {
    w: 24, h: 13, gx: 8, gy: 7, mx: 23, my: 4,
    draw: (ctx, b, d, a) => {
      part(ctx, 11, 6.2, 4, 6.8, 1, d);
      grip(ctx, 5, 6, 4, 5.4, d);
      part(ctx, 2.8, 1.4, 18.6, 6, 2, b, true);
      part(ctx, 19.8, 2.8, 3.6, 2.6, 0.8, d);
      part(ctx, 7, 0.2, 7, 1.8, 0.8, d);
      strip(ctx, 4, 3.4, 5, 1.2, a);
      ctx.fillStyle = hex(shade(b, 0.65));
      for (let i = 0; i < 3; i++) ctx.fillRect(14 + i * 1.6, 3, 0.6, 2.6);
    },
  },
  kestrel: {
    w: 34, h: 13, gx: 12, gy: 7, mx: 33, my: 3.5,
    draw: (ctx, b, d, a) => {
      ctx.beginPath();
      ctx.moveTo(0.8, 2.6);
      ctx.lineTo(9, 3);
      ctx.lineTo(9, 7.2);
      ctx.lineTo(1.4, 8);
      ctx.closePath();
      paint(ctx, d, 2.6, 8, { line: L });
      ctx.beginPath();
      ctx.moveTo(16, 7);
      ctx.lineTo(20.4, 7);
      ctx.lineTo(18.6, 13);
      ctx.lineTo(15, 12.2);
      ctx.closePath();
      paint(ctx, d, 7, 13, { line: L });
      grip(ctx, 10, 6.4, 3.6, 5, d);
      part(ctx, 8, 1.4, 19.6, 6, 1.6, b, true);
      part(ctx, 26.6, 2.4, 6.8, 2.6, 0.8, d);
      part(ctx, 31.6, 1.8, 1.8, 3.8, 0.5, shade(d, 0.8));
      part(ctx, 12, -0.2, 9, 2, 0.8, d);
      strip(ctx, 12.4, 3.2, 8, 1.2, a);
    },
  },
  triplet: {
    w: 30, h: 13, gx: 13, gy: 7, mx: 29, my: 3.5,
    draw: (ctx, b, d, a) => {
      part(ctx, 5, 7, 5.2, 5.6, 1.4, d);
      grip(ctx, 11.4, 6.6, 3.8, 5.2, d);
      part(ctx, 1.8, 1.4, 24.4, 7, 3, b, true);
      part(ctx, 24, 2.4, 5.4, 2.6, 0.8, d);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(15 + i * 3, 4.2, 1.05, 0, Math.PI * 2);
        ctx.fillStyle = hex(tint(a, 0.3));
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(14.6 + i * 3, 3.6, 0.6, 0.5);
      }
      ctx.strokeStyle = hex(shade(b, 0.6));
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(4, 6.6);
      ctx.lineTo(22, 6.6);
      ctx.stroke();
    },
  },
  mule: {
    w: 32, h: 12, gx: 10, gy: 7, mx: 31, my: 4,
    draw: (ctx, b, d, a) => {
      ctx.beginPath();
      ctx.moveTo(0.6, 3.4);
      ctx.lineTo(9.6, 3);
      ctx.lineTo(9.6, 8.6);
      ctx.lineTo(1.2, 9.4);
      ctx.closePath();
      paint(ctx, d, 3, 9.4, { line: L });
      grip(ctx, 8, 6.4, 3.8, 5.2, d);
      part(ctx, 9, 1.2, 22.2, 3.6, 1.2, b, true);
      part(ctx, 9, 4.4, 20.6, 3.2, 1.2, shade(b, 0.9));
      part(ctx, 16, 7, 9, 3.6, 1.6, d);
      ctx.fillStyle = hex(shade(d, 0.55));
      for (let i = 0; i < 4; i++) ctx.fillRect(17.4 + i * 2, 7.6, 0.6, 2.4);
      strip(ctx, 11, 2, 4, 0.8, a);
    },
  },
  heron: {
    w: 44, h: 13, gx: 13, gy: 7, mx: 43, my: 4,
    draw: (ctx, b, d, a) => {
      ctx.beginPath();
      ctx.moveTo(0.6, 2.6);
      ctx.lineTo(11, 3.2);
      ctx.lineTo(11, 7.8);
      ctx.lineTo(3, 8.4);
      ctx.quadraticCurveTo(0.6, 8, 0.6, 6);
      ctx.closePath();
      paint(ctx, d, 2.6, 8.4, { line: L });
      part(ctx, 16, 7, 3.6, 6, 1, d);
      grip(ctx, 11.2, 6.6, 3.6, 5, d);
      part(ctx, 10, 2.4, 18.4, 5.2, 1.6, b, true);
      part(ctx, 27, 2.9, 15.4, 2.4, 1, b);
      part(ctx, 41, 2.2, 2.4, 3.8, 0.6, d);
      // Scope with lens glint.
      part(ctx, 12.6, -0.4, 11, 3.4, 1.6, d, true);
      ctx.beginPath();
      ctx.arc(23.4, 1.3, 1.3, 0, Math.PI * 2);
      const lg = ctx.createRadialGradient(23, 0.9, 0.1, 23.4, 1.3, 1.4);
      lg.addColorStop(0, '#ffffff');
      lg.addColorStop(0.4, hex(tint(a, 0.4)));
      lg.addColorStop(1, hex(shade(a, 0.6)));
      ctx.fillStyle = lg;
      ctx.fill();
    },
  },
  grizzly: {
    w: 38, h: 16, gx: 13, gy: 8, mx: 37, my: 4,
    draw: (ctx, b, d, a) => {
      part(ctx, 0.8, 3, 10.2, 6.2, 2, d);
      part(ctx, 15, 8.8, 9.4, 7, 2, a);
      ctx.fillStyle = hex(shade(a, 0.6));
      for (let i = 0; i < 3; i++) ctx.fillRect(16.4 + i * 2.8, 10, 1, 4.6);
      grip(ctx, 10.6, 7.6, 3.6, 5.6, d);
      part(ctx, 8.8, 1.2, 21.6, 8.4, 2, b, true);
      part(ctx, 29, 2.6, 8.2, 3.2, 1, d);
      ctx.fillStyle = hex(shade(d, 0.5));
      for (let i = 0; i < 3; i++) ctx.fillRect(31 + i * 2, 3.1, 0.8, 2.2);
      ctx.strokeStyle = hex(shade(b, 0.6));
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(11, 5.6);
      ctx.lineTo(28.6, 5.6);
      ctx.stroke();
    },
  },
  comet: {
    w: 42, h: 15, gx: 16, gy: 9, mx: 41, my: 6,
    draw: (ctx, b, d, a) => {
      part(ctx, 14, 9, 4.2, 6, 1, d);
      grip(ctx, 20, 9, 3.6, 5.2, d);
      ctx.beginPath();
      ctx.arc(21, 6, 4.2, Math.PI, Math.PI * 2);
      paint(ctx, d, 1.8, 6, { line: L });
      part(ctx, 2, 2, 37.6, 8, 4, b, true);
      part(ctx, 34, 0.8, 7.2, 10.4, 2, d);
      part(ctx, 0.4, 0.8, 5.2, 10.4, 2, d);
      strip(ctx, 11, 4, 16, 1.8, a);
      ellipse(ctx, 40.4, 6, 0.8, 3.4);
      ctx.fillStyle = hex(shade(d, 0.4));
      ctx.fill();
    },
  },
  popper: {
    w: 32, h: 16, gx: 11, gy: 9, mx: 31, my: 5,
    draw: (ctx, b, d, a) => {
      part(ctx, 0.8, 5, 6.4, 5.2, 2, d);
      grip(ctx, 9.4, 9.6, 3.6, 5.6, d);
      part(ctx, 14, 1.8, 17.2, 6.4, 2, b, true);
      part(ctx, 28.6, 1.2, 2.8, 7.6, 0.8, d);
      ctx.beginPath();
      ctx.arc(12, 7.2, 6.2, 0, Math.PI * 2);
      paint(ctx, d, 1, 13.4, { line: 1, glint: [10, 4.8, 1.6, 0.9] });
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc(12 + Math.cos(i * 1.047) * 3.6, 7.2 + Math.sin(i * 1.047) * 3.6, 1.15, 0, Math.PI * 2);
        paint(ctx, a, 0, 14, { line: 0.5, hi: 0.4 });
      }
      ctx.beginPath();
      ctx.arc(12, 7.2, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = hex(shade(d, 0.5));
      ctx.fill();
    },
  },
  torchie: {
    w: 36, h: 16, gx: 12, gy: 9, mx: 35, my: 4,
    draw: (ctx, b, d, a) => {
      // Fuel tank with gauge.
      part(ctx, 0.8, 3.6, 10.4, 11.6, 4.4, a, true);
      block(ctx, 2.4, 6.2, 7.2, 1.2, 0.5, shade(a, 0.6), { line: 0.4, hi: 0 });
      ctx.beginPath();
      ctx.arc(6, 11.2, 1.9, 0, Math.PI * 2);
      paint(ctx, 0xf2f4f8, 9.3, 13.1, { line: 0.6 });
      ctx.strokeStyle = '#e0484d';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(6, 11.2);
      ctx.lineTo(7.1, 10.3);
      ctx.stroke();
      grip(ctx, 10.6, 7.4, 3.4, 5.6, d);
      part(ctx, 10, 1.8, 18.4, 5.4, 2, b, true);
      ctx.beginPath();
      ctx.moveTo(27, 1.4);
      ctx.lineTo(35.4, 0.4);
      ctx.lineTo(35.4, 8.2);
      ctx.lineTo(27, 7.6);
      ctx.closePath();
      paint(ctx, d, 0.4, 8.2, { line: L });
      ctx.beginPath();
      ctx.arc(34.6, 4.3, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb347';
      ctx.fill();
    },
  },
  zapline: {
    w: 40, h: 14, gx: 13, gy: 8, mx: 39, my: 5,
    draw: (ctx, b, d, a) => {
      part(ctx, 0.8, 3, 10.4, 6.2, 2, d);
      grip(ctx, 12.4, 7.6, 3.6, 5.8, d);
      part(ctx, 9, 1.8, 30.4, 6.4, 2, b, true);
      for (let i = 0; i < 4; i++) {
        roundRect(ctx, 15.4 + i * 5, 0.6, 3, 8.8, 1);
        paint(ctx, a, 0.6, 9.4, { line: 0.6 });
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(16 + i * 5, 1.2, 0.7, 7.4);
      }
      glow(ctx, 38.6, 5, 2.4, a, 0.7);
    },
  },
  buzzsaw: {
    w: 34, h: 16, gx: 12, gy: 9, mx: 32, my: 6,
    draw: (ctx, b, d, a) => {
      grip(ctx, 9.6, 8.6, 3.6, 6, d);
      part(ctx, 1.8, 2.8, 22.6, 7.4, 2, b, true);
      ctx.beginPath();
      for (let i = 0; i < 20; i++) {
        const t = (i / 20) * Math.PI * 2;
        const r = i % 2 ? 5 : 6.6;
        ctx.lineTo(27 + Math.cos(t) * r, 6.2 + Math.sin(t) * r);
      }
      ctx.closePath();
      paint(ctx, tint(a, 0.15), -0.4, 12.8, { line: 0.8, glint: [25, 3.6, 1.6, 0.8] });
      ctx.beginPath();
      ctx.arc(27, 6.2, 1.7, 0, Math.PI * 2);
      paint(ctx, d, 4.5, 7.9, { line: 0.6 });
      strip(ctx, 4.4, 4.2, 7, 1.1, a);
    },
  },
};

export function gunArt(scene: Phaser.Scene, wi: number, skinIdx: number): GunArt {
  const def = WEAPONS[wi] ?? WEAPONS[0];
  const shape = GUN_SHAPES[def.id] ?? GUN_SHAPES.sparrow;
  const skin = COSMETICS[skinIdx] ?? COSMETICS[20];
  const [body, dark] = skin.colors;
  const factory = skin.id === 'skin_none';
  const b = factory ? 0x8f98a6 : body;
  const d = factory ? 0x3a3f4a : dark;
  const key = ensure(scene, `gun2:${def.id}:${skin.id}`, shape.w, shape.h, (ctx) => shape.draw(ctx, b, d, def.tracer));
  return { key, w: shape.w, h: shape.h, gripX: shape.gx, gripY: shape.gy, muzzleX: shape.mx, muzzleY: shape.my };
}

/** Icon versions of weapons for the HUD and pickups (factory skin). Same 4x texture as in-hand guns. */
export function weaponIcon(scene: Phaser.Scene, wi: number): string {
  return gunArt(scene, wi, COSMETICS.findIndex((c) => c.id === 'skin_none')).key;
}
