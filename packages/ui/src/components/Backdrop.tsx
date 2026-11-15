import { memo, useMemo } from 'react';
import { useMotionOk } from './ui';

/** Small deterministic PRNG so the skyline is identical on every launch. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    s ^= s >>> 12;
    return (s >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 400;

interface Skyline {
  path: string;
  rim: string;
  windows: { x: number; y: number; w: number; h: number; o: number }[];
  antennas: { x: number; y: number; h: number }[];
}

/** A seamless (tileable) city skyline: blocks with setbacks, antennas, lit windows. */
function skyline(seed: number, base: number, minH: number, maxH: number, minW: number, maxW: number, windowRate: number): Skyline {
  const r = rng(seed);
  let x = 0;
  const pts: string[] = [`M0 ${H}`];
  const rim: string[] = [];
  const windows: Skyline['windows'] = [];
  const antennas: Skyline['antennas'] = [];
  let first = -1;
  while (x < W) {
    const bw = Math.min(W - x, minW + r() * (maxW - minW));
    let bh = minH + r() * (maxH - minH);
    if (x + bw >= W && first >= 0) bh = first; // match the first block so the strip tiles
    if (first < 0) first = bh;
    const top = base - bh;
    const setback = bw > 70 && r() > 0.55;
    if (setback) {
      const inset = bw * (0.18 + r() * 0.12);
      const sh = 18 + r() * 34;
      pts.push(`L${x} ${top + sh}`, `L${x + inset} ${top + sh}`, `L${x + inset} ${top}`, `L${x + bw - inset} ${top}`, `L${x + bw - inset} ${top + sh}`, `L${x + bw} ${top + sh}`);
      rim.push(`M${x + inset} ${top} L${x + bw - inset} ${top}`);
    } else {
      pts.push(`L${x} ${top}`, `L${x + bw} ${top}`);
      rim.push(`M${x} ${top} L${x + bw} ${top}`);
    }
    if (r() > 0.72) antennas.push({ x: x + bw * (0.3 + r() * 0.4), y: top, h: 14 + r() * 36 });
    if (windowRate > 0) {
      for (let wy = top + 14; wy < base - 8; wy += 13) {
        for (let wx = x + 7; wx < x + bw - 9; wx += 11) {
          if (r() < windowRate) windows.push({ x: wx, y: wy, w: 4, h: 6, o: 0.35 + r() * 0.65 });
        }
      }
    }
    x += bw;
  }
  pts.push(`L${W} ${H}`, 'Z');
  return { path: pts.join(' '), rim: rim.join(' '), windows, antennas };
}

function hills(seed: number, base: number, amp: number): string {
  const r = rng(seed);
  const a = 0.6 + r() * 0.8;
  const b = 1.4 + r() * 1.2;
  const p0 = r() * Math.PI * 2;
  const pts: string[] = [`M0 ${H}`];
  for (let x = 0; x <= W; x += 20) {
    // whole periods across W keep the strip seamless
    const t = (x / W) * Math.PI * 2;
    const y = base - amp * (0.55 * Math.sin(t * Math.round(a * 2) + p0) + 0.3 * Math.sin(t * Math.round(b * 3) + p0 * 2) + 0.15 * Math.sin(t * 9));
    pts.push(`L${x} ${y.toFixed(1)}`);
  }
  pts.push(`L${W} ${H}`, 'Z');
  return pts.join(' ');
}

const GRAIN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

function Strip({ children, motion, duration, className = '', style }: { children: React.ReactNode; motion: boolean; duration: number; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={`absolute inset-x-0 bottom-0 overflow-hidden ${className}`} style={style}>
      <div className="flex h-full w-[200%]" style={motion ? { animation: `bd-drift ${duration}s linear infinite`, willChange: 'transform' } : undefined}>
        {children}
      </div>
    </div>
  );
}

/**
 * Animated menu backdrop: dusk sky, sun bloom, stars, three parallax skyline strips with lit windows and
 * rim light, haze between layers, drifting clouds, rising embers, distant jetpack pilots, grain, vignette.
 * Pure DOM/SVG/CSS (no canvas, no per-frame JS); animation stops when reduce-motion is on.
 */
export const Backdrop = memo(function Backdrop({ dim = false }: { dim?: boolean }) {
  const motion = useMotionOk();
  const layers = useMemo(
    () => ({
      far: hills(11, 250, 60),
      mid: skyline(7, 400, 150, 280, 46, 120, 0.09),
      near: skyline(23, 400, 70, 170, 60, 150, 0.035),
    }),
    [],
  );
  const stars = useMemo(() => {
    const r = rng(99);
    return Array.from({ length: 70 }, () => ({ x: r() * 100, y: r() * 48, s: 0.6 + r() * 1.6, o: 0.25 + r() * 0.6, d: 2 + r() * 4, tw: r() > 0.7 }));
  }, []);
  const embers = useMemo(() => {
    const r = rng(5);
    return Array.from({ length: 22 }, () => ({ x: r() * 100, s: 2 + r() * 3, d: 9 + r() * 12, delay: -r() * 20, drift: (r() - 0.5) * 120, o: 0.45 + r() * 0.5 }));
  }, []);

  // Each strip is ONE SVG image tiled as a CSS background: the browser rasterises it once, instead of
  // laying out hundreds of live SVG nodes per strip (which cost seconds of first-paint on weak GPUs).
  const svgUrl = (body: string, defs = '') =>
    `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='none'><defs>${defs}</defs>${body}</svg>`)}")`;
  const skylineUrl = (s: Skyline, fill: string, rimColor: string, windowColor: string, top: string) =>
    svgUrl(
      `<path d='${s.path}' fill='url(#g)'/>` +
        s.antennas.map((a) => `<rect x='${a.x}' y='${a.y - a.h}' width='2.5' height='${a.h}' fill='${fill}'/><circle cx='${a.x + 1.25}' cy='${a.y - a.h}' r='2.4' fill='#ff5a4f' opacity='0.9'/>`).join('') +
        `<path d='${s.rim}' stroke='${rimColor}' stroke-width='2' fill='none' opacity='0.7'/>` +
        s.windows.map((w) => `<rect x='${w.x}' y='${w.y}' width='${w.w}' height='${w.h}' fill='${windowColor}' opacity='${w.o.toFixed(2)}'/>`).join(''),
      `<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${top}'/><stop offset='0.7' stop-color='${fill}'/></linearGradient>`,
    );
  const images = useMemo(
    () => ({
      far: svgUrl(`<path d='${layers.far}' fill='url(#g)' opacity='0.85'/>`, `<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#6a3466'/><stop offset='0.6' stop-color='#3a1e48'/></linearGradient>`),
      mid: skylineUrl(layers.mid, '#24163c', '#ff9a6a', '#ffd98a', '#3b2152'),
      near: skylineUrl(layers.near, '#0e0a1a', '#ff7a45', '#ffc46b', '#1a1028'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layers],
  );
  const tiled = (img: string) => <div className="h-full w-full" style={{ backgroundImage: img, backgroundSize: '50% 100%', backgroundRepeat: 'repeat-x' }} />;

  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none select-none" data-testid="menu-backdrop">
      {/* Sky */}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, #070914 0%, #120f2a 28%, #2a1846 52%, #5a2350 72%, #a2414e 86%, #f08a52 100%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgb(60 90 200 / 0.22), transparent 60%)' }} />
      {/* Stars */}
      <div className="absolute inset-0">
        {stars.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.s,
              height: s.s,
              opacity: s.o * (1 - s.y / 60),
              boxShadow: s.s > 1.6 ? '0 0 6px rgba(255,255,255,0.8)' : undefined,
              animation: motion && s.tw ? `bd-twinkle ${s.d}s ease-in-out infinite` : undefined,
            }}
          />
        ))}
      </div>
      {/* Sun + bloom */}
      <div className="absolute left-[22%] top-[58%] -translate-x-1/2 -translate-y-1/2 w-[70vmax] h-[70vmax] rounded-full" style={{ background: 'radial-gradient(circle, rgb(255 170 90 / 0.42) 0%, rgb(255 120 80 / 0.18) 22%, transparent 55%)' }} />
      <div className="absolute left-[22%] top-[66%] -translate-x-1/2 -translate-y-1/2 w-[22vmin] h-[22vmin] rounded-full" style={{ background: 'radial-gradient(circle at 50% 45%, #fff6d6 0%, #ffd27a 30%, #ff9a5a 52%, rgb(255 120 80 / 0.35) 62%, rgb(255 120 80 / 0) 71%)' }} />
      <div className="absolute right-[8%] top-[10%] w-[40vmax] h-[40vmax] rounded-full" style={{ background: 'radial-gradient(circle, rgb(110 90 255 / 0.18), transparent 60%)' }} />
      {/* Clouds */}
      <div className="absolute inset-x-0 top-[30%] h-[30%] overflow-hidden opacity-70">
        <div className="flex h-full w-[200%]" style={motion ? { animation: 'bd-drift 200s linear infinite', willChange: 'transform' } : undefined}>
          {[0, 1].map((k) => (
            <div key={k} className="relative h-full w-1/2">
              <span className="absolute left-[8%] top-[30%] w-[30%] h-[22%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 160 140 / 0.22), transparent)' }} />
              <span className="absolute left-[46%] top-[55%] w-[38%] h-[18%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(200 110 160 / 0.2), transparent)' }} />
              <span className="absolute left-[78%] top-[18%] w-[22%] h-[16%] rounded-full" style={{ background: 'radial-gradient(closest-side, rgb(255 190 150 / 0.18), transparent)' }} />
            </div>
          ))}
        </div>
      </div>
      {/* Distant jetpack pilots */}
      {motion &&
        [0, 1].map((i) => (
          <div key={i} className="absolute" style={{ top: `${20 + i * 14}%`, left: 0, animation: `bd-fly ${26 + i * 9}s linear ${-i * 11}s infinite` }}>
            <div className="relative" style={{ animation: `bd-bob ${2.4 + i}s ease-in-out infinite` }}>
              <span className="absolute right-full top-1/2 -translate-y-1/2 w-16 h-[3px] rounded-full" style={{ background: 'linear-gradient(90deg, transparent, rgb(255 170 70 / 0.8))' }} />
              <span className="block w-[7px] h-[11px] rounded-[3px] bg-[#1a1230] shadow-[0_0_10px_2px_rgb(255_170_70/0.5)]" />
            </div>
          </div>
        ))}
      {/* Far hills */}
      <Strip motion={motion} duration={260} className="h-[56%]">
        {tiled(images.far)}
      </Strip>
      <div className="absolute inset-x-0 bottom-0 h-[50%]" style={{ background: 'linear-gradient(180deg, transparent, rgb(150 60 90 / 0.35) 40%, transparent)' }} />
      {/* Mid city */}
      <Strip motion={motion} duration={160} className="h-[46%]">
        {tiled(images.mid)}
      </Strip>
      <div className="absolute inset-x-0 bottom-0 h-[34%]" style={{ background: 'linear-gradient(180deg, transparent, rgb(30 14 40 / 0.55))' }} />
      {/* Near city */}
      <Strip motion={motion} duration={95} className="h-[30%]">
        {tiled(images.near)}
      </Strip>
      {/* Embers */}
      {motion && (
        <div className="absolute inset-0">
          {embers.map((e, i) => (
            <span
              key={i}
              className="absolute bottom-[-10px] rounded-full"
              style={
                {
                  left: `${e.x}%`,
                  width: e.s,
                  height: e.s,
                  background: 'radial-gradient(circle, #fff1c2, #ffb347 55%, transparent 70%)',
                  boxShadow: '0 0 8px 2px rgb(255 160 70 / 0.55)',
                  opacity: e.o,
                  animation: `bd-ember ${e.d}s linear ${e.delay}s infinite`,
                  '--dx': `${e.drift}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      )}
      {/* Ground fade so UI at the bottom stays legible */}
      <div className="absolute inset-x-0 bottom-0 h-[22%]" style={{ background: 'linear-gradient(180deg, transparent, rgb(8 6 16 / 0.9))' }} />
      {/* Sub-pages get a calmer, darker sky so content leads */}
      <div className="absolute inset-0 transition-opacity duration-[var(--duration-slow)]" style={{ background: 'linear-gradient(180deg, rgb(6 7 16 / 0.55), rgb(6 7 16 / 0.25) 60%, rgb(6 7 16 / 0.45))', opacity: dim ? 1 : 0 }} />
      {/* Vignette + grain */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(130% 100% at 50% 45%, transparent 55%, rgb(3 3 10 / 0.6) 100%)' }} />
      {/* Normal blending at low alpha: a full-screen blend mode would re-composite the animated scene every frame. */}
      <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: GRAIN }} />
      <style>{`
        @keyframes bd-drift { from { transform: translate3d(0,0,0) } to { transform: translate3d(-50%,0,0) } }
        @keyframes bd-twinkle { 0%,100% { opacity: .15 } 50% { opacity: .9 } }
        @keyframes bd-ember { 0% { transform: translate3d(0,0,0); opacity: 0 } 10% { opacity: 1 } 100% { transform: translate3d(var(--dx), -105vh, 0); opacity: 0 } }
        @keyframes bd-fly { from { transform: translate3d(-10vw,0,0) } to { transform: translate3d(110vw,-6vh,0) } }
        @keyframes bd-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-8px) } }
      `}</style>
    </div>
  );
});
