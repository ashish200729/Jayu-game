import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jayu.jetbrawl',
  appName: 'Jayu',
  webDir: 'apps/game/dist',
  backgroundColor: '#10121a',
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'never', scrollEnabled: false, preferredContentMode: 'mobile' },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, backgroundColor: '#10121a', showSpinner: false, launchAutoHide: false },
    SystemBars: { insetsHandling: 'css', hidden: true },
  },
};

export default config;
