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
const mockLoadContext = vi.fn().mockResolvedValue({ agentsMd: '', projectNotesMd: '' });
vi.mock('../../context/context-loader.js', () => ({
  loadContext: mockLoadContext,
}));

// Mock detectProject — bare mode must skip this
const mockDetectProject = vi.fn().mockResolvedValue({ type: 'unknown', language: 'unknown' });
vi.mock('../../context/project-detector.js', () => ({
  detectProject: mockDetectProject,
}));

// Mock loadConfigWithHookSources — always returns a minimal valid config plus empty provenance.
const mockLoadConfigWithHookSources = vi.fn().mockResolvedValue({
  config: {
    defaultTrustLevel: 'moderate',
    provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
    permissions: { allow: [], deny: [] },
    language: 'en',
    env: {},
  },
  hookSources: [],
});
vi.mock('../../config/config-loader.js', () => ({
  loadConfigWithHookSources: mockLoadConfigWithHookSources,
}));

// Mock the plugin loader — bare mode must skip plugin loading.
// PLG-021: the module under test now builds its loader through the composition root
// (`createHostBundlePluginLoader`) rather than the bare constructor, so that is what is stubbed.
// `BundlePluginLoader` stays in the mock because the module's TYPE surface still names it.
const mockLoadPluginsSync = vi.fn().mockReturnValue([]);
vi.mock('../../plugins/index.js', () => ({
  createHostBundlePluginLoader: vi.fn().mockImplementation(() => ({
    loadPluginsSync: mockLoadPluginsSync,
  })),
  BundlePluginLoader: vi.fn().mockImplementation(() => ({
    loadPluginsSync: mockLoadPluginsSync,
  })),
}));

// Mock agent-sessions so we don't need real file I/O
vi.mock('@robota-sdk/agent-session', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-session');
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
    mockLoadConfigWithHookSources.mockClear();
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
    // ARCH-042: no project-access decision means Restricted, so no project source is passed.
    // SELFHOST-008/NEUT-004: the optional memory store and context options remain explicit.
    expect(mockLoadContext).toHaveBeenCalledWith(undefined, undefined, {});
  });

  it('bare=false without project access: detectProject is not called', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: false,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    expect(mockDetectProject).not.toHaveBeenCalled();
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
    expect(typeof session.session.getSessionId).toBe('function');
  });

  it('bare=true: loadConfigWithHookSources IS still called (config loading is not skipped)', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });

    // Config loading is always needed even in bare mode
    expect(mockLoadConfigWithHookSources).toHaveBeenCalledTimes(1);
    expect(mockLoadConfigWithHookSources).toHaveBeenCalledWith([]);
  });
});

describe('createInteractiveSession — skipConfiguredHooks (issue #3082)', () => {
  it('runs no hook a settings layer declares', async () => {
    const hooks = {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo x' }] }],
    };
    mockLoadConfigWithHookSources.mockResolvedValue({
      config: {
        defaultTrustLevel: 'moderate',
        provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
        permissions: { allow: [], deny: [] },
        language: 'en',
        env: {},
        hooks,
      },
      hookSources: [{ event: 'PreToolUse', type: 'command', source: 'user' }],
    });
    const { createInteractiveSession } = await import('../interactive-session-init.js');
    const { Session } = await import('@robota-sdk/agent-session');
    const constructed = vi.mocked(Session);

    constructed.mockClear();
    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });
    expect(JSON.stringify(constructed.mock.calls[0]?.[0]?.hooks)).toContain('echo x');

    constructed.mockClear();
    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      skipConfiguredHooks: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
    });
    expect(JSON.stringify(constructed.mock.calls[0]?.[0]?.hooks ?? {})).not.toContain('echo x');
  });
});

describe('initializeInteractiveSessionAsync — skipConfiguredHooks reaches the session (issue #3082)', () => {
  it('drops settings hooks on the path every InteractiveSession takes', async () => {
    mockLoadConfigWithHookSources.mockResolvedValue({
      config: {
        defaultTrustLevel: 'moderate',
        provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
        permissions: { allow: [], deny: [] },
        language: 'en',
        env: {},
        hooks: {
          UserPromptSubmit: [
            { matcher: '', hooks: [{ type: 'command', command: 'echo HOOKMARK' }] },
          ],
        },
      },
      hookSources: [{ event: 'UserPromptSubmit', type: 'command', source: 'user' }],
    });
    const { initializeInteractiveSessionAsync } = await import('../interactive-session-init.js');
    const { Session } = await import('@robota-sdk/agent-session');
    const constructed = vi.mocked(Session);
    const deps = {
      sandboxSnapshotId: undefined,
      resumeSessionId: undefined,
      pendingRestoreMessages: null,
      permissionHandler: undefined,
      askHandler: undefined,
      onTextDelta: () => {},
      onContextUpdate: () => {},
      onCompactEvent: () => {},
      onToolExecution: () => {},
      executeModelCommand: () => Promise.resolve(null),
      isModelCommandInvocable: () => false,
      commandDescriptors: [],
      commandSemanticRoles: undefined,
      setEditCheckpointStore: () => {},
    } as never;

    constructed.mockClear();
    await initializeInteractiveSessionAsync(
      { cwd: '/tmp/test', provider: createMockProvider(), skipConfiguredHooks: true },
      deps,
    );
    expect(JSON.stringify(constructed.mock.calls[0]?.[0]?.hooks ?? {})).not.toContain('HOOKMARK');

    constructed.mockClear();
    await initializeInteractiveSessionAsync(
      { cwd: '/tmp/test', provider: createMockProvider() },
      deps,
    );
    expect(JSON.stringify(constructed.mock.calls[0]?.[0]?.hooks)).toContain('HOOKMARK');
  });
});
