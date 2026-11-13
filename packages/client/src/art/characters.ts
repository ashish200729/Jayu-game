import type Phaser from 'phaser';
import { COSMETICS, WEAPONS } from '@game/content';
import { ART_SCALE as S, canvas, hex, inked, roundRect, shade } from './draw';

const INK = '#1b1d26';
const SKIN = 0xf2c79b;

function ensure(scene: Phaser.Scene, key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): string {
  if (scene.textures.exists(key)) return key;
  const [c, ctx] = canvas(w * S, h * S);
  ctx.scale(S, S);
  draw(ctx);
  scene.textures.addCanvas(key, c);
  return key;
}

/** Head + helmet/hair. Texture is 30x30, origin at neck (0.5, 0.85). */
export function headTexture(scene: Phaser.Scene, cosmeticIdx: number): string {
  const c = COSMETICS[cosmeticIdx] ?? COSMETICS[0];
  const [helmet, skinOverride] = c.colors;
  const skin = c.variant === 5 ? 0xe9b98c : skinOverride && c.variant !== 1 ? skinOverride : SKIN;
  return ensure(scene, `head:${c.id}`, 30, 30, (ctx) => {
    ctx.lineWidth = 2;
    // face
    ctx.beginPath();
    ctx.arc(15, 16, 10, 0, Math.PI * 2);
    inked(ctx, hex(skin), INK, 2);
    // cheek blush
    ctx.fillStyle = hex(0xff8a7a, 0.35);
    ctx.beginPath();
    ctx.arc(20, 19, 2.2, 0, Math.PI * 2);
    ctx.fill();
    // eye (facing right; flipped by the rig)
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(19.5, 15, 1.8, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(20, 14.2, 0.7, 0, Math.PI * 2);
    ctx.fill();
    // mouth
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(18, 21);
    ctx.quadraticCurveTo(20.5, 22.5, 22.5, 20.5);
    ctx.stroke();
    ctx.lineWidth = 2;
    const h = hex(helmet);
    const hd = hex(shade(helmet, 0.7));
    switch (c.variant) {
      case 0: // cadet cap
        ctx.beginPath();
        ctx.moveTo(4.5, 14);
        ctx.quadraticCurveTo(6, 3.5, 15, 3.5);
        ctx.quadraticCurveTo(24, 3.5, 25.5, 12);
        ctx.lineTo(29, 13);
        ctx.lineTo(26, 15);
        ctx.lineTo(5, 15);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        ctx.fillStyle = hd;
        ctx.fillRect(6, 11.5, 19, 2.5);
        break;
      case 1: // flight visor
        ctx.beginPath();
        ctx.arc(15, 15, 11.5, Math.PI * 0.95, Math.PI * 2.08);
        ctx.lineTo(26, 18);
        ctx.lineTo(5, 18);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        roundRect(ctx, 14, 11, 13, 6, 3);
        inked(ctx, hex(skinOverride ?? 0x6ff0ff), INK, 1.6);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fillRect(16, 12, 4, 1.4);
        break;
      case 2: // bobble beanie
        ctx.beginPath();
        ctx.moveTo(5, 14);
        ctx.quadraticCurveTo(6, 4, 15, 4);
        ctx.quadraticCurveTo(24, 4, 25, 14);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        ctx.fillStyle = '#fff';
        for (let i = 0; i < 4; i++) ctx.fillRect(7 + i * 4.5, 10, 2.2, 3);
        ctx.beginPath();
        ctx.arc(15, 3, 3, 0, Math.PI * 2);
        inked(ctx, '#ffffff', INK, 1.6);
        break;
      case 3: // spike crest
        ctx.beginPath();
        ctx.moveTo(6, 11);
        for (let i = 0; i < 5; i++) {
          ctx.lineTo(8 + i * 4, 0.5 + (i % 2) * 2);
          ctx.lineTo(10 + i * 4, 8);
        }
        ctx.lineTo(25, 11);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        break;
      case 4: // diver dome
        ctx.beginPath();
        ctx.arc(15, 15.5, 13, 0, Math.PI * 2);
        ctx.fillStyle = hex(helmet, 0.35);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.beginPath();
        ctx.ellipse(9, 9, 2.5, 4, -0.6, 0, Math.PI * 2);
        ctx.fill();
        roundRect(ctx, 4, 25, 22, 4, 2);
        inked(ctx, hex(0x8a919c), INK, 1.6);
        break;
      case 5: // ram helm
        ctx.beginPath();
        ctx.moveTo(4.5, 15);
        ctx.quadraticCurveTo(5, 4, 15, 4);
        ctx.quadraticCurveTo(25, 4, 25.5, 15);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        ctx.beginPath();
        ctx.arc(8, 13, 5, Math.PI * 0.6, Math.PI * 2.1);
        ctx.lineWidth = 3.4;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = hex(skinOverride ?? 0x8a6a4a);
        ctx.stroke();
        break;
      default: // tin crown
        ctx.beginPath();
        ctx.moveTo(6, 10);
        ctx.lineTo(7, 2);
        ctx.lineTo(11, 6);
        ctx.lineTo(15, 0.8);
        ctx.lineTo(19, 6);
        ctx.lineTo(23, 2);
        ctx.lineTo(24, 10);
        ctx.closePath();
        inked(ctx, h, INK, 2);
        ctx.fillStyle = '#e0484d';
        ctx.beginPath();
        ctx.arc(15, 7, 1.6, 0, Math.PI * 2);
        ctx.fill();
    }
  });
}

/** Torso 22x22, origin centre. colors: [main, accent, boots] */
export function torsoTexture(scene: Phaser.Scene, outfitIdx: number, team: number, teamColor: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main, accent] = c.colors;
  return ensure(scene, `torso:${c.id}:${team}:${teamColor}`, 22, 22, (ctx) => {
    roundRect(ctx, 2, 2, 18, 18, 6);
    inked(ctx, hex(main), INK, 2);
    // shading
    ctx.save();
    roundRect(ctx, 2, 2, 18, 18, 6);
    ctx.clip();
    ctx.fillStyle = hex(shade(main, 0.75));
    ctx.fillRect(2, 13, 18, 8);
    ctx.fillStyle = hex(accent);
    ctx.fillRect(2, 12, 18, 3);
    ctx.fillStyle = hex(0xffd34d);
    ctx.fillRect(9.5, 12, 3, 3);
    if (c.id === 'outfit_candy') {
      ctx.fillStyle = hex(accent, 0.8);
      for (let i = -2; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5, 2);
        ctx.lineTo(i * 5 + 3, 2);
        ctx.lineTo(i * 5 + 13, 20);
        ctx.lineTo(i * 5 + 10, 20);
        ctx.fill();
      }
    }
    ctx.restore();
    // pocket
    roundRect(ctx, 12, 5, 5, 5, 1.5);
    inked(ctx, hex(shade(main, 0.85)), INK, 1.2);
    // team armband
    if (team >= 0) {
      ctx.fillStyle = hex(teamColor);
      roundRect(ctx, 2, 4, 5, 6, 1.5);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  });
}

/** Leg with boot: 9x17, origin at hip (0.5, 0.1). */
export function legTexture(scene: Phaser.Scene, outfitIdx: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main, , boots] = c.colors;
  return ensure(scene, `leg:${c.id}`, 10, 18, (ctx) => {
    roundRect(ctx, 2, 1, 6, 12, 3);
    inked(ctx, hex(shade(main, 0.8)), INK, 2);
    roundRect(ctx, 1, 11, 9, 6, 2.5);
    inked(ctx, hex(boots), INK, 2);
  });
}

/** Arm: 7x13, origin at shoulder (0.5, 0.15). */
export function armTexture(scene: Phaser.Scene, outfitIdx: number): string {
  const c = COSMETICS[outfitIdx] ?? COSMETICS[7];
  const [main] = c.colors;
  return ensure(scene, `arm:${c.id}`, 8, 14, (ctx) => {
    roundRect(ctx, 1.5, 1, 5, 9, 2.5);
    inked(ctx, hex(main), INK, 1.8);
    ctx.beginPath();
    ctx.arc(4, 11, 2.6, 0, Math.PI * 2);
    inked(ctx, hex(SKIN), INK, 1.6);
  });
}

/** Jetpack: 14x22, origin at strap (0.85, 0.35). */
export function jetpackTexture(scene: Phaser.Scene, jetIdx: number): string {
  const c = COSMETICS[jetIdx] ?? COSMETICS[15];
  const [body] = c.colors;
  return ensure(scene, `jet:${c.id}`, 16, 24, (ctx) => {
    const b = hex(body);
    const d = hex(shade(body, 0.7));
    switch (c.variant) {
      case 1: // bubble
        ctx.beginPath();
        ctx.arc(8, 10, 7, 0, Math.PI * 2);
        inked(ctx, b, INK, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(6, 7, 2, 0, Math.PI * 2);
        ctx.fill();
        roundRect(ctx, 5, 16, 6, 6, 2);
        inked(ctx, d, INK, 1.6);
        break;
      case 2: // retro rocket
        ctx.beginPath();
        ctx.moveTo(8, 0.5);
        ctx.quadraticCurveTo(14, 6, 13, 18);
        ctx.lineTo(3, 18);
        ctx.quadraticCurveTo(2, 6, 8, 0.5);
        ctx.closePath();
        inked(ctx, b, INK, 2);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(8, 8, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(3, 13);
        ctx.lineTo(0.5, 21);
        ctx.lineTo(4, 18);
        ctx.closePath();
        inked(ctx, d, INK, 1.4);
        ctx.beginPath();
        ctx.moveTo(13, 13);
        ctx.lineTo(15.5, 21);
        ctx.lineTo(12, 18);
        ctx.closePath();
        inked(ctx, d, INK, 1.4);
        break;
      case 3: // leaf glider
        ctx.beginPath();
        ctx.ellipse(8, 10, 5, 9, 0, 0, Math.PI * 2);
        inked(ctx, b, INK, 2);
        ctx.strokeStyle = hex(shade(body, 0.55));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(8, 2);
        ctx.lineTo(8, 18);
        for (let i = 0; i < 4; i++) {
          ctx.moveTo(8, 5 + i * 3.5);
          ctx.lineTo(4.5, 3 + i * 3.5);
          ctx.moveTo(8, 5 + i * 3.5);
          ctx.lineTo(11.5, 3 + i * 3.5);
        }
        ctx.stroke();
        break;
      case 4: // void engine
        roundRect(ctx, 2, 1, 12, 18, 3);
        inked(ctx, b, INK, 2);
        ctx.fillStyle = hex(c.colors[1]);
        ctx.beginPath();
        ctx.arc(8, 9, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.beginPath();
        ctx.arc(8, 9, 1.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      default: // twin tank
        roundRect(ctx, 1.5, 1, 6, 17, 3);
        inked(ctx, b, INK, 1.8);
        roundRect(ctx, 8.5, 1, 6, 17, 3);
        inked(ctx, b, INK, 1.8);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(3, 3, 1.5, 10);
        ctx.fillRect(10, 3, 1.5, 10);
        roundRect(ctx, 3, 17, 10, 4, 1);
        inked(ctx, d, INK, 1.4);
    }
  });
}

/** Gun silhouettes, drawn pointing right with the grip at (gx, gy). Light grey body so skins can tint them. */
export interface GunArt {
  key: string;
  w: number;
  h: number;
  gripX: number;
  gripY: number;
  muzzleX: number;
  muzzleY: number;
}

const GUN_SHAPES: Record<string, { w: number; h: number; gx: number; gy: number; mx: number; my: number; draw: (ctx: CanvasRenderingContext2D, body: string, dark: string, accent: string) => void }> = {
  sparrow: {
    w: 18, h: 10, gx: 5, gy: 6, mx: 17, my: 3,
    draw: (ctx, b, d) => {
      roundRect(ctx, 2, 1.5, 15, 4.5, 1.5); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 3, 4.5, 4.5, 5, 1.5); inked(ctx, d, INK, 1.6);
    },
  },
  thunderclap: {
    w: 24, h: 11, gx: 5, gy: 7, mx: 23, my: 3.5,
    draw: (ctx, b, d) => {
      roundRect(ctx, 6, 2, 17, 3.5, 1); inked(ctx, b, INK, 1.6);
      ctx.beginPath(); ctx.arc(9, 5, 3.5, 0, Math.PI * 2); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 2, 5, 5, 6, 2); inked(ctx, d, INK, 1.6);
    },
  },
  hornet: {
    w: 24, h: 13, gx: 8, gy: 7, mx: 23, my: 4,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 3, 1.5, 19, 6, 2); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 11, 6, 4, 7, 1); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 5, 6, 4, 5, 1.5); inked(ctx, d, INK, 1.6);
      ctx.fillStyle = a; ctx.fillRect(4, 3, 5, 1.6);
    },
  },
  kestrel: {
    w: 34, h: 13, gx: 12, gy: 7, mx: 33, my: 3.5,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 1, 2.5, 9, 5, 1.5); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 8, 1.5, 19, 6, 1.5); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 26, 2.5, 7, 2.5, 1); inked(ctx, d, INK, 1.4);
      ctx.beginPath(); ctx.moveTo(16, 7); ctx.lineTo(20, 7); ctx.lineTo(18, 13); ctx.lineTo(15, 12); ctx.closePath(); inked(ctx, d, INK, 1.6);
      ctx.fillStyle = a; ctx.fillRect(12, 3, 8, 1.4);
    },
  },
  triplet: {
    w: 30, h: 13, gx: 13, gy: 7, mx: 29, my: 3.5,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 2, 1.5, 24, 7, 3); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 24, 2.5, 5, 2.5, 1); inked(ctx, d, INK, 1.4);
      roundRect(ctx, 5, 7, 5, 6, 1.5); inked(ctx, d, INK, 1.6);
      for (let i = 0; i < 3; i++) { ctx.fillStyle = a; ctx.fillRect(14 + i * 3, 3, 2, 2); }
    },
  },
  mule: {
    w: 32, h: 12, gx: 10, gy: 7, mx: 31, my: 4,
    draw: (ctx, b, d) => {
      roundRect(ctx, 1, 3, 9, 6, 2); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 9, 1.5, 22, 3.5, 1); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 9, 4.5, 22, 3, 1); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 16, 7, 8, 3.5, 1.5); inked(ctx, d, INK, 1.4);
    },
  },
  heron: {
    w: 44, h: 13, gx: 13, gy: 7, mx: 43, my: 4,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 1, 3, 11, 5, 1.5); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 10, 2.5, 18, 5, 1.5); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 27, 3, 16, 2.4, 1); inked(ctx, b, INK, 1.4);
      roundRect(ctx, 13, 0, 10, 3, 1.5); inked(ctx, a, INK, 1.4);
      roundRect(ctx, 16, 7, 3.5, 6, 1); inked(ctx, d, INK, 1.4);
    },
  },
  grizzly: {
    w: 38, h: 16, gx: 13, gy: 8, mx: 37, my: 4,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 1, 3, 10, 6, 2); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 9, 1.5, 21, 8, 2); inked(ctx, b, INK, 1.6);
      roundRect(ctx, 29, 3, 8, 3, 1); inked(ctx, d, INK, 1.4);
      roundRect(ctx, 15, 9, 9, 7, 2); inked(ctx, a, INK, 1.6);
    },
  },
  comet: {
    w: 42, h: 15, gx: 16, gy: 9, mx: 41, my: 6,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 2, 2, 38, 8, 4); inked(ctx, b, INK, 1.8);
      roundRect(ctx, 34, 1, 7, 10, 2); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 0.5, 1, 5, 10, 2); inked(ctx, d, INK, 1.6);
      ctx.fillStyle = a; ctx.fillRect(12, 4, 14, 2);
      roundRect(ctx, 14, 9, 4, 6, 1); inked(ctx, d, INK, 1.4);
    },
  },
  popper: {
    w: 32, h: 16, gx: 11, gy: 9, mx: 31, my: 5,
    draw: (ctx, b, d) => {
      roundRect(ctx, 14, 2, 17, 6, 2); inked(ctx, b, INK, 1.6);
      ctx.beginPath(); ctx.arc(12, 7, 6, 0, Math.PI * 2); inked(ctx, d, INK, 1.8);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(12 + Math.cos(i) * 3.4, 7 + Math.sin(i) * 3.4, 0.9, 0, 7); ctx.fill(); }
      roundRect(ctx, 1, 5, 6, 5, 2); inked(ctx, d, INK, 1.4);
    },
  },
  torchie: {
    w: 36, h: 16, gx: 12, gy: 9, mx: 35, my: 4,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 1, 4, 10, 11, 4); inked(ctx, a, INK, 1.6);
      roundRect(ctx, 10, 2, 18, 5, 2); inked(ctx, b, INK, 1.6);
      ctx.beginPath(); ctx.moveTo(27, 1.5); ctx.lineTo(35, 0.5); ctx.lineTo(35, 8); ctx.lineTo(27, 7.5); ctx.closePath(); inked(ctx, d, INK, 1.6);
    },
  },
  zapline: {
    w: 40, h: 14, gx: 13, gy: 8, mx: 39, my: 5,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 1, 3, 10, 6, 2); inked(ctx, d, INK, 1.6);
      roundRect(ctx, 9, 2, 30, 6, 2); inked(ctx, b, INK, 1.6);
      for (let i = 0; i < 4; i++) { roundRect(ctx, 15 + i * 5, 1, 3, 8, 1); inked(ctx, a, INK, 1.2); }
      roundRect(ctx, 14, 8, 4, 6, 1); inked(ctx, d, INK, 1.4);
    },
  },
  buzzsaw: {
    w: 34, h: 16, gx: 12, gy: 9, mx: 32, my: 6,
    draw: (ctx, b, d, a) => {
      roundRect(ctx, 2, 3, 22, 7, 2); inked(ctx, b, INK, 1.6);
      ctx.beginPath(); ctx.arc(27, 6, 6, 0, Math.PI * 2); inked(ctx, a, INK, 1.6);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(27, 6, 1.6, 0, 7); ctx.fill();
      roundRect(ctx, 9, 9, 4, 6, 1); inked(ctx, d, INK, 1.4);
    },
  },
};

export function gunArt(scene: Phaser.Scene, wi: number, skinIdx: number): GunArt {
  const def = WEAPONS[wi] ?? WEAPONS[0];
  const shape = GUN_SHAPES[def.id] ?? GUN_SHAPES.sparrow;
  const skin = COSMETICS[skinIdx] ?? COSMETICS[20];
  const [body, dark] = skin.colors;
  const key = ensure(scene, `gun:${def.id}:${skin.id}`, shape.w, shape.h, (ctx) => shape.draw(ctx, hex(body === 0x3a3f48 ? 0x8a919c : body), hex(dark === 0x8a919c ? 0x3a3f48 : dark), hex(def.tracer)));
  return { key, w: shape.w, h: shape.h, gripX: shape.gx, gripY: shape.gy, muzzleX: shape.mx, muzzleY: shape.my };
}

/** Icon versions of weapons for the HUD (plain factory skin, larger). */
export function weaponIcon(scene: Phaser.Scene, wi: number): string {
  return gunArt(scene, wi, COSMETICS.findIndex((c) => c.id === 'skin_none')).key;
}
