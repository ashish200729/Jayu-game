import { TILE } from '@game/content';
import { Tile, TILE_NAMES, type MapData, type MapObject, type MapSource, type Mover, type ObjectKind } from './types';

/**
 * ASCII authoring legend (one character per 32 px tile):
 *   .  empty           #  solid            =  one-way platform   _  ice (solid, slippery)
 *   ~  water           ^  lava (death)     |  vine (slow fall)   *  heat vent (lift + refuel)
 *   o  low-gravity     D  timed door       B  collapsing bridge  P  moving platform
 *   S  spawn           1  red spawn        2  blue spawn
 *   R  red flag        U  blue flag        H  hill zone marker
 *   W  weapon spawner  X  heavy spawner    +  health pack        g  grenade box   d  dual-wield
 *   C  course checkpoint (training)        T  target dummy spot (training)
 * Object characters sit in an empty cell.
 */
const TILE_CHARS: Record<string, number> = {
  '.': Tile.Empty,
  '#': Tile.Solid,
  '=': Tile.OneWay,
  _: Tile.Ice,
  '~': Tile.Water,
  '^': Tile.Lava,
  '|': Tile.Vine,
  '*': Tile.Vent,
  o: Tile.LowGrav,
};

const OBJECT_CHARS: Record<string, { kind: ObjectKind; team: number }> = {
  S: { kind: 'spawn', team: -1 },
  '1': { kind: 'spawn', team: 0 },
  '2': { kind: 'spawn', team: 1 },
  R: { kind: 'flag', team: 0 },
  U: { kind: 'flag', team: 1 },
  H: { kind: 'hill', team: -1 },
  W: { kind: 'weapon', team: -1 },
  X: { kind: 'heavy', team: -1 },
  '+': { kind: 'health', team: -1 },
  g: { kind: 'grenade', team: -1 },
  d: { kind: 'dual', team: -1 },
  C: { kind: 'checkpoint', team: -1 },
  T: { kind: 'target', team: -1 },
};

export const DEFAULT_WEAPON_POOL = ['thunderclap', 'hornet', 'kestrel', 'triplet', 'mule', 'heron', 'grizzly'];
export const DEFAULT_HEAVY_POOL = ['comet', 'popper', 'torchie', 'zapline', 'buzzsaw'];

export function compileSource(src: MapSource): MapData {
  const rows = src.rows;
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  for (let y = 0; y < height; y++) {
    if (rows[y].length !== width) {
      throw new Error(`${src.id}: row ${y} has length ${rows[y].length}, expected ${width}`);
    }
  }
  const tiles = new Uint8Array(width * height);
  const objects: MapObject[] = [];
  const special: string[] = new Array(width * height).fill('');
  let checkpoint = 0;
  let target = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x];
      const t = TILE_CHARS[ch];
      if (t !== undefined) {
        tiles[y * width + x] = t;
        continue;
      }
      const o = OBJECT_CHARS[ch];
      if (o) {
        tiles[y * width + x] = Tile.Empty;
        const index = o.kind === 'checkpoint' ? checkpoint++ : o.kind === 'target' ? target++ : 0;
        objects.push({ kind: o.kind, team: o.team, index, x: x * TILE + TILE / 2, y: (y + 1) * TILE });
        continue;
      }
      if (ch === 'D' || ch === 'B' || ch === 'P') {
        tiles[y * width + x] = Tile.Empty;
        special[y * width + x] = ch;
        continue;
      }
      throw new Error(`${src.id}: unknown character '${ch}' at ${x},${y}`);
    }
  }
  const movers: Mover[] = [];
  const seen = new Uint8Array(width * height);
  let platformIdx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const ch = special[i];
      if (!ch || seen[i]) continue;
      // Rectangular component: extend right, then down.
      let w = 0;
      while (x + w < width && special[y * width + x + w] === ch && !seen[y * width + x + w]) w++;
      let h = 0;
      outer: while (y + h < height) {
        for (let k = 0; k < w; k++) if (special[(y + h) * width + x + k] !== ch) break outer;
        h++;
      }
      for (let yy = 0; yy < h; yy++) for (let k = 0; k < w; k++) seen[(y + yy) * width + x + k] = 1;
      const rect = { x: x * TILE, y: y * TILE, w: w * TILE, h: h * TILE };
      // Phase depends on distance from the vertical centre line so mirrored pairs stay in sync (fair halves).
      const centreDist = Math.floor(Math.abs(x + w / 2 - width / 2));
      if (ch === 'D') {
        const d = src.door ?? { period: 8, open: 4 };
        movers.push({ kind: 'door', ...rect, period: d.period, openTime: d.open, phase: (centreDist % 2) * (d.period / 2), dx: 0, dy: 0 });
      } else if (ch === 'B') {
        const b = src.bridge ?? { period: 14, down: 4 };
        movers.push({ kind: 'bridge', ...rect, period: b.period, openTime: b.down, phase: (centreDist * 1.7) % b.period, dx: 0, dy: 0 });
      } else {
        const p = src.platforms?.[platformIdx++] ?? { dx: 0, dy: -4 * TILE, period: 8 };
        movers.push({ kind: 'platform', ...rect, period: p.period, openTime: 0, phase: 0, dx: p.dx, dy: p.dy });
      }
    }
  }
  return {
    id: src.id,
    name: src.name,
    description: src.description,
    feature: src.feature,
    width,
    height,
    tiles,
    objects,
    movers,
    theme: src.theme,
    weaponPool: src.weapons ?? DEFAULT_WEAPON_POOL,
    heavyPool: src.heavies ?? DEFAULT_HEAVY_POOL,
    recommended: src.recommended,
  };
}

/** Serialises compiled map data to a Tiled 1.10 JSON map (.tmj) that the Tiled editor can open. */
export function toTmj(map: MapData): object {
  let nextId = 1;
  const objects = [
    ...map.objects.map((o) => ({
      id: nextId++,
      name: o.kind,
      type: o.kind,
      x: o.x,
      y: o.y,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
      properties: [
        { name: 'team', type: 'int', value: o.team },
        { name: 'index', type: 'int', value: o.index },
      ],
    })),
    ...map.movers.map((m) => ({
      id: nextId++,
      name: m.kind,
      type: m.kind,
      x: m.x,
      y: m.y,
      width: m.w,
      height: m.h,
      rotation: 0,
      visible: true,
      properties: [
        { name: 'period', type: 'float', value: m.period },
        { name: 'openTime', type: 'float', value: m.openTime },
        { name: 'phase', type: 'float', value: m.phase },
        { name: 'dx', type: 'float', value: m.dx },
        { name: 'dy', type: 'float', value: m.dy },
      ],
    })),
  ];
  return {
    type: 'map',
    version: '1.10',
    tiledversion: '1.11.2',
    orientation: 'orthogonal',
    renderorder: 'right-down',
    infinite: false,
    width: map.width,
    height: map.height,
    tilewidth: TILE,
    tileheight: TILE,
    nextlayerid: 3,
    nextobjectid: nextId,
    properties: [
      { name: 'id', type: 'string', value: map.id },
      { name: 'name', type: 'string', value: map.name },
      { name: 'description', type: 'string', value: map.description },
      { name: 'feature', type: 'string', value: map.feature },
      { name: 'theme', type: 'string', value: JSON.stringify(map.theme) },
      { name: 'weaponPool', type: 'string', value: map.weaponPool.join(',') },
      { name: 'heavyPool', type: 'string', value: map.heavyPool.join(',') },
      { name: 'recommended', type: 'string', value: map.recommended.join(',') },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'collision',
        tilewidth: TILE,
        tileheight: TILE,
        tilecount: TILE_NAMES.length - 1,
        columns: TILE_NAMES.length - 1,
        image: 'collision.png',
        imagewidth: TILE * (TILE_NAMES.length - 1),
        imageheight: TILE,
        margin: 0,
        spacing: 0,
        tiles: TILE_NAMES.slice(1).map((name, id) => ({ id, type: name })),
      },
    ],
    layers: [
      {
        id: 1,
        name: 'collision',
        type: 'tilelayer',
        width: map.width,
        height: map.height,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        // Tiled gid = tile id (0 stays empty) because firstgid is 1 and tile 0 of the set is "solid".
        data: Array.from(map.tiles),
      },
      { id: 2, name: 'objects', type: 'objectgroup', draworder: 'topdown', x: 0, y: 0, opacity: 1, visible: true, objects },
    ],
  };
}
