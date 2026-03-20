import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: [
            'src/**/*.{test,spec}.{ts,tsx}',
            'src/**/__tests__/**/*.{test,spec}.{ts,tsx}',
        ],
        environment: 'node',
        testTimeout: 10000,
    },
});
