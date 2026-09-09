import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 20_000,
    server: {
      deps: { inline: [/next-auth/, /^next\//] },
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
