export type CosmeticCategory = 'head' | 'outfit' | 'jetpack' | 'skin' | 'emote' | 'pose';

export interface CosmeticDef {
  id: string;
  category: CosmeticCategory;
  name: string;
  /** Player level that unlocks it for free. */
  unlockLevel: number;
  /** Soft-currency price (Sparks) to unlock early; 0 = level unlock only. */
  price: number;
  /** Rendering parameters, interpreted by the client art code. */
  colors: number[];
  variant: number;
}

const c = (
  id: string,
  category: CosmeticCategory,
  name: string,
  unlockLevel: number,
  price: number,
  colors: number[],
  variant = 0,
): CosmeticDef => ({ id, category, name, unlockLevel, price, colors, variant });

export const COSMETICS: readonly CosmeticDef[] = [
  // Heads: variant selects the helmet/hair silhouette drawn by the client.
  c('head_cadet', 'head', 'Cadet Cap', 1, 0, [0x2f3b52, 0xf2c79b], 0),
  c('head_visor', 'head', 'Flight Visor', 1, 0, [0x384a6b, 0x6ff0ff], 1),
  c('head_beanie', 'head', 'Bobble Beanie', 3, 150, [0xe25d4a, 0xf2c79b], 2),
  c('head_mohawk', 'head', 'Spike Crest', 5, 250, [0x9a5cff, 0xd9a274], 3),
  c('head_dome', 'head', 'Diver Dome', 8, 400, [0x8fd6ff, 0xf2c79b], 4),
  c('head_horns', 'head', 'Ram Helm', 12, 600, [0xb3a17a, 0x8a6a4a], 5),
  c('head_crown', 'head', 'Tin Crown', 20, 1200, [0xffd34d, 0xf2c79b], 6),
  // Outfits: [main, accent, boots]
  c('outfit_field', 'outfit', 'Field Fatigues', 1, 0, [0x5c7a3a, 0x3d5226, 0x2b2b2b]),
  c('outfit_navy', 'outfit', 'Night Navy', 1, 0, [0x34508f, 0x22355f, 0x1d1d26]),
  c('outfit_sunset', 'outfit', 'Sunset Racer', 2, 120, [0xff7a45, 0xffc145, 0x3a2420]),
  c('outfit_arctic', 'outfit', 'Arctic Shell', 4, 200, [0xe9f1f7, 0x8fb6d1, 0x4a5a66]),
  c('outfit_toxic', 'outfit', 'Toxic Suit', 6, 300, [0xb6e34a, 0x3c4a1e, 0x1e2610]),
  c('outfit_royal', 'outfit', 'Royal Plum', 9, 450, [0x7a3fb0, 0xffd34d, 0x2a1838]),
  c('outfit_candy', 'outfit', 'Candy Stripe', 14, 700, [0xff7ab8, 0xffffff, 0x5a2a46]),
  c('outfit_chrome', 'outfit', 'Chrome Plate', 25, 1500, [0xc6ced8, 0x7d8896, 0x30363f]),
  // Jetpacks: variant = shape, colors = [body, flame]
  c('jet_standard', 'jetpack', 'Twin Tank', 1, 0, [0x7d8896, 0xffa53d], 0),
  c('jet_bubble', 'jetpack', 'Bubble Pack', 3, 150, [0x5ad1ff, 0x9ff3ff], 1),
  c('jet_rocket', 'jetpack', 'Retro Rocket', 7, 350, [0xd94848, 0xffd34d], 2),
  c('jet_leaf', 'jetpack', 'Leaf Glider', 11, 550, [0x5fae4a, 0xc8ff7a], 3),
  c('jet_void', 'jetpack', 'Void Engine', 18, 1000, [0x30264a, 0xc07bff], 4),
  // Weapon skins: tint applied to gun bodies
  c('skin_none', 'skin', 'Factory', 1, 0, [0x3a3f48, 0x8a919c]),
  c('skin_desert', 'skin', 'Dune', 4, 200, [0xc9a66b, 0x7a5f36]),
  c('skin_jade', 'skin', 'Jade', 8, 400, [0x3fae8a, 0x1d5e4a]),
  c('skin_magma', 'skin', 'Magma', 13, 650, [0xd9482b, 0x3a1410]),
  c('skin_gold', 'skin', 'Gilded', 22, 1400, [0xffd34d, 0xa8801f]),
  // Emotes (shown as a bubble icon above the player)
  c('emote_wave', 'emote', 'Wave', 1, 0, [0xffffff], 0),
  c('emote_laugh', 'emote', 'Ha-ha', 1, 0, [0xffffff], 1),
  c('emote_gg', 'emote', 'GG', 1, 0, [0xffffff], 2),
  c('emote_angry', 'emote', 'Grr', 2, 80, [0xffffff], 3),
  c('emote_heart', 'emote', 'Heart', 5, 200, [0xffffff], 4),
  c('emote_cool', 'emote', 'Shades', 10, 400, [0xffffff], 5),
  // Victory poses
  c('pose_salute', 'pose', 'Salute', 1, 0, [0xffffff], 0),
  c('pose_flex', 'pose', 'Flex', 6, 300, [0xffffff], 1),
  c('pose_spin', 'pose', 'Jet Spin', 15, 800, [0xffffff], 2),
];

export function cosmeticsBy(category: CosmeticCategory): CosmeticDef[] {
  return COSMETICS.filter((x) => x.category === category);
}

export function cosmeticIndex(id: string): number {
  return Math.max(0, COSMETICS.findIndex((x) => x.id === id));
}

export interface Loadout {
  head: string;
  outfit: string;
  jetpack: string;
  skin: string;
  emote: string;
  pose: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  head: 'head_cadet',
  outfit: 'outfit_field',
  jetpack: 'jet_standard',
  skin: 'skin_none',
  emote: 'emote_wave',
  pose: 'pose_salute',
};

/** Quick-chat presets (no free text at launch). */
export const QUICK_CHAT: readonly string[] = [
  'chat.hello',
  'chat.gg',
  'chat.nice',
  'chat.help',
  'chat.follow',
  'chat.defend',
  'chat.attack',
  'chat.oops',
];

export const EMOTE_COUNT = 6;
