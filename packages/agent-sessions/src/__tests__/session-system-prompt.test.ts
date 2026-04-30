/**
 * Tests that Session correctly delivers the system prompt to the AI provider.
 *
 * Root cause this prevents: Session was setting systemMessage only in
 * agentConfig.defaultModel, but execution-service reads from
 * config.systemMessage (top-level). Without both, AGENTS.md content
 * was loaded but never reached the API.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { Session } from '../session.js';

// Capture the config passed to Robota constructor
let capturedConfig: Record<string, unknown> | null = null;
let mockRunResult = 'mock response';

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation((config: Record<string, unknown>) => {
      capturedConfig = config;
      return {
        run: vi.fn().mockImplementation(async () => mockRunResult),
        getHistory: vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
      };
    }),
  };
});

const MOCK_PROVIDER = {
  name: 'mock-provider',
  version: '1.0.0',
  chat: vi.fn().mockResolvedValue({
    role: 'assistant',
    content: 'mock',
    timestamp: new Date(),
  }),
  supportsTools: () => true,
  validateConfig: () => true,
};

const MOCK_TOOLS = [
  {
    schema: {
      name: 'Bash',
      description: 'Execute shell commands',
      parameters: { type: 'object', properties: {} },
    },
    execute: vi.fn(),
    getName: () => 'Bash',
    setEventService: vi.fn(),
  },
  {
    schema: {
      name: 'Read',
      description: 'Read file contents',
      parameters: { type: 'object', properties: {} },
    },
    execute: vi.fn(),
    getName: () => 'Read',
    setEventService: vi.fn(),
  },
];

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn().mockResolvedValue(''),
  select: vi.fn().mockResolvedValue(0),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
};

describe('Session — system prompt delivery', () => {
  beforeEach(() => {
    capturedConfig = null;
    mockRunResult = 'mock response';
  });

  it('should include AGENTS.md content in system prompt', () => {
    const agentsContent = '# My Project\nYou are a helpful assistant for this project.';
    const systemMessage = `Agent Instructions\n${agentsContent}\n\nAvailable tools: Bash, Read`;

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    expect(capturedConfig).not.toBeNull();

    // Top-level systemMessage must contain AGENTS.md content
    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toBeDefined();
    expect(topLevel.length).toBeGreaterThan(0);
    expect(topLevel).toContain('My Project');
    expect(topLevel).toContain('helpful assistant');
  });

  it('should include CLAUDE.md content in system prompt', () => {
    const claudeContent = 'Always use TypeScript strict mode.';
    const systemMessage = `Project Notes\n${claudeContent}\n\nAvailable tools: Bash`;

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('TypeScript strict mode');
  });

  it('should set systemMessage at BOTH top-level and defaultModel', () => {
    const systemMessage = 'test agents content\ntest claude content\nAvailable tools: Bash';

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    const defaultModel = capturedConfig!['defaultModel'] as { systemMessage?: string };

    // Both must exist and be identical
    expect(topLevel).toBeDefined();
    expect(defaultModel.systemMessage).toBeDefined();
    expect(topLevel).toBe(defaultModel.systemMessage);
  });

  it('should pass system message through to Robota config', () => {
    const systemMessage = 'Some base system prompt with tools listed';

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel.length).toBeGreaterThan(10);
    expect(topLevel).toBe(systemMessage);
  });

  it('should include tool descriptions in system prompt when provided', () => {
    const systemMessage =
      'Available tools: Bash — execute shell commands, Read — read files, Grep — search';

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('Bash');
    expect(topLevel).toContain('Read');
    expect(topLevel).toContain('Grep');
  });

  it('should include trust level in system prompt when provided', () => {
    const systemMessage = 'Trust level: moderate\nAvailable tools: Bash';

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('moderate');
  });

  it('logs the complete system prompt and tool schemas at session initialization', () => {
    const systemMessage = '## Capabilities\n- /agent <prompt>: Start a background agent job';
    const logger = { log: vi.fn() };

    new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage,
      terminal: MOCK_TERMINAL,
      sessionLogger: logger,
    });

    expect(logger.log).toHaveBeenCalledWith(
      expect.any(String),
      'session_init',
      expect.objectContaining({
        systemPrompt: systemMessage,
        systemPromptLength: systemMessage.length,
        toolSchemas: [
          {
            name: 'Bash',
            description: 'Execute shell commands',
            parameters: { type: 'object', properties: {} },
          },
          {
            name: 'Read',
            description: 'Read file contents',
            parameters: { type: 'object', properties: {} },
          },
        ],
      }),
    );
  });

  it('logs full assistant content without truncation', async () => {
    const longResponse = `prefix-${'x'.repeat(700)}-suffix`;
    mockRunResult = longResponse;
    const logger = { log: vi.fn() };

    const session = new Session({
      tools: MOCK_TOOLS as never,
      provider: MOCK_PROVIDER as never,
      systemMessage: 'System prompt',
      terminal: MOCK_TERMINAL,
      sessionLogger: logger,
    });

    await session.run('hello');

    expect(logger.log).toHaveBeenCalledWith(
      expect.any(String),
      'assistant',
      expect.objectContaining({
        content: longResponse,
      }),
    );
  });
});
