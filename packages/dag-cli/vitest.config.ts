import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '**/dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts',
        // Entry points / build config — not unit-testable
        'src/bin.ts',
        'tsdown.config.ts',
        // Pure re-export barrel files — no logic
        'src/index.ts',
        'src/mcp/index.ts',
      ],
    },
  },
});
