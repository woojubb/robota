import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        exclude: ['node_modules', 'dist'],
        testTimeout: 10000,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules',
                'dist',
                '**/*.d.ts',
                '**/*.config.ts',
                '**/index.ts'
            ]
        }
    }
}); 