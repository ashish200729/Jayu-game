import type { MapData, MapObject, MapTheme, Mover, MoverKind, ObjectKind } from './types';

interface TmjProperty {
  name: string;
  value: unknown;
}
interface TmjObject {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TmjProperty[];
}
interface TmjLayer {
  name: string;
  type: string;
  data?: number[];
  objects?: TmjObject[];
}
export interface Tmj {
  width: number;
  height: number;
  tilewidth: number;
  properties?: TmjProperty[];
  layers: TmjLayer[];
}

function prop<T>(props: TmjProperty[] | undefined, name: string, fallback: T): T {
  const p = props?.find((x) => x.name === name);
  return p === undefined ? fallback : (p.value as T);
}

const OBJECT_KINDS: ObjectKind[] = ['spawn', 'flag', 'hill', 'weapon', 'heavy', 'health', 'grenade', 'dual', 'checkpoint', 'target'];
const MOVER_KINDS: MoverKind[] = ['door', 'bridge', 'platform'];

/** Parses a Tiled .tmj map produced by the generator (or hand-edited in Tiled with the same layers). */
export function loadTmj(tmj: Tmj): MapData {
  if (tmj.tilewidth !== 32) throw new Error('maps must use 32px tiles');
  const collision = tmj.layers.find((l) => l.name === 'collision' && l.type === 'tilelayer');
  const objectLayer = tmj.layers.find((l) => l.name === 'objects' && l.type === 'objectgroup');
  if (!collision?.data) throw new Error('map has no collision layer');
  if (collision.data.length !== tmj.width * tmj.height) throw new Error('collision layer size mismatch');
  const tiles = new Uint8Array(collision.data.length);
  for (let i = 0; i < tiles.length; i++) tiles[i] = collision.data[i] & 0xff;
  const objects: MapObject[] = [];
  const movers: Mover[] = [];
  for (const o of objectLayer?.objects ?? []) {
    if ((OBJECT_KINDS as string[]).includes(o.type)) {
      objects.push({
        kind: o.type as ObjectKind,
        x: o.x,
        y: o.y,
        team: prop(o.properties, 'team', -1),
        index: prop(o.properties, 'index', 0),
      });
    } else if ((MOVER_KINDS as string[]).includes(o.type)) {
      movers.push({
        kind: o.type as MoverKind,
        x: o.x,
        y: o.y,
        w: o.width,
        h: o.height,
        period: prop(o.properties, 'period', 8),
        openTime: prop(o.properties, 'openTime', 4),
        phase: prop(o.properties, 'phase', 0),
        dx: prop(o.properties, 'dx', 0),
        dy: prop(o.properties, 'dy', 0),
      });
    }
  }
  const rec = String(prop(tmj.properties, 'recommended', '2,8')).split(',').map(Number) as [number, number];
  return {
    id: prop(tmj.properties, 'id', 'unknown'),
    name: prop(tmj.properties, 'name', 'Unknown'),
    description: prop(tmj.properties, 'description', ''),
    feature: prop(tmj.properties, 'feature', ''),
    width: tmj.width,
    height: tmj.height,
    tiles,
    objects,
    movers,
    theme: JSON.parse(prop(tmj.properties, 'theme', '{}')) as MapTheme,
    weaponPool: String(prop(tmj.properties, 'weaponPool', '')).split(',').filter(Boolean),
    heavyPool: String(prop(tmj.properties, 'heavyPool', '')).split(',').filter(Boolean),
    recommended: rec,
  };
}
