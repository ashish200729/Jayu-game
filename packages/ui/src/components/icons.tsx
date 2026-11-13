/** Small stroke icons drawn inline (no icon font, no external assets). */
const PATHS = {
  play: 'M7 4.5 L19 12 L7 19.5 Z',
  lock: 'M6 11 H18 V20 H6 Z M8.5 11 V8 A3.5 3.5 0 0 1 15.5 8 V11',
  wifi: 'M3 9.5 A13 13 0 0 1 21 9.5 M6 13 A8.5 8.5 0 0 1 18 13 M9 16.5 A4 4 0 0 1 15 16.5 M12 20 H12.01',
  bot: 'M5 9 H19 V19 H5 Z M12 9 V5 M12 4 H12.01 M9 14 H9.01 M15 14 H15.01 M2.5 13 V16 M21.5 13 V16',
  waves: 'M2 9 C5 6 7 6 10 9 S15 12 18 9 S21 7 22 8 M2 15 C5 12 7 12 10 15 S15 18 18 15 S21 13 22 14',
  target: 'M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 M7.5 12 A4.5 4.5 0 1 0 16.5 12 A4.5 4.5 0 1 0 7.5 12 M12 12 H12.01',
  shirt: 'M8 3 L4 6 L6 10 L8 9 V21 H16 V9 L18 10 L20 6 L16 3 C15 5 9 5 8 3 Z',
  user: 'M8 8 A4 4 0 1 0 16 8 A4 4 0 1 0 8 8 M4 21 C4 16 8 14 12 14 S20 16 20 21',
  gear: 'M9 12 A3 3 0 1 0 15 12 A3 3 0 1 0 9 12 M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M4.9 4.9 L7 7 M17 17 L19.1 19.1 M4.9 19.1 L7 17 M17 7 L19.1 4.9',
  star: 'M12 3 L14.6 8.6 L20.6 9.2 L16 13.3 L17.4 19.3 L12 16.2 L6.6 19.3 L8 13.3 L3.4 9.2 L9.4 8.6 Z',
  refresh: 'M20 11 A8 8 0 1 0 18 17 M20 4 V11 H13',
  copy: 'M8 8 H20 V20 H8 Z M16 8 V4 H4 V16 H8',
  share: 'M12 15 V3 M7 8 L12 3 L17 8 M5 13 V20 H19 V13',
  globe: 'M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 M3 12 H21 M12 3 C8.5 7 8.5 17 12 21 M12 3 C15.5 7 15.5 17 12 21',
  check: 'M5 12.5 L10 17.5 L19 7',
  x: 'M6 6 L18 18 M18 6 L6 18',
  trophy: 'M8 4 H16 V10 A4 4 0 0 1 8 10 Z M8 6 H4 C4 9 6 10 8 10 M16 6 H20 C20 9 18 10 16 10 M12 14 V18 M8 21 H16 M9 18 H15',
  flag: 'M5 21 V4 M5 4 H17 L14.5 8 L17 12 H5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className = 'w-6 h-6', strokeWidth = 2.2 }: { name: IconName; className?: string; strokeWidth?: number }) {
  const filled = name === 'play' || name === 'star';
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}
