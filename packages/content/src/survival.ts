export type UpgradeId = 'damage' | 'health' | 'fuel' | 'reload' | 'grenades' | 'speed';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'damage', name: 'Hot Rounds', description: '+15% weapon damage' },
  { id: 'health', name: 'Thick Plating', description: '+25 max health' },
  { id: 'fuel', name: 'Big Tanks', description: '+30% jetpack fuel' },
  { id: 'reload', name: 'Quick Hands', description: '25% faster reloads' },
  { id: 'grenades', name: 'Bandolier', description: 'Refill grenades now' },
  { id: 'speed', name: 'Light Boots', description: '+10% run speed' },
];

export interface WaveSpec {
  count: number;
  maxAlive: number;
  hpMult: number;
  damageMult: number;
  difficulty: 0 | 1 | 2;
  weapons: string[];
}

/** Wave n (1-based) composition. Grows steadily; caps keep the sim within its entity budget. */
export function waveSpec(n: number, humans: number): WaveSpec {
  const count = Math.min(40, 3 + n * 2 + Math.max(0, humans - 1) * 2);
  const pool = ['hornet', 'kestrel', 'mule', 'triplet', 'grizzly', 'heron'];
  return {
    count,
    maxAlive: Math.min(10, 3 + Math.floor(n / 2) + humans),
    hpMult: 0.6 + n * 0.08,
    damageMult: Math.min(1, 0.45 + n * 0.05),
    difficulty: n < 4 ? 0 : n < 8 ? 1 : 2,
    weapons: pool.slice(0, Math.min(pool.length, 1 + Math.floor(n / 2))),
  };
}

/** The three upgrade choices offered after wave n. */
export function upgradeChoices(n: number): UpgradeId[] {
  const ids = UPGRADES.map((u) => u.id);
  const out: UpgradeId[] = [];
  for (let i = 0; i < 3; i++) out.push(ids[(n * 2 + i * 3) % ids.length]);
  return out;
}
