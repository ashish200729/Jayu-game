import { registerPlugin } from '@capacitor/core';
import type { LanPlugin } from './definitions';

export * from './definitions';

/** Native implementations: android/ (Kotlin) and ios/ (Swift). The web has no LAN support. */
export const Lan = registerPlugin<LanPlugin>('JayuLan', {
  web: () => import('./web').then((m) => new m.LanWeb()),
});
