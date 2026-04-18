import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      exclude: [
        'dist/**',
        'node_modules/**',
        'src/index.ts', // pure re-export barrel — no logic to test
      ],
    },
  },
});
