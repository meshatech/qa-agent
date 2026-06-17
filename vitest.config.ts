import { defineConfig } from 'vitest/config';
import 'dotenv/config';

export default defineConfig({
  cacheDir: '/tmp/.vite-vitest-cache',
  test: {
    globals: true,
    include: ['test/**/*.spec.ts'],
    pool: 'vmThreads',
  },
});
