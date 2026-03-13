/**
 * Export Entry Point Tests
 *
 * Verifies that the public API surface exports are accessible.
 */

import { describe, it, expect, vi } from 'vitest';
import * as mainExports from '../index';
import * as browserExports from '../browser';

describe('Browser entry (index.ts)', () => {
    it('should export RemoteExecutor', () => {
        expect(mainExports.RemoteExecutor).toBeDefined();
    });

    it('should export HttpClient', () => {
        expect(mainExports.HttpClient).toBeDefined();
    });

    it('should export WebSocketTransport', () => {
        expect(mainExports.WebSocketTransport).toBeDefined();
    });

    it('should export utility functions', () => {
        expect(typeof mainExports.toRequestMessage).toBe('function');
        expect(typeof mainExports.toResponseMessage).toBe('function');
        expect(typeof mainExports.createHttpRequest).toBe('function');
        expect(typeof mainExports.createHttpResponse).toBe('function');
        expect(typeof mainExports.extractContent).toBe('function');
        expect(typeof mainExports.generateId).toBe('function');
        expect(typeof mainExports.normalizeHeaders).toBe('function');
        expect(typeof mainExports.safeJsonParse).toBe('function');
    });
});

describe('Browser entry (browser.ts)', () => {
    it('should export RemoteExecutor', () => {
        expect(browserExports.RemoteExecutor).toBeDefined();
    });

    it('should export HttpClient', () => {
        expect(browserExports.HttpClient).toBeDefined();
    });

    it('should export WebSocketTransport', () => {
        expect(browserExports.WebSocketTransport).toBeDefined();
    });

    it('should export utility functions', () => {
        expect(typeof browserExports.toRequestMessage).toBe('function');
        expect(typeof browserExports.toResponseMessage).toBe('function');
        expect(typeof browserExports.generateId).toBe('function');
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

        // eslint-disable-next-line no-restricted-syntax -- dynamic import required: vi.mock must run before module loads
        const mod = await import('../server');
        expect(mod.RemoteServer).toBeDefined();
    });
});
