import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IWorkspaceManifest } from '@robota-sdk/agent-tools';

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

/** The session's working directory: private to this run, never a fixed name under /tmp. */
const SESSION_CWD = mkdtempSync(join(tmpdir(), 'robota-manifest-session-'));
afterAll(() => rmSync(SESSION_CWD, { recursive: true, force: true }));

describe('createInteractiveSession — workspace manifest', () => {
  beforeEach(() => {
    mockLoadConfigWithHookSources.mockClear();
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
      cwd: SESSION_CWD,
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
        cwd: SESSION_CWD,
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
