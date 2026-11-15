import { getMap, Tile, type MapData } from '@game/maps';
import { useMemo } from 'react';

const cache = new Map<string, string>();

const rgb = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
const mixc = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/**
 * Renders the map's real tile layout (sky, solids with rim-lit tops, platforms, liquids, objectives)
 * into a data URL. Cached per map id + pixel size.
 */
function render(map: MapData, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) return '';
  const th = map.theme;
  // Sky.
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, rgb(th.skyTop));
  sky.addColorStop(1, rgb(th.skyBottom));
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * 0.78, h * 0.22, 0, w * 0.78, h * 0.22, h * 0.9);
  glow.addColorStop(0, rgb(th.accent, 0.38));
  glow.addColorStop(1, rgb(th.accent, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  // Distant silhouette band.
  g.fillStyle = rgb(th.far, 0.7);
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) g.lineTo(x, h * 0.62 + Math.sin(x * 0.045) * h * 0.06 + Math.sin(x * 0.13) * h * 0.025);
  g.lineTo(w, h);
  g.fill();
  // Tiles, contain-fit and centred.
  const k = Math.min(w / map.width, h / map.height);
  const ox = (w - map.width * k) / 2;
  const oy = (h - map.height * k) / 2;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? Tile.Solid : map.tiles[y * map.width + x]);
  const solid = (t: number) => t === Tile.Solid || t === Tile.Ice;
  const px = (n: number) => Math.round(n * 100) / 100;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = at(x, y);
      const X = px(ox + x * k);
      const Y = px(oy + y * k);
      const s = k + 0.6;
      if (solid(t)) {
        let depth = 0;
        while (depth < 4 && solid(at(x, y - depth - 1))) depth++;
        const base = t === Tile.Ice ? 0xbfe8ff : th.solid;
        g.fillStyle = rgb(mixc(base, t === Tile.Ice ? 0x7fb8db : th.solidDark, depth / 4));
        g.fillRect(X, Y, s, s);
        if (!solid(at(x, y - 1))) {
          g.fillStyle = rgb(t === Tile.Ice ? 0xffffff : th.rim);
          g.fillRect(X, Y, s, Math.max(1, k * 0.32));
        }
      } else if (t === Tile.OneWay) {
        g.fillStyle = rgb(th.rim, 0.9);
        g.fillRect(X, Y, s, Math.max(1, k * 0.3));
      } else if (t === Tile.Lava) {
        g.fillStyle = at(x, y - 1) === Tile.Lava ? '#ff6a1f' : '#ffc23d';
        g.fillRect(X, Y, s, s);
      } else if (t === Tile.Water) {
        g.fillStyle = 'rgba(70,170,255,0.6)';
        g.fillRect(X, Y, s, s);
      } else if (t === Tile.Vine) {
        g.fillStyle = 'rgba(110,200,80,0.55)';
        g.fillRect(X + k * 0.35, Y, Math.max(1, k * 0.3), s);
      } else if (t === Tile.Vent) {
        g.fillStyle = 'rgba(255,150,60,0.28)';
        g.fillRect(X, Y, s, s);
      }
    }
  }
  // Objectives: flags in team colours, pickups as small accent pips.
  for (const o of map.objects) {
    const X = ox + (o.x / 32) * k;
    const Y = oy + (o.y / 32) * k;
    if (o.kind === 'flag') {
      g.fillStyle = o.team === 0 ? '#ff5a4f' : '#3fa2ff';
      g.fillRect(X - k * 0.15, Y - k * 2.2, Math.max(1, k * 0.3), k * 2.2);
      g.fillRect(X, Y - k * 2.2, k * 1.1, k * 0.8);
    } else if (o.kind === 'heavy') {
      g.fillStyle = 'rgba(255,140,60,0.95)';
      g.beginPath();
      g.arc(X, Y - k * 0.8, Math.max(1.4, k * 0.55), 0, Math.PI * 2);
      g.fill();
    }
  }
  // Soft vignette for depth.
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return c.toDataURL('image/png');
}

/** The map's actual layout as a thumbnail. `width`/`height` are CSS pixels; rendered at device resolution. */
export function MapPreview({ id, width = 220, height = 100, className = '' }: { id: string; width?: number; height?: number; className?: string }) {
  const src = useMemo(() => {
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const w = Math.round(width * dpr);
    const h = Math.round(height * dpr);
    const key = `${id}:${w}x${h}`;
    let url = cache.get(key);
    if (url === undefined) {
      try {
        url = render(getMap(id), w, h);
      } catch {
        url = '';
      }
      cache.set(key, url);
    }
    return url;
  }, [id, width, height]);
  return src ? <img src={src} alt="" aria-hidden="true" draggable={false} className={`block object-cover ${className}`} style={{ aspectRatio: `${width} / ${height}` }} /> : <span className={`block bg-panel-2 ${className}`} style={{ aspectRatio: `${width} / ${height}` }} />;
}
