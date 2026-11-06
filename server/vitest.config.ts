import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { TZ: 'Europe/Zurich' },
    testTimeout: 30_000,
  },
});
