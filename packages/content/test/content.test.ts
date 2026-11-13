import { describe, expect, it } from 'vitest';
import { MODES, WEAPONS, validateContent, waveSpec, upgradeChoices } from '@game/content';

describe('content', () => {
  it('validates', () => expect(validateContent()).toEqual([]));
  it('has all weapon slots', () => {
    for (const s of ['sidearm', 'primary', 'heavy']) expect(WEAPONS.some((w) => w.slot === s)).toBe(true);
    expect(MODES.length).toBe(8);
  });
  it('waves grow and offer 3 upgrades', () => {
    expect(waveSpec(5, 1).count).toBeGreaterThan(waveSpec(1, 1).count);
    expect(upgradeChoices(3)).toHaveLength(3);
  });
  it('uses no names from other games', () => {
    const banned = /mini ?militia|doodle ?army|miniclip|appsomniacs|ak-?47|m4a1|uzi|desert eagle|spas/i;
    for (const w of WEAPONS) expect(banned.test(w.name)).toBe(false);
  });
});
