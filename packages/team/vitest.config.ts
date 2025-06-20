import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'dist/**',
                'node_modules/**',
                '**/*.test.ts',
                '**/*.spec.ts'
            ]
        }
    }
}); 