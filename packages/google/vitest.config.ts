import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        include: [
            'src/**/*.{test,spec}.{ts,tsx}'
        ],
        environment: 'node',
        testTimeout: 10000
    },
}); 