import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/integration/**/*.test.ts',
      'packages/*/src/**/*.integration.test.ts',
      'apps/*/src/**/*.integration.test.ts',
    ],
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
