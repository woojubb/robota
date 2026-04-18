/**
 * Tests for bare mode in createInteractiveSession.
 *
 * Verifies:
 * - bare=true: loadContext is NOT called, BundlePluginLoader.loadPluginsSync is NOT called
 * - bare=false (default): loadContext IS called
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock loadContext — bare mode must skip this
// Paths are relative to the test file location (interactive/__tests__/)
const mockLoadContext = vi.fn().mockResolvedValue({ agentsMd: '', claudeMd: '' });
vi.mock('../../context/context-loader.js', () => ({
  loadContext: mockLoadContext,
}));

// Mock detectProject — bare mode must skip this
const mockDetectProject = vi.fn().mockResolvedValue({ type: 'unknown', language: 'unknown' });
vi.mock('../../context/project-detector.js', () => ({
  detectProject: mockDetectProject,
}));

// Mock loadConfig — always returns a minimal valid config
const mockLoadConfig = vi.fn().mockResolvedValue({
  defaultTrustLevel: 'moderate',
  provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
  permissions: { allow: [], deny: [] },
  language: 'en',
  env: {},
});
vi.mock('../../config/config-loader.js', () => ({
  loadConfig: mockLoadConfig,
}));

// Mock BundlePluginLoader — bare mode must skip plugin loading
const mockLoadPluginsSync = vi.fn().mockReturnValue([]);
vi.mock('../../plugins/index.js', () => ({
  BundlePluginLoader: vi.fn().mockImplementation(() => ({
    loadPluginsSync: mockLoadPluginsSync,
  })),
}));

// Mock agent-sessions so we don't need real file I/O
vi.mock('@robota-sdk/agent-sessions', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-sessions');
  return {
    ...actual,
    Session: vi.fn().mockImplementation(() => ({
      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      run: vi.fn().mockResolvedValue('mock response'),
      abort: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    FileSessionLogger: vi.fn().mockImplementation(() => ({})),
  };
});

// Mock agent-core to avoid real Robota construction
vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('mock AI response'),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    runHooks: vi.fn().mockResolvedValue({ blocked: false }),
  };
});

function createMockProvider() {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: 'mock response',
      timestamp: new Date(),
    }),
  } as never;
}

const NOOP_DELTA = (): void => {};
const NOOP_TOOL = (): void => {};

describe('createInteractiveSession — bare mode', () => {
  beforeEach(() => {
    mockLoadContext.mockClear();
    mockDetectProject.mockClear();
    mockLoadConfig.mockClear();
    mockLoadPluginsSync.mockClear();
  });

  it('bare=true: loadContext is NOT called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockLoadContext).not.toHaveBeenCalled();
  });

  it('bare=true: detectProject is NOT called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockDetectProject).not.toHaveBeenCalled();
  });

  it('bare=true: plugin loading (loadPluginsSync) is NOT called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockLoadPluginsSync).not.toHaveBeenCalled();
  });

  it('bare=false (default): loadContext IS called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: false,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockLoadContext).toHaveBeenCalledTimes(1);
    expect(mockLoadContext).toHaveBeenCalledWith('/tmp/test');
  });

  it('bare=false (default): detectProject IS called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: false,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockDetectProject).toHaveBeenCalledTimes(1);
    expect(mockDetectProject).toHaveBeenCalledWith('/tmp/test');
  });

  it('bare omitted (default behavior): loadContext IS called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      // bare not specified → default false behavior
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockLoadContext).toHaveBeenCalledTimes(1);
  });

  it('bare=true: session is still successfully created and returned', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    const session = await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    // Should return a valid session object with getSessionId
    expect(session).toBeDefined();
    expect(typeof session.getSessionId).toBe('function');
  });

  it('bare=true: loadConfig IS still called (config loading is not skipped)', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    // Config loading is always needed even in bare mode
    expect(mockLoadConfig).toHaveBeenCalledTimes(1);
    expect(mockLoadConfig).toHaveBeenCalledWith('/tmp/test');
  });
});
