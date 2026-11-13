import { useEffect, useRef } from 'react';
import { COSMETICS, weaponIndex, type Loadout } from '@game/content';
import { armTexture, gunArt, headTexture, jetpackTexture, legTexture, torsoTexture } from '@game/client/art';

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
      const spin = pose === 'spin' ? Math.sin(t * 3) : 1;
      g.scale(spin === 0 ? 0.01 : spin, 1);
      // shadow
      g.fillStyle = 'rgba(0,0,0,0.3)';
      g.beginPath();
      g.ellipse(0, 1, 16, 3.5, 0, 0, Math.PI * 2);
      g.fill();
      const img = (cv: HTMLCanvasElement, x: number, y: number, ox: number, oy: number, rot = 0) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.drawImage(cv, -ox * (cv.width / 2), -oy * (cv.height / 2), cv.width / 2, cv.height / 2);
        g.restore();
      };
      const torsoY = -28 + bob;
      // flame
      if (animate && pose !== 'salute') {
        const fl = 6 + Math.random() * 5;
        const grd = g.createRadialGradient(-12, torsoY + 10, 0, -12, torsoY + 10 + fl, fl + 4);
        const r = (flameCol >> 16) & 255;
        const gg = (flameCol >> 8) & 255;
        const b = flameCol & 255;
        grd.addColorStop(0, `rgba(255,255,255,0.9)`);
        grd.addColorStop(0.4, `rgba(${r},${gg},${b},0.8)`);
        grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        g.fillStyle = grd;
        g.beginPath();
        g.ellipse(-12, torsoY + 12 + fl / 2, 4, fl, 0, 0, Math.PI * 2);
        g.fill();
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
        g.drawImage(gunC, 9 - gun.gripX / 2, -gun.gripY / 2, gun.w / 2, gun.h / 2);
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
