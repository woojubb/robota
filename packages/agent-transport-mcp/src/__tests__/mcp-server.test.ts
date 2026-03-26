/**
 * Tests for MCP transport adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAgentMcpServer } from '../mcp-server.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

function createMockSession(commands?: Array<{ name: string; description: string }>) {
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
    executeCommand: vi.fn().mockResolvedValue({ message: 'done', success: true }),
    listCommands: vi.fn().mockReturnValue(
      commands ?? [
        { name: 'clear', description: 'Clear history' },
        { name: 'mode', description: 'Permission mode' },
      ],
    ),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

describe('createAgentMcpServer', () => {
  it('creates a server instance', () => {
    const server = createAgentMcpServer({
      name: 'test-agent',
      version: '1.0.0',
      session: createMockSession(),
    });
    expect(server).toBeDefined();
  });

  it('exposeCommands=false does not call listCommands', () => {
    const session = createMockSession();
    createAgentMcpServer({
      name: 'test',
      version: '1.0.0',
      session,
      exposeCommands: false,
    });
    expect(session.listCommands).not.toHaveBeenCalled();
  });

  it('exposeCommands=true calls session.listCommands()', () => {
    const session = createMockSession([
      { name: 'clear', description: 'Clear' },
      { name: 'help', description: 'Help' },
    ]);
    createAgentMcpServer({
      name: 'test',
      version: '1.0.0',
      session,
      exposeCommands: true,
    });
    expect(session.listCommands).toHaveBeenCalled();
  });
});
