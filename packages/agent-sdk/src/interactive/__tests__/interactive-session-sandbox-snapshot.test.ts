import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createUserMessage } from '@robota-sdk/agent-core';
import type { ISandboxClient } from '@robota-sdk/agent-tools';
import type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
} from '../session-persistence.js';

const events: string[] = [];

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
    Session: vi.fn().mockImplementation(() => {
      events.push('session-created');
      return {
        getSessionId: vi.fn().mockReturnValue('session-restore'),
        run: vi.fn().mockResolvedValue('mock response'),
        abort: vi.fn(),
        shutdown: vi.fn().mockResolvedValue(undefined),
        getHistory: vi.fn().mockReturnValue([]),
        getFullHistory: vi.fn().mockReturnValue([]),
        getSystemMessage: vi.fn().mockReturnValue('system prompt'),
        getToolSchemas: vi.fn().mockReturnValue([]),
        getContextState: vi.fn().mockReturnValue({
          usedTokens: 0,
          maxTokens: 200000,
          usedPercentage: 0,
          remainingTokens: 200000,
        }),
        getAutoCompactThreshold: vi.fn().mockReturnValue(0.835),
        setAutoCompactThreshold: vi.fn(),
        compact: vi.fn().mockResolvedValue(undefined),
        clearHistory: vi.fn(),
        injectMessage: vi.fn((role: string, content: string) => {
          events.push(`message-injected:${role}:${content}`);
        }),
        getSessionAllowedTools: vi.fn().mockReturnValue([]),
        clearSessionAllowedTools: vi.fn(),
      };
    }),
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
      getFullHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
      addHistoryEntry: vi.fn(),
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

function createMemorySessionStore(record: IInteractiveSessionRecord): IInteractiveSessionStore {
  const records = new Map<string, IInteractiveSessionRecord>([[record.id, record]]);
  return {
    save(session) {
      records.set(session.id, session);
    },
    load(id) {
      return records.get(id);
    },
    list() {
      return [...records.values()];
    },
    delete(id) {
      records.delete(id);
    },
  };
}

function createRestoringSandboxClient(): ISandboxClient {
  return {
    async run() {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async restore(snapshotId: string) {
      events.push(`sandbox-restored:${snapshotId}`);
    },
  };
}

function createSnapshottingSandboxClient(snapshotId: string): ISandboxClient {
  return {
    async run() {
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    async readFile() {
      return '';
    },
    async writeFile() {},
    async snapshot() {
      events.push(`sandbox-snapshotted:${snapshotId}`);
      return snapshotId;
    },
  };
}

describe('InteractiveSession sandbox snapshot hydration', () => {
  beforeEach(() => {
    events.length = 0;
    mockLoadConfig.mockClear();
  });

  it('restores the sandbox snapshot before replaying saved messages', async () => {
    const { InteractiveSession } = await import('../interactive-session.js');
    const sessionStore = createMemorySessionStore({
      id: 'session-restore',
      cwd: '/tmp/test',
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:01:00.000Z',
      messages: [createUserMessage('previous prompt')],
      sandboxSnapshotId: 'sandbox-123',
    });

    const interactiveSession = new InteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      sessionStore,
      resumeSessionId: 'session-restore',
      sandboxClient: createRestoringSandboxClient(),
    });

    await interactiveSession.shutdown();

    expect(events).toEqual([
      'sandbox-restored:sandbox-123',
      'session-created',
      'message-injected:user:previous prompt',
    ]);
  });

  it('snapshots sandbox state on shutdown and persists the snapshot id', async () => {
    const { InteractiveSession } = await import('../interactive-session.js');
    const sessionStore = createMemorySessionStore({
      id: 'session-restore',
      cwd: '/tmp/test',
      createdAt: '2026-05-05T00:00:00.000Z',
      updatedAt: '2026-05-05T00:01:00.000Z',
      messages: [],
    });

    const interactiveSession = new InteractiveSession({
      cwd: '/tmp/test',
      provider: createMockProvider(),
      bare: true,
      sessionStore,
      sandboxClient: createSnapshottingSandboxClient('snapshot-after-shutdown'),
    });

    await interactiveSession.shutdown();

    expect(events).toContain('sandbox-snapshotted:snapshot-after-shutdown');
    expect(sessionStore.load('session-restore')?.sandboxSnapshotId).toBe('snapshot-after-shutdown');
  });
});
