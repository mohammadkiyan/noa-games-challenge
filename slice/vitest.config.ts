import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/globalSetup.ts'],
    // All files share one throwaway database and truncate it between tests.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
