/**
 * Export Entry Point Tests
 *
 * Verifies that the public API surface exports are accessible.
 * Server code has been moved to agent-transport-http.
 * This package is client-only.
 */

import { describe, it, expect } from 'vitest';
import * as mainExports from '../index.js';

describe('Client exports (index.ts)', () => {
  it('should export RemoteExecutor', () => {
    expect(mainExports.RemoteExecutor).toBeDefined();
  });

  it('should export HttpClient', () => {
    expect(mainExports.HttpClient).toBeDefined();
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
