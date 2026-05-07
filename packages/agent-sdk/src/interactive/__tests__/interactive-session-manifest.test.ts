import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import type { IWorkspaceManifest } from '@robota-sdk/agent-tools';

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

describe('createInteractiveSession — workspace manifest', () => {
  beforeEach(() => {
    mockLoadConfig.mockClear();
  });

  it('applies the workspace manifest to the sandbox before session creation', async () => {
    const sandboxClient = new InMemorySandboxClient();
    const workspaceManifest: IWorkspaceManifest = {
      entries: {
        'task.md': { type: 'file', content: 'Prepare the workspace.\n' },
      },
    };
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await createInteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      onTextDelta: NOOP_DELTA,
      onToolExecution: NOOP_TOOL,
      sandboxClient,
      workspaceManifest,
    });

    expect(sandboxClient.getFile('/workspace/task.md')).toBe('Prepare the workspace.\n');
  });

  it('requires a sandbox client when a workspace manifest is provided', async () => {
    const { createInteractiveSession } = await import('../interactive-session-init.js');

    await expect(
      createInteractiveSession({
        cwd: '/tmp/test',
        provider: createMockProvider(),
        bare: true,
        onTextDelta: NOOP_DELTA,
        onToolExecution: NOOP_TOOL,
        workspaceManifest: {
          entries: {
            'task.md': { type: 'file', content: 'Prepare the workspace.\n' },
          },
        },
      }),
    ).rejects.toThrow(/workspaceManifest requires sandboxClient/);
  });
});
