import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jayu.jetbrawl',
  appName: 'Jayu',
  webDir: 'apps/game/dist',
  backgroundColor: '#10121a',
  // webContentsDebuggingEnabled is left at Capacitor's default: on for debug APKs (chrome://inspect), off in release.
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', scrollEnabled: false, preferredContentMode: 'mobile' },
  plugins: {
    // Auto-hide as a safety net; the app also hides it as its first boot step and shows its own HTML loader.
    SplashScreen: { launchShowDuration: 1200, backgroundColor: '#10121a', showSpinner: false, launchAutoHide: true },
    SystemBars: { insetsHandling: 'css', hidden: true },
  },
};

export default config;
