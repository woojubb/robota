import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}'
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{git,cache,output,temp}/**'
    ],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'dist/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/*.d.ts'
      ]
    },
    typecheck: {
      tsconfig: './tsconfig.test.json'
    }
  }
});
