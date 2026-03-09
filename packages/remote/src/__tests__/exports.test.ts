/**
 * Export Entry Point Tests
 *
 * Verifies that the public API surface exports are accessible.
 */

import { describe, it, expect } from 'vitest';

describe('Browser entry (index.ts)', () => {
    it('should export RemoteExecutor', async () => {
        const mod = await import('../index');
        expect(mod.RemoteExecutor).toBeDefined();
    });

    it('should export HttpClient', async () => {
        const mod = await import('../index');
        expect(mod.HttpClient).toBeDefined();
    });

    it('should export WebSocketTransport', async () => {
        const mod = await import('../index');
        expect(mod.WebSocketTransport).toBeDefined();
    });

    it('should export utility functions', async () => {
        const mod = await import('../index');
        expect(typeof mod.toRequestMessage).toBe('function');
        expect(typeof mod.toResponseMessage).toBe('function');
        expect(typeof mod.createHttpRequest).toBe('function');
        expect(typeof mod.createHttpResponse).toBe('function');
        expect(typeof mod.extractContent).toBe('function');
        expect(typeof mod.generateId).toBe('function');
        expect(typeof mod.normalizeHeaders).toBe('function');
        expect(typeof mod.safeJsonParse).toBe('function');
    });
});

describe('Browser entry (browser.ts)', () => {
    it('should export RemoteExecutor', async () => {
        const mod = await import('../browser');
        expect(mod.RemoteExecutor).toBeDefined();
    });

    it('should export HttpClient', async () => {
        const mod = await import('../browser');
        expect(mod.HttpClient).toBeDefined();
    });

    it('should export WebSocketTransport', async () => {
        const mod = await import('../browser');
        expect(mod.WebSocketTransport).toBeDefined();
    });

    it('should export utility functions', async () => {
        const mod = await import('../browser');
        expect(typeof mod.toRequestMessage).toBe('function');
        expect(typeof mod.toResponseMessage).toBe('function');
        expect(typeof mod.generateId).toBe('function');
    });
});

describe('Server entry (server.ts)', () => {
    it('should export RemoteServer', async () => {
        // The server entry imports express which we need to mock
        vi.mock('express', () => {
            const mockRouter = {
                get: vi.fn(),
                post: vi.fn()
            };
            const mockApp = { use: vi.fn() };
            const expressFn = vi.fn(() => mockApp);
            expressFn.Router = vi.fn(() => mockRouter);
            expressFn.json = vi.fn(() => 'json');
            return { default: expressFn };
        });
        vi.mock('cors', () => ({ default: vi.fn(() => 'cors') }));
        vi.mock('helmet', () => ({ default: vi.fn(() => 'helmet') }));

        const mod = await import('../server');
        expect(mod.RemoteServer).toBeDefined();
    });
});

import { vi } from 'vitest';
