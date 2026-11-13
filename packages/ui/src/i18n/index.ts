import { en, type StringKey } from './en';
import { hi } from './hi';

export type { StringKey };
export const DICTS = { en, hi } as const;
export type Lang = keyof typeof DICTS;

let current: Lang = 'en';
export function setLanguage(l: Lang): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}
export function getLanguage(): Lang {
  return current;
}

/** Translate a key, filling {placeholders}. Unknown keys fall back to English, then to the key itself. */
export function t(key: StringKey | string, vars?: Record<string, string | number>): string {
  const dict = DICTS[current] as Record<string, string>;
  let s = dict[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  return s;
}
