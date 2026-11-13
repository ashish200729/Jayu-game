import { Capacitor, SystemBars } from '@capacitor/core';

/**
 * Platform adapters: one API, web and Capacitor (Android/iOS) implementations.
 * Every native call is wrapped so a missing plugin never crashes the game.
 */
export type PlatformName = 'web' | 'android' | 'ios';

export const platform: PlatformName = (Capacitor.getPlatform() as PlatformName) ?? 'web';
export const isNative = Capacitor.isNativePlatform();

// ---------------------------------------------------------------- storage

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class NativeStore implements KeyValueStore {
  private prefs = import('@capacitor/preferences').then((m) => m.Preferences);
  async get(key: string) {
    return (await (await this.prefs).get({ key })).value;
  }
  async set(key: string, value: string) {
    await (await this.prefs).set({ key, value });
  }
  async remove(key: string) {
    await (await this.prefs).remove({ key });
  }
}

/** IndexedDB key-value store with a localStorage fallback (private mode, old WebViews). */
class WebStore implements KeyValueStore {
  private db: Promise<IDBDatabase | null>;
  constructor() {
    this.db = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open('jayu', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.db;
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const t = db.transaction('kv', mode);
        const r = fn(t.objectStore('kv'));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }
  async get(key: string) {
    const v = await this.tx<string>('readonly', (s) => s.get(key) as IDBRequest<string>);
    if (typeof v === 'string') return v;
    try {
      return localStorage.getItem(`jayu:${key}`);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string) {
    const db = await this.db;
    if (db) await this.tx('readwrite', (s) => s.put(value, key));
    else {
      try {
        localStorage.setItem(`jayu:${key}`, value);
      } catch {
        // storage full or blocked: keep running with in-memory state
      }
    }
  }
  async remove(key: string) {
    await this.tx('readwrite', (s) => s.delete(key));
    try {
      localStorage.removeItem(`jayu:${key}`);
    } catch {
      // ignore
    }
  }
}

export const storage: KeyValueStore = isNative ? new NativeStore() : new WebStore();

// ---------------------------------------------------------------- haptics

export type HapticKind = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

let hapticsMod: Promise<typeof import('@capacitor/haptics')> | null = null;
export async function haptic(kind: HapticKind): Promise<void> {
  try {
    if (isNative) {
      hapticsMod ??= import('@capacitor/haptics');
      const { Haptics, ImpactStyle, NotificationType } = await hapticsMod;
      if (kind === 'success') await Haptics.notification({ type: NotificationType.Success });
      else if (kind === 'warning') await Haptics.notification({ type: NotificationType.Warning });
      else await Haptics.impact({ style: kind === 'light' ? ImpactStyle.Light : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Heavy });
    } else if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(kind === 'light' ? 8 : kind === 'medium' ? 16 : 30);
    }
  } catch {
    // haptics unavailable
  }
}

// ---------------------------------------------------------------- lifecycle

export interface LifecycleHandlers {
  onPause?: () => void;
  onResume?: () => void;
  /** Android back button / predictive back. Return true if handled. */
  onBack?: () => boolean;
}

export async function initLifecycle(h: LifecycleHandlers): Promise<() => void> {
  const cleanups: (() => void)[] = [];
  const vis = () => (document.hidden ? h.onPause?.() : h.onResume?.());
  document.addEventListener('visibilitychange', vis);
  cleanups.push(() => document.removeEventListener('visibilitychange', vis));
  if (isNative) {
    try {
      const { App } = await import('@capacitor/app');
      const a = await App.addListener('appStateChange', (s) => (s.isActive ? h.onResume?.() : h.onPause?.()));
      const b = await App.addListener('backButton', () => {
        if (!h.onBack?.()) void App.minimizeApp();
      });
      cleanups.push(() => void a.remove(), () => void b.remove());
    } catch {
      // @capacitor/app missing
    }
  }
  return () => cleanups.forEach((c) => c());
}

/** Native shell setup: landscape lock, hidden system bars, hide splash. */
export async function initNativeShell(): Promise<void> {
  if (!isNative) return;
  try {
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
  } catch {
    // orientation plugin missing
  }
  try {
    await SystemBars.hide();
  } catch {
    // system bars API missing
  }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    // splash plugin missing
  }
}

// ---------------------------------------------------------------- sharing

export async function shareInvite(code: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  const text = `Join my Jayu match! Code: ${code}`;
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Jayu invite', text, url });
      return 'shared';
    }
  } catch {
    // user cancelled share sheet
  }
  return copyText(`${text} ${url}`);
}

export async function copyText(text: string): Promise<'copied' | 'failed'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

export function supportsLan(): boolean {
  return isNative;
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
