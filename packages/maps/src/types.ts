export const Tile = {
  Empty: 0,
  Solid: 1,
  OneWay: 2,
  Lava: 3,
  Water: 4,
  Ice: 5,
  Vine: 6,
  Vent: 7,
  LowGrav: 8,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export const TILE_NAMES = ['empty', 'solid', 'oneway', 'lava', 'water', 'ice', 'vine', 'vent', 'lowgrav'] as const;

export type ObjectKind =
  | 'spawn'
  | 'flag'
  | 'hill'
  | 'weapon'
  | 'heavy'
  | 'health'
  | 'grenade'
  | 'dual'
  | 'checkpoint'
  | 'target';

export interface MapObject {
  kind: ObjectKind;
  /** World position in pixels: the bottom-centre of the tile the object was placed in. */
  x: number;
  y: number;
  /** 0 red, 1 blue, -1 neutral. */
  team: number;
  /** Order index (checkpoints, targets). */
  index: number;
}

export type MoverKind = 'door' | 'bridge' | 'platform';

export interface Mover {
  kind: MoverKind;
  /** Rect in pixels at phase 0. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cycle length in seconds. */
  period: number;
  /** Doors: seconds open per cycle. Bridges: seconds collapsed per cycle. */
  openTime: number;
  /** Phase offset in seconds. */
  phase: number;
  /** Platforms: travel offset in pixels (sinusoidal-ish ping-pong). */
  dx: number;
  dy: number;
}

export type Backdrop =
  | 'city'
  | 'jungle'
  | 'snow'
  | 'desert'
  | 'space'
  | 'harbor'
  | 'lab'
  | 'volcano'
  | 'fortress'
  | 'training';

export type Weather = 'none' | 'snow' | 'sand' | 'rain' | 'embers' | 'dust' | 'spores';

export interface MapTheme {
  backdrop: Backdrop;
  skyTop: number;
  skyBottom: number;
  far: number;
  mid: number;
  near: number;
  solid: number;
  solidDark: number;
  rim: number;
  accent: number;
  weather: Weather;
  /** Dark map: lit by muzzle flashes and lamps. */
  dark: boolean;
  /** Index into the generative music beds. */
  music: number;
}

export interface MapData {
  id: string;
  name: string;
  description: string;
  feature: string;
  width: number;
  height: number;
  tiles: Uint8Array;
  objects: MapObject[];
  movers: Mover[];
  theme: MapTheme;
  weaponPool: string[];
  heavyPool: string[];
  recommended: [number, number];
}

export interface MapSource {
  id: string;
  name: string;
  description: string;
  feature: string;
  theme: MapTheme;
  recommended: [number, number];
  weapons?: string[];
  heavies?: string[];
  door?: { period: number; open: number };
  bridge?: { period: number; down: number };
  /** One entry per moving platform, in reading order of their left-most 'P' tile. */
  platforms?: { dx: number; dy: number; period: number }[];
  rows: string[];
}
