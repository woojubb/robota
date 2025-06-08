import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // New pattern: Place .test.ts or .spec.ts files next to source files
        include: [
            'packages/**/src/**/*.{test,spec}.{ts,tsx}',
            // Continue to support existing test directories
            'packages/**/tests/**/*.{test,spec}.{ts,tsx}'
        ],
        environment: 'node',
        // Parallel execution
        threads: true,
        // Timeout settings
        testTimeout: 10000,
        // Coverage settings
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                '**/dist/',
                '**/test/',
                '**/*.test.ts',
                '**/*.spec.ts',
                '**/*.d.ts',
            ],
        },
    },
}); 