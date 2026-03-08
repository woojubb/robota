import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
    resolve: {
        alias: {
            '@robota-sdk/agents': path.resolve(__dirname, '../agents/src/index.ts')
        }
    },
    test: {
        globals: true,
        include: [
            'src/**/*.{test,spec}.{ts,tsx}'
        ],
        environment: 'node',
        testTimeout: 10000
    },
}); 