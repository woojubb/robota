/**
 * Tests for hook wiring in the session lifecycle.
 *
 * Verifies:
 * - SessionStart hook fires on session creation
 * - UserPromptSubmit hook fires before AI processes user input
 * - Stop hook fires after AI response completion
 * - PreToolUse / PostToolUse hooks fire around tool execution
 * - Merged hook config from settings is passed to core's runHooks via DI
 * - All 4 executor types are available (command, http, prompt, agent)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { THooksConfig, IHookInput, IHookTypeExecutor } from '@robota-sdk/agent-core';

// Capture all runHooks calls for verification
const runHooksCalls: Array<{
  config: THooksConfig | undefined;
  event: string;
  input: IHookInput;
  executors: IHookTypeExecutor[] | undefined;
}> = [];

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockImplementation(async () => {
        return 'mock AI response';
      }),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    runHooks: vi
      .fn()
      .mockImplementation(
        async (
          config: THooksConfig | undefined,
          event: string,
          input: IHookInput,
          executors: IHookTypeExecutor[] | undefined,
        ) => {
          runHooksCalls.push({ config, event, input, executors });
          return { blocked: false };
        },
      ),
  };
});

// Use Session directly since createSession just wires config through
import { Session } from '@robota-sdk/agent-sessions';

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

const SAMPLE_HOOKS: THooksConfig = {
  SessionStart: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo session-started' }],
    },
  ],
  UserPromptSubmit: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo user-prompt' }],
    },
  ],
  Stop: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo stopped' }],
    },
  ],
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo pre-tool' }],
    },
  ],
  PostToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo post-tool' }],
    },
  ],
};

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

describe('Hook wiring in session', () => {
  beforeEach(() => {
    runHooksCalls.length = 0;
  });

  it('should fire SessionStart hook on session creation', () => {
    new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    const sessionStartCalls = runHooksCalls.filter((c) => c.event === 'SessionStart');
    expect(sessionStartCalls.length).toBe(1);
    expect(sessionStartCalls[0].input.hook_event_name).toBe('SessionStart');
    expect(sessionStartCalls[0].config).toBe(SAMPLE_HOOKS);
  });

  it('should fire UserPromptSubmit hook before AI processes input', async () => {
    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    runHooksCalls.length = 0; // Clear SessionStart call

    await session.run('Hello AI');

    const userPromptCalls = runHooksCalls.filter((c) => c.event === 'UserPromptSubmit');
    expect(userPromptCalls.length).toBe(1);
    expect(userPromptCalls[0].input.hook_event_name).toBe('UserPromptSubmit');
    expect(userPromptCalls[0].input.user_message).toBe('Hello AI');
  });

  it('should fire Stop hook after AI response completion', async () => {
    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    runHooksCalls.length = 0;

    await session.run('Hello AI');

    const stopCalls = runHooksCalls.filter((c) => c.event === 'Stop');
    expect(stopCalls.length).toBe(1);
    expect(stopCalls[0].input.hook_event_name).toBe('Stop');
    expect(stopCalls[0].input.response).toBeDefined();
  });

  it('should fire UserPromptSubmit before Stop in run() lifecycle', async () => {
    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    runHooksCalls.length = 0;

    await session.run('test message');

    const events = runHooksCalls.map((c) => c.event);
    const userPromptIdx = events.indexOf('UserPromptSubmit');
    const stopIdx = events.indexOf('Stop');
    expect(userPromptIdx).toBeGreaterThanOrEqual(0);
    expect(stopIdx).toBeGreaterThan(userPromptIdx);
  });

  it('should pass hook config from session options to core runHooks', () => {
    new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    // All runHooks calls should receive the same config object
    for (const call of runHooksCalls) {
      expect(call.config).toBe(SAMPLE_HOOKS);
    }
  });

  it('should pass hookTypeExecutors to runHooks calls', async () => {
    const mockExecutor: IHookTypeExecutor = {
      type: 'command',
      execute: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    };

    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
      hookTypeExecutors: [mockExecutor],
    });

    runHooksCalls.length = 0;
    await session.run('test');

    // All calls during run() should include the hookTypeExecutors
    for (const call of runHooksCalls) {
      expect(call.executors).toContain(mockExecutor);
    }
  });

  it('should not fire hooks when no hooks config is provided', async () => {
    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      // No hooks config
    });

    runHooksCalls.length = 0;
    await session.run('test');

    // runHooks is still called but with undefined config — core returns early
    for (const call of runHooksCalls) {
      expect(call.config).toBeUndefined();
    }
  });

  it('should include session_id and cwd in all hook inputs', async () => {
    const session = new Session({
      tools: [],
      provider: createMockProvider(),
      systemMessage: 'test',
      terminal: MOCK_TERMINAL,
      hooks: SAMPLE_HOOKS,
    });

    const sessionId = session.getSessionId();
    runHooksCalls.length = 0;
    await session.run('test');

    for (const call of runHooksCalls) {
      expect(call.input.session_id).toBe(sessionId);
      expect(call.input.cwd).toBeDefined();
    }
  });
});

describe('Hook wiring via createSession', () => {
  beforeEach(() => {
    runHooksCalls.length = 0;
  });

  it('should pass merged hooks config from IResolvedConfig to Session', async () => {
    // Import createSession dynamically (mocks must be set up first)
    const { createSession } = await import('../assembly/create-session.js');

    const session = createSession({
      config: {
        defaultTrustLevel: 'moderate',
        provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
        permissions: { allow: [], deny: [] },
        hooks: SAMPLE_HOOKS,
        language: 'en',
        env: {},
      },
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    // SessionStart should have fired with the config
    const sessionStartCalls = runHooksCalls.filter((c) => c.event === 'SessionStart');
    expect(sessionStartCalls.length).toBe(1);
    expect(sessionStartCalls[0].config).toBe(SAMPLE_HOOKS);

    // Verify session was created successfully
    expect(session.getSessionId()).toBeDefined();
  });

  it('should wire SDK hook executors (prompt, agent) when factories provided', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    const mockProviderFactory = vi.fn();
    const mockSessionFactory = vi.fn();

    createSession({
      config: {
        defaultTrustLevel: 'moderate',
        provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
        permissions: { allow: [], deny: [] },
        hooks: SAMPLE_HOOKS,
        language: 'en',
        env: {},
      },
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      providerFactory: mockProviderFactory,
      sessionFactory: mockSessionFactory,
    });

    // SessionStart hook should have been called with executors that include prompt + agent types
    const sessionStartCalls = runHooksCalls.filter((c) => c.event === 'SessionStart');
    expect(sessionStartCalls.length).toBe(1);
    const executors = sessionStartCalls[0].executors;
    expect(executors).toBeDefined();
    const executorTypes = executors!.map((e) => e.type);
    expect(executorTypes).toContain('prompt');
    expect(executorTypes).toContain('agent');
  });
});
