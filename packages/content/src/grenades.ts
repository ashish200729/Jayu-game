export type GrenadeKind = 'frag' | 'sticky' | 'mine' | 'smoke' | 'gas';

export interface GrenadeDef {
  id: GrenadeKind;
  name: string;
  fuse: number;
  radius: number;
  damage: number;
  knockback: number;
  bounce: number;
  sticky: boolean;
  /** Mines arm after this many seconds and trigger on an enemy within triggerRadius. */
  armTime: number;
  triggerRadius: number;
  /** Lingering cloud (smoke/gas). */
  cloudRadius: number;
  cloudTime: number;
  cloudDps: number;
  color: number;
}

export const GRENADES: readonly GrenadeDef[] = [
  { id: 'frag', name: 'Frag', fuse: 2.2, radius: 120, damage: 100, knockback: 800, bounce: 0.45, sticky: false, armTime: 0, triggerRadius: 0, cloudRadius: 0, cloudTime: 0, cloudDps: 0, color: 0x6f8f3a },
  { id: 'sticky', name: 'Sticky', fuse: 1.8, radius: 100, damage: 95, knockback: 700, bounce: 0, sticky: true, armTime: 0, triggerRadius: 0, cloudRadius: 0, cloudTime: 0, cloudDps: 0, color: 0x3fd0c9 },
  { id: 'mine', name: 'Prox Mine', fuse: 30, radius: 105, damage: 90, knockback: 700, bounce: 0.1, sticky: true, armTime: 1.0, triggerRadius: 56, cloudRadius: 0, cloudTime: 0, cloudDps: 0, color: 0xe0484d },
  { id: 'smoke', name: 'Smoke', fuse: 1.4, radius: 0, damage: 0, knockback: 0, bounce: 0.4, sticky: false, armTime: 0, triggerRadius: 0, cloudRadius: 150, cloudTime: 9, cloudDps: 0, color: 0xc8ccd6 },
  { id: 'gas', name: 'Gas', fuse: 1.4, radius: 0, damage: 0, knockback: 0, bounce: 0.4, sticky: false, armTime: 0, triggerRadius: 0, cloudRadius: 110, cloudTime: 6, cloudDps: 14, color: 0xa6e04a },
];

export function grenadeIndex(id: GrenadeKind): number {
  const i = GRENADES.findIndex((g) => g.id === id);
  if (i < 0) throw new Error(`Unknown grenade ${id}`);
  return i;
}
