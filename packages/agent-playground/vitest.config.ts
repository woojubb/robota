import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    testTimeout: 5000,
    hookTimeout: 5000,
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
  },
});
