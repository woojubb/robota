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
import type { IResolvedConfig } from '../config/config-types.js';
import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { TToolResult } from '@robota-sdk/agent-tools';

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

function baseConfig(): IResolvedConfig {
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

  it('does not include agent metadata unless agent runtime is enabled', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    const opts = sessionCtorCalls[0]!;
    const systemMessage = opts.systemMessage as string;
    const tools = opts.tools as IToolWithEventService[];
    expect(tools.some((tool) => tool.getName() === 'Agent')).toBe(false);
    expect(systemMessage).not.toContain('general-purpose');
  });

  it('includes discovered agent metadata without registering a duplicate Agent tool', async () => {
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
      const tools = opts.tools as IToolWithEventService[];
      expect(tools.some((tool) => tool.getName() === 'Agent')).toBe(false);
      expect(systemMessage).not.toContain('<agent');
      expect(systemMessage).toContain('- reviewer: Reviews code for risks and missing tests');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('createSession — command descriptor tool guidance', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('does not register projected command tools when no command descriptor is model-invocable', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      commandDescriptors: [
        {
          name: 'skills',
          kind: 'builtin-command',
          description: 'Skill discovery command.',
          userInvocable: true,
          modelInvocable: false,
          safety: 'read-only',
        },
      ],
      modelCommandExecutor: vi.fn(),
      isModelCommandInvocable: () => false,
    });

    const opts = sessionCtorCalls[0]!;
    const tools = opts.tools as IToolWithEventService[];
    expect(tools.some((tool) => tool.getName() === 'ExecuteCommand')).toBe(false);
    expect(tools.some((tool) => tool.getName().startsWith('robota_command_'))).toBe(false);
  });

  it('does not expose skill metadata when the skills command is not model-invocable', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const cwd = mkdtempSync(join(tmpdir(), 'robota-create-session-skills-hidden-'));
    mkdirSync(join(cwd, '.agents', 'skills', 'audit'), { recursive: true });
    writeFileSync(
      join(cwd, '.agents', 'skills', 'audit', 'SKILL.md'),
      ['---', 'name: audit', 'description: Audit code', '---', 'Audit $ARGUMENTS'].join('\n'),
      'utf-8',
    );

    try {
      createSession({
        config: baseConfig(),
        cwd,
        context: { agentsMd: '', claudeMd: '' },
        terminal: MOCK_TERMINAL,
        provider: createMockProvider(),
      });

      const opts = sessionCtorCalls[0]!;
      const systemMessage = opts.systemMessage as string;
      expect(systemMessage).not.toContain('## Skills');
      expect(systemMessage).not.toContain('audit: Audit code');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('exposes skill metadata when the skills command is model-invocable', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const cwd = mkdtempSync(join(tmpdir(), 'robota-create-session-skills-visible-'));
    mkdirSync(join(cwd, '.agents', 'skills', 'audit'), { recursive: true });
    writeFileSync(
      join(cwd, '.agents', 'skills', 'audit', 'SKILL.md'),
      ['---', 'name: audit', 'description: Audit code', '---', 'Audit $ARGUMENTS'].join('\n'),
      'utf-8',
    );

    try {
      createSession({
        config: baseConfig(),
        cwd,
        context: { agentsMd: '', claudeMd: '' },
        terminal: MOCK_TERMINAL,
        provider: createMockProvider(),
        commandDescriptors: [
          {
            name: 'skills',
            kind: 'builtin-command',
            description: 'Skill discovery command.',
            userInvocable: true,
            modelInvocable: true,
            safety: 'read-only',
          },
        ],
        modelCommandExecutor: vi.fn(),
        isModelCommandInvocable: () => true,
      });

      const opts = sessionCtorCalls[0]!;
      const systemMessage = opts.systemMessage as string;
      expect(systemMessage).toContain('## Skills');
      expect(systemMessage).toContain('- audit: Audit code');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('projects registered command descriptors into provider-safe command tools', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      commandDescriptors: [
        {
          name: 'compact',
          kind: 'builtin-command',
          description:
            'Context compaction command. Call it when the user explicitly requests compaction.',
          userInvocable: true,
          modelInvocable: true,
          safety: 'write',
        },
      ],
      modelCommandExecutor: vi.fn(),
      isModelCommandInvocable: (command) => command === 'compact',
    });

    const opts = sessionCtorCalls[0]!;
    const tools = opts.tools as IToolWithEventService[];
    const compactTool = tools.find((tool) => tool.getName() === 'robota_command_compact');

    expect(tools.some((tool) => tool.getName() === 'ExecuteCommand')).toBe(false);
    expect(compactTool?.schema.description).toContain('explicitly requests compaction');
    expect(compactTool?.schema.description).toContain('Robota command id: compact.');
    expect(compactTool?.schema.description).not.toContain('/compact');
  });
});

describe('createSession — provider timeout option', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('passes configured provider timeout to Session', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const config = baseConfig();
    config.provider.timeout = 4321;

    createSession({
      config,
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    expect(sessionCtorCalls[0]!['providerTimeout']).toBe(4321);
  });

  it('passes the SDK default provider timeout when config omits timeout', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    expect(sessionCtorCalls[0]!['providerTimeout']).toBe(120000);
  });
});

describe('createSession — sandbox client option', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('assembles sandbox-aware default tools when sandboxClient is provided', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const sandboxClient = new InMemorySandboxClient({
      runHandler: () => ({ stdout: 'from sandbox', stderr: '', exitCode: 0 }),
    });

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      sandboxClient,
    });

    const tools = sessionCtorCalls[0]!['tools'] as IToolWithEventService[];
    const bashTool = tools.find((tool) => tool.getName() === 'Bash');
    expect(bashTool).toBeDefined();

    const rawResult = await bashTool!.execute(
      { command: 'echo host should not run' },
      { toolName: 'Bash', parameters: { command: 'echo host should not run' } },
    );
    const result = JSON.parse(rawResult.data as string) as TToolResult;
    expect(result.output).toBe('from sandbox');
  });

  it('treats reversible execution as provider-sandbox isolated when sandboxClient is present', async () => {
    const { createSession } = await import('../assembly/create-session.js');
    const sandboxClient = new InMemorySandboxClient({
      runHandler: () => ({ stdout: 'isolated', stderr: '', exitCode: 0 }),
    });

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      sandboxClient,
      reversibleExecution: { mode: 'local-first' },
    });

    const tools = sessionCtorCalls[0]!['tools'] as IToolWithEventService[];
    const bashTool = tools.find((tool) => tool.getName() === 'Bash');
    const writeTool = tools.find((tool) => tool.getName() === 'Write');
    const rawResult = await bashTool!.execute(
      { command: 'touch isolated.txt' },
      { toolName: 'Bash', parameters: { command: 'touch isolated.txt' } },
    );
    const result = JSON.parse(rawResult.data as string) as TToolResult;
    const rawWriteResult = await writeTool!.execute(
      { filePath: '/workspace/generated.ts', content: 'export const isolated = true;\n' },
      {
        toolName: 'Write',
        parameters: {
          filePath: '/workspace/generated.ts',
          content: 'export const isolated = true;\n',
        },
      },
    );
    const writeResult = JSON.parse(rawWriteResult.data as string) as TToolResult;

    expect(result).toMatchObject({
      success: true,
      output: 'isolated',
      exitCode: 0,
    });
    expect(writeResult.success).toBe(true);
    expect(sandboxClient.getFile('/workspace/generated.ts')).toBe(
      'export const isolated = true;\n',
    );
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
