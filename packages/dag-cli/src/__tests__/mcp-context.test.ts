import { describe, it, expect, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockRejectedValue({ code: 'ENOENT' }),
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
}));

vi.mock('../run-store.js', () => ({
  getRunStore: vi.fn(() => ({
    insert: vi.fn(),
    list: vi.fn(() => []),
  })),
}));

vi.mock('../local-runner/index.js', async () => {
  const actual = await vi.importActual<typeof import('../local-runner/index.js')>(
    '../local-runner/index.js',
  );
  return {
    ...actual,
    createCliNodeRegistry: vi.fn(() => [
      {
        nodeType: 'input',
        displayName: 'Input',
        description: 'Input node',
        inputs: [],
        outputs: [{ key: 'text', type: 'string' }],
      },
    ]),
  };
});

import { createMcpServerContext } from '../mcp/context.js';

describe('createMcpServerContext', () => {
  it('returns context with expected interface', () => {
    const ctx = createMcpServerContext({});
    expect(typeof ctx.getAllDefinitions).toBe('function');
    expect(typeof ctx.getManifests).toBe('function');
    expect(typeof ctx.invalidateNodeCache).toBe('function');
    expect(typeof ctx.addCompletedRun).toBe('function');
    expect(typeof ctx.getCompletedRun).toBe('function');
    expect(Array.isArray(ctx.instantNodeDefinitions)).toBe(true);
  });

  it('getAllDefinitions returns node definitions', () => {
    const ctx = createMcpServerContext({});
    const defs = ctx.getAllDefinitions();
    expect(Array.isArray(defs)).toBe(true);
    expect(defs.length).toBeGreaterThan(0);
  });

  it('getAllDefinitions caches result on second call', async () => {
    const { createCliNodeRegistry } = await import('../local-runner/index.js');
    vi.mocked(createCliNodeRegistry).mockClear();
    const ctx = createMcpServerContext({});
    ctx.getAllDefinitions();
    ctx.getAllDefinitions();
    expect(vi.mocked(createCliNodeRegistry)).toHaveBeenCalledTimes(1);
  });

  it('invalidateNodeCache clears the cached definitions', async () => {
    const { createCliNodeRegistry } = await import('../local-runner/index.js');
    vi.mocked(createCliNodeRegistry).mockClear();
    const ctx = createMcpServerContext({});
    ctx.getAllDefinitions(); // populates cache
    ctx.invalidateNodeCache();
    ctx.getAllDefinitions(); // should repopulate
    expect(vi.mocked(createCliNodeRegistry)).toHaveBeenCalledTimes(2);
  });

  it('getManifests returns manifest array', () => {
    const ctx = createMcpServerContext({});
    const manifests = ctx.getManifests();
    expect(Array.isArray(manifests)).toBe(true);
  });

  it('addCompletedRun and getCompletedRun work together', () => {
    const ctx = createMcpServerContext({});
    const record = {
      dagRunId: 'run-123',
      status: 'success' as const,
      completedAt: Date.now(),
      durationMs: 100,
      nodeStatuses: [],
    };
    ctx.addCompletedRun(record);
    const retrieved = ctx.getCompletedRun('run-123');
    expect(retrieved).toBeDefined();
    expect(retrieved?.dagRunId).toBe('run-123');
  });

  it('getCompletedRun returns undefined for unknown run', () => {
    const ctx = createMcpServerContext({});
    expect(ctx.getCompletedRun('unknown-run')).toBeUndefined();
  });

  it('addCompletedRun evicts old entries', () => {
    const ctx = createMcpServerContext({});
    // Add an expired record (in the past)
    const oldRecord = {
      dagRunId: 'old-run',
      status: 'success' as const,
      completedAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      durationMs: 100,
      nodeStatuses: [],
    };
    ctx.addCompletedRun(oldRecord);

    // Add a new record — should evict the old one
    const newRecord = {
      dagRunId: 'new-run',
      status: 'success' as const,
      completedAt: Date.now(),
      durationMs: 100,
      nodeStatuses: [],
    };
    ctx.addCompletedRun(newRecord);

    // Old record should be gone (expired)
    expect(ctx.getCompletedRun('old-run')).toBeUndefined();
    expect(ctx.getCompletedRun('new-run')).toBeDefined();
  });

  it('stores options in context', () => {
    const options = { skipConnect: true, projectDir: '/tmp/test' };
    const ctx = createMcpServerContext(options);
    expect(ctx.options).toBe(options);
  });
});
