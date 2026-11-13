import { defineConfig, devices } from '@playwright/test';

/** E2E against the production web build served by `vite preview`. */
const swiftshader = { launchOptions: { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'off', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npm run preview -w @game/app -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...swiftshader } },
    { name: 'chromium-phone', use: { ...devices['Pixel 7 landscape'], ...swiftshader } },
    ...(process.env.CI
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
});
