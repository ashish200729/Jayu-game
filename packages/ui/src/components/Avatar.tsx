import { useEffect, useRef } from 'react';
import { COSMETICS, weaponIndex, type Loadout } from '@game/content';
import { CHAR_SCALE, armTexture, gunArt, headTexture, jetpackTexture, legTexture, torsoTexture } from '@game/client/art';

/** Texture sink that mimics the bits of Phaser's texture manager the art code uses. */
const cache = new Map<string, HTMLCanvasElement>();
const fakeScene = {
  textures: {
    exists: (k: string) => cache.has(k),
    addCanvas: (k: string, c: HTMLCanvasElement) => {
      cache.set(k, c);
      return null;
    },
  },
} as unknown as Parameters<typeof headTexture>[0];

const idx = (id: string) => Math.max(0, COSMETICS.findIndex((c) => c.id === id));

/**
 * Live 2D preview of a character with a loadout, drawn with the same procedural art as the game.
 * `pose`: idle | salute | flex | spin (victory poses).
 */
export function Avatar({ loadout, size = 220, pose = 'idle', team = -1, teamColor = 0xff5a4f, weapon = 'kestrel', animate = true, className = '' }: { loadout: Loadout; size?: number; pose?: string; team?: number; teamColor?: number; weapon?: string; animate?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d')!;
    const head = cache.get(headTexture(fakeScene, idx(loadout.head)))!;
    const torso = cache.get(torsoTexture(fakeScene, idx(loadout.outfit), team, teamColor))!;
    const leg = cache.get(legTexture(fakeScene, idx(loadout.outfit)))!;
    const arm = cache.get(armTexture(fakeScene, idx(loadout.outfit)))!;
    const jet = cache.get(jetpackTexture(fakeScene, idx(loadout.jetpack)))!;
    const gun = gunArt(fakeScene, weaponIndex(weapon), idx(loadout.skin));
    const gunC = cache.get(gun.key)!;
    const flameCol = COSMETICS[idx(loadout.jetpack)]?.colors[1] ?? 0xffa53d;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      // World units: character is ~60px tall; scale to fit.
      const s = (size * dpr) / 80;
      g.setTransform(s, 0, 0, s, c.width / 2, c.height * 0.86);
      const bob = animate ? Math.sin(t * 2.2) * 1.2 : 0;
      const spin = pose === 'spin' && animate ? Math.sin(t * 3) : 1;
      g.scale(spin === 0 ? 0.01 : spin, 1);
      // soft contact shadow
      const sh = g.createRadialGradient(0, 1, 0, 0, 1, 18);
      sh.addColorStop(0, 'rgba(0,0,0,0.45)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.save();
      g.scale(1, 0.22);
      g.beginPath();
      g.arc(0, 4.5, 18, 0, Math.PI * 2);
      g.fill();
      g.restore();
      const img = (cv: HTMLCanvasElement, x: number, y: number, ox: number, oy: number, rot = 0) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.drawImage(cv, -ox * (cv.width / CHAR_SCALE), -oy * (cv.height / CHAR_SCALE), cv.width / CHAR_SCALE, cv.height / CHAR_SCALE);
        g.restore();
      };
      const torsoY = -28 + bob;
      // flame
      if (animate && pose !== 'salute') {
        const fl = 9 + Math.random() * 5;
        const r = (flameCol >> 16) & 255;
        const gg = (flameCol >> 8) & 255;
        const b = flameCol & 255;
        const fx = -11.6;
        const fy = torsoY + 9;
        g.save();
        g.globalCompositeOperation = 'lighter';
        const glow = g.createRadialGradient(fx, fy + 6, 0, fx, fy + 6, 14);
        glow.addColorStop(0, `rgba(${r},${gg},${b},0.45)`);
        glow.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = glow;
        g.fillRect(fx - 14, fy - 8, 28, 28);
        const plume = (w: number, len: number, col: string) => {
          const grd = g.createLinearGradient(0, fy, 0, fy + len);
          grd.addColorStop(0, col.replace('A', '1'));
          grd.addColorStop(0.6, col.replace('A', '0.5'));
          grd.addColorStop(1, col.replace('A', '0'));
          g.fillStyle = grd;
          g.beginPath();
          g.moveTo(fx, fy);
          g.bezierCurveTo(fx + w, fy + len * 0.08, fx + w * 0.45, fy + len * 0.5, fx, fy + len);
          g.bezierCurveTo(fx - w * 0.45, fy + len * 0.5, fx - w, fy + len * 0.08, fx, fy);
          g.fill();
        };
        plume(4.6, fl * 1.5, `rgba(${r},${gg},${b},A)`);
        plume(2.4, fl * 0.8, 'rgba(255,250,225,A)');
        g.restore();
      }
      img(jet, -7, torsoY - 4, 0.85, 0.3);
      img(leg, -3, -17 + bob * 0.3, 0.5, 0.1, -0.05);
      const armRot = pose === 'salute' ? -2.4 : pose === 'flex' ? -2.0 + Math.sin(t * 4) * 0.2 : -0.3;
      img(arm, -3, torsoY - 2, 0.5, 0.15, pose === 'flex' ? 2.2 : 0.3);
      img(torso, 0, torsoY, 0.5, 0.5);
      img(leg, 3, -17 + bob * 0.3, 0.5, 0.1, 0.05);
      img(head, 1, torsoY - 8, 0.5, 0.82, pose === 'salute' ? -0.1 : Math.sin(t * 1.3) * 0.06);
      if (pose === 'idle') {
        g.save();
        g.translate(0, torsoY);
        g.rotate(-0.12);
        g.drawImage(gunC, 9 - gun.gripX, -gun.gripY, gun.w, gun.h);
        g.restore();
      }
      img(arm, 2, torsoY - 2, 0.5, 0.15, armRot);
      if (animate) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loadout, size, pose, team, teamColor, weapon, animate]);
  return <canvas ref={ref} style={{ width: size, height: size }} className={className} aria-hidden="true" />;
}
