/**
 * Tests that Session correctly passes AGENTS.md/CLAUDE.md content
 * into the system prompt AND delivers it to the AI provider.
 *
 * Root cause this prevents: Session was setting systemMessage only in
 * agentConfig.defaultModel, but execution-service reads from
 * config.systemMessage (top-level). Without both, AGENTS.md content
 * was loaded but never reached the API.
 */

import { describe, it, expect, vi } from 'vitest';
import { Session } from '../session.js';

// Capture the config passed to Robota constructor
let capturedConfig: Record<string, unknown> | null = null;

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation((config: Record<string, unknown>) => {
      capturedConfig = config;
      return {
        run: vi.fn().mockResolvedValue('mock response'),
        getHistory: vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
      };
    }),
  };
});

vi.mock('@robota-sdk/agent-provider-anthropic', () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    name: 'mock-provider',
    version: '1.0.0',
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: 'mock',
      timestamp: new Date(),
    }),
    supportsTools: () => true,
    validateConfig: () => true,
  })),
}));

vi.mock('@robota-sdk/agent-tools', () => ({
  bashTool: {
    schema: { name: 'Bash' },
    execute: vi.fn(),
    getName: () => 'Bash',
    setEventService: vi.fn(),
  },
  readTool: {
    schema: { name: 'Read' },
    execute: vi.fn(),
    getName: () => 'Read',
    setEventService: vi.fn(),
  },
  writeTool: {
    schema: { name: 'Write' },
    execute: vi.fn(),
    getName: () => 'Write',
    setEventService: vi.fn(),
  },
  editTool: {
    schema: { name: 'Edit' },
    execute: vi.fn(),
    getName: () => 'Edit',
    setEventService: vi.fn(),
  },
  globTool: {
    schema: { name: 'Glob' },
    execute: vi.fn(),
    getName: () => 'Glob',
    setEventService: vi.fn(),
  },
  grepTool: {
    schema: { name: 'Grep' },
    execute: vi.fn(),
    getName: () => 'Grep',
    setEventService: vi.fn(),
  },
  webFetchTool: {
    schema: { name: 'WebFetch' },
    execute: vi.fn(),
    getName: () => 'WebFetch',
    setEventService: vi.fn(),
  },
  webSearchTool: {
    schema: { name: 'WebSearch' },
    execute: vi.fn(),
    getName: () => 'WebSearch',
    setEventService: vi.fn(),
  },
}));

const MOCK_CONFIG = {
  defaultTrustLevel: 'moderate' as const,
  provider: { name: 'anthropic', model: 'test-model', apiKey: 'test-key' },
  permissions: { allow: [] as string[], deny: [] as string[] },
  env: {},
};

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
  });

  it('should include AGENTS.md content in system prompt', () => {
    const agentsContent = '# My Project\nYou are a helpful assistant for this project.';

    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: agentsContent, claudeMd: '' },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
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
    const claudeContent = '## Project Notes\nAlways use TypeScript strict mode.';

    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: '', claudeMd: claudeContent },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('TypeScript strict mode');
  });

  it('should set systemMessage at BOTH top-level and defaultModel', () => {
    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: 'test agents content', claudeMd: 'test claude content' },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    const defaultModel = capturedConfig!['defaultModel'] as { systemMessage?: string };

    // Both must exist and be identical
    expect(topLevel).toBeDefined();
    expect(defaultModel.systemMessage).toBeDefined();
    expect(topLevel).toBe(defaultModel.systemMessage);
  });

  it('should produce non-empty system prompt even with empty AGENTS.md', () => {
    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    // Should still have tool list and project info
    expect(topLevel.length).toBeGreaterThan(10);
    expect(topLevel).toContain('Available tools');
  });

  it('should include tool descriptions in system prompt', () => {
    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('Bash');
    expect(topLevel).toContain('Read');
    expect(topLevel).toContain('Grep');
  });

  it('should include trust level in system prompt', () => {
    new Session({
      config: MOCK_CONFIG,
      context: { agentsMd: '', claudeMd: '' },
      terminal: MOCK_TERMINAL,
      // sessionLogger not provided → no logging
    });

    const topLevel = capturedConfig!['systemMessage'] as string;
    expect(topLevel).toContain('moderate');
  });
});
