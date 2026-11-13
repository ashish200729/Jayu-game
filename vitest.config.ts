import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'tests/netcode/**/*.test.ts', 'tests/determinism/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 60000,
  },
});
