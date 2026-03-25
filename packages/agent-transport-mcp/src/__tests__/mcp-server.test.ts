/**
 * Tests for MCP transport adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentMcpServer } from '../mcp-server.js';
import type {
  InteractiveSession,
  SystemCommandExecutor,
  IExecutionResult,
} from '@robota-sdk/agent-sdk';

function createMockSession() {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedTokens: 0, maxTokens: 200000, usedPercentage: 0 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

function createMockCommandExecutor(commands?: Array<{ name: string; description: string }>) {
  return {
    execute: vi.fn().mockResolvedValue({ message: 'done', success: true }),
    listCommands: vi.fn().mockReturnValue(
      commands ?? [
        { name: 'clear', description: 'Clear history' },
        { name: 'mode', description: 'Permission mode' },
      ],
    ),
    hasCommand: vi.fn().mockReturnValue(true),
  } as unknown as SystemCommandExecutor;
}

describe('createAgentMcpServer', () => {
  it('creates a server instance', () => {
    const server = createAgentMcpServer({
      name: 'test-agent',
      version: '1.0.0',
      session: createMockSession(),
      commandExecutor: createMockCommandExecutor(),
    });
    expect(server).toBeDefined();
  });

  it('exposeCommands=false only registers submit tool', () => {
    const commandExecutor = createMockCommandExecutor();
    createAgentMcpServer({
      name: 'test',
      version: '1.0.0',
      session: createMockSession(),
      commandExecutor,
      exposeCommands: false,
    });
    // With exposeCommands=false, listCommands should not be called for tool registration
    // (it may still be called internally, but command tools won't be registered)
    expect(commandExecutor.listCommands).not.toHaveBeenCalled();
  });

  it('exposeCommands=true registers command tools', () => {
    const commandExecutor = createMockCommandExecutor([
      { name: 'clear', description: 'Clear' },
      { name: 'help', description: 'Help' },
    ]);
    createAgentMcpServer({
      name: 'test',
      version: '1.0.0',
      session: createMockSession(),
      commandExecutor,
      exposeCommands: true,
    });
    expect(commandExecutor.listCommands).toHaveBeenCalled();
  });
});
