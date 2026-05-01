/**
 * Behavioral tests for new createSession options: allowedTools and appendSystemPrompt.
 *
 * Verifies:
 * - allowedTools: ['Bash', 'Read'] → Session receives permissions.allow containing 'Bash(*)' and 'Read(*)'
 * - appendSystemPrompt: 'EXTRA TEXT' → Session receives systemMessage ending with '\n\nEXTRA TEXT'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Capture all Session constructor calls to inspect the options passed
const sessionCtorCalls: Array<Record<string, unknown>> = [];

vi.mock('@robota-sdk/agent-sessions', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-sessions');
  return {
    ...actual,
    Session: vi.fn().mockImplementation((options: Record<string, unknown>) => {
      sessionCtorCalls.push(options);
      // Return a minimal mock session
      return {
        getSessionId: vi.fn().mockReturnValue('test-session-id'),
        run: vi.fn().mockResolvedValue('mock response'),
        abort: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
        injectMessage: vi.fn(),
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
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    runHooks: vi.fn().mockResolvedValue({ blocked: false }),
  };
});

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

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

function baseConfig() {
  return {
    defaultTrustLevel: 'moderate' as const,
    provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
    permissions: { allow: [], deny: [] },
    language: 'en' as const,
    env: {},
  };
}

describe('createSession — allowedTools option', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('passes allowedTools as ToolName(*) patterns in permissions.allow', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      allowedTools: ['Bash', 'Read'],
    });

    expect(sessionCtorCalls.length).toBe(1);
    const opts = sessionCtorCalls[0]!;
    const allow = (opts.permissions as { allow: string[] }).allow;
    expect(allow).toContain('Bash(*)');
    expect(allow).toContain('Read(*)');
  });

  it('permissions.allow includes Bash(*) and Read(*) alongside default allow patterns', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      allowedTools: ['Bash', 'Read'],
    });

    const opts = sessionCtorCalls[0]!;
    const allow = (opts.permissions as { allow: string[] }).allow;

    // Should still include the default config folder allow patterns
    expect(allow.some((p: string) => p.startsWith('Read(.agents/'))).toBe(true);
    // And the new allowedTools patterns
    expect(allow).toContain('Bash(*)');
    expect(allow).toContain('Read(*)');
  });

  it('empty allowedTools produces no extra ToolName(*) patterns beyond defaults', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      allowedTools: [],
    });

    const opts = sessionCtorCalls[0]!;
    const allow = (opts.permissions as { allow: string[] }).allow;

    // Bash(*) should NOT appear when allowedTools is empty
    expect(allow).not.toContain('Bash(*)');
    expect(allow).not.toContain('Read(*)');
  });

  it('omitting allowedTools does not add any ToolName(*) patterns', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      // allowedTools not provided
    });

    const opts = sessionCtorCalls[0]!;
    const allow = (opts.permissions as { allow: string[] }).allow;

    // No Bash(*) or Read(*) should appear when allowedTools is not specified
    const toolStarPatterns = allow.filter((p: string) => /^\w+\(\*\)$/.test(p));
    expect(toolStarPatterns).toHaveLength(0);
  });
});

describe('createSession — appendSystemPrompt option', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('appends text to system message separated by double newline', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      appendSystemPrompt: 'EXTRA TEXT',
    });

    expect(sessionCtorCalls.length).toBe(1);
    const opts = sessionCtorCalls[0]!;
    const systemMessage = opts.systemMessage as string;
    expect(systemMessage.endsWith('\n\nEXTRA TEXT')).toBe(true);
  });

  it('system message without appendSystemPrompt does not have trailing double newline', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      // no appendSystemPrompt
    });

    const opts = sessionCtorCalls[0]!;
    const systemMessage = opts.systemMessage as string;
    expect(systemMessage.endsWith('\n\nEXTRA TEXT')).toBe(false);
  });

  it('appendSystemPrompt with multi-word text is appended verbatim after \\n\\n', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const extraText = 'You must respond only in JSON format.';

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      appendSystemPrompt: extraText,
    });

    const opts = sessionCtorCalls[0]!;
    const systemMessage = opts.systemMessage as string;
    expect(systemMessage).toContain('\n\n' + extraText);
    expect(systemMessage.endsWith(extraText)).toBe(true);
  });

  it('does not include Agent tool or agent metadata unless agent runtime is enabled', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    const opts = sessionCtorCalls[0]!;
    const systemMessage = opts.systemMessage as string;
    expect(systemMessage).not.toContain('Agent — launch an isolated agent');
    expect(systemMessage).not.toContain('general-purpose');
  });

  it('includes Agent tool and discovered agent metadata when agent runtime is enabled', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const cwd = mkdtempSync(join(tmpdir(), 'robota-create-session-agents-'));
    const agentsDir = join(cwd, '.robota', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'reviewer.md'),
      [
        '---',
        'name: reviewer',
        'description: Reviews code for risks and missing tests',
        '---',
        'Review code like an owner.',
      ].join('\n'),
      'utf-8',
    );

    try {
      createSession({
        config: baseConfig(),
        cwd,
        context: { agentsMd: '', claudeMd: '' },
        terminal: MOCK_TERMINAL,
        provider: createMockProvider(),
        enableAgentRuntime: true,
      });

      const opts = sessionCtorCalls[0]!;
      const systemMessage = opts.systemMessage as string;
      expect(systemMessage).toContain('Agent — launch an isolated agent');
      expect(systemMessage).toContain('one Agent tool call per role');
      expect(systemMessage).toContain('choose one backlog');
      expect(systemMessage).not.toContain('<agent');
      expect(systemMessage).toContain('- reviewer: Reviews code for risks and missing tests');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('createSession — subagent runner factory option', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('uses an injected subagent runner factory with the assembled agent tool dependencies', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const subagentRunnerFactory = vi.fn().mockReturnValue({
      start: vi.fn(),
    });

    createSession({
      config: baseConfig(),
      context: { agentsMd: 'agent context', claudeMd: 'claude context' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      subagentRunnerFactory,
      enableAgentRuntime: true,
    });

    expect(subagentRunnerFactory).toHaveBeenCalledTimes(1);
    const deps = subagentRunnerFactory.mock.calls[0]![0];
    expect(deps.config.provider.model).toBe('test-model');
    expect(deps.context.agentsMd).toBe('agent context');
    expect(deps.tools.map((tool: { getName: () => string }) => tool.getName())).toContain('Bash');
  });
});
