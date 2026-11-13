import { WEAPONS } from './weapons';
import { GRENADES } from './grenades';
import { COSMETICS } from './cosmetics';
import { MODES } from './modes';

/** Validates all content records. Called at startup by every host and by the test suite. */
export function validateContent(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const w of WEAPONS) {
    if (ids.has(w.id)) errors.push(`duplicate weapon id ${w.id}`);
    ids.add(w.id);
    if (w.fireInterval <= 0) errors.push(`${w.id}: fireInterval must be > 0`);
    if (w.magSize <= 0) errors.push(`${w.id}: magSize must be > 0`);
    if (w.range <= 0) errors.push(`${w.id}: range must be > 0`);
    if ((w.kind === 'projectile' || w.kind === 'flame') && !w.projectile) errors.push(`${w.id}: needs projectile spec`);
    if (w.kind === 'hitscan' && w.damage <= 0) errors.push(`${w.id}: hitscan damage must be > 0`);
    if (w.burst < 1) errors.push(`${w.id}: burst must be >= 1`);
    if (w.burst > 1 && w.burst * w.burstInterval >= w.fireInterval) errors.push(`${w.id}: burst longer than fire interval`);
  }
  if (!WEAPONS.some((w) => w.slot === 'sidearm' && w.reserve === -1)) errors.push('need an infinite-ammo sidearm');
  for (const g of GRENADES) {
    if (g.fuse <= 0) errors.push(`${g.id}: fuse must be > 0`);
    if (g.radius <= 0 && g.cloudRadius <= 0) errors.push(`${g.id}: needs a blast or a cloud`);
  }
  const cos = new Set<string>();
  for (const c of COSMETICS) {
    if (cos.has(c.id)) errors.push(`duplicate cosmetic ${c.id}`);
    cos.add(c.id);
  }
  for (const cat of ['head', 'outfit', 'jetpack', 'skin', 'emote', 'pose'] as const) {
    if (!COSMETICS.some((c) => c.category === cat && c.unlockLevel <= 1)) errors.push(`no default ${cat}`);
  }
  if (MODES.length !== 8) errors.push('expected 8 modes');
  return errors;
}
