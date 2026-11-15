import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Jayu: Jetpack Brawl',
        short_name: 'Jayu',
        description: 'Fast 2D jetpack battles with friends — online, on local Wi-Fi, or against bots.',
        theme_color: '#10121a',
        background_color: '#10121a',
        display: 'fullscreen',
        orientation: 'landscape',
        start_url: './',
        scope: './',
        categories: ['games'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,woff}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    // Android System WebView on older phones lags behind; Chrome 87 covers Android 7+ devices with updated WebView.
    target: ['es2020', 'chrome87', 'safari14'],
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/phaser')) return 'phaser';
          if (id.includes('@colyseus')) return 'online';
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { port: 4173 },
});
