import { describe, it, expect, vi } from 'vitest';
import { createMcpTransport } from '../mcp-transport.js';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';

function createMockSession(): InteractiveSession {
  return {
    submit: vi.fn(),
    abort: vi.fn(),
    cancelQueue: vi.fn(),
    getMessages: vi.fn().mockReturnValue([]),
    getContextState: vi
      .fn()
      .mockReturnValue({ usedPercentage: 0, usedTokens: 0, maxTokens: 200000 }),
    isExecuting: vi.fn().mockReturnValue(false),
    getPendingPrompt: vi.fn().mockReturnValue(null),
    executeCommand: vi.fn().mockResolvedValue({ message: 'ok', success: true }),
    listCommands: vi.fn().mockReturnValue([]),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as InteractiveSession;
}

describe('createMcpTransport', () => {
  it('returns an adapter with name "mcp"', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expect(transport.name).toBe('mcp');
  });

  it('throws if start() is called without attach()', async () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    await expect(transport.start()).rejects.toThrow('No session attached');
  });

  it('throws if getServer() is called before start()', () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    expect(() => transport.getServer()).toThrow('Transport not started');
  });

  it('creates an MCP server after attach + start', async () => {
    const transport = createMcpTransport({ name: 'test', version: '1.0.0' });
    transport.attach(createMockSession());
    await transport.start();
    const server = transport.getServer();
    expect(server).toBeDefined();
  });
});
