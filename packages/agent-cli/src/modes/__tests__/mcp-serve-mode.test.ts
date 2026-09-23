import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  waitForClose: vi.fn(),
  attach: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-framework')>()),
  buildRuntimeSession: () => ({ shutdown: mock.shutdown }),
}));
vi.mock('@robota-sdk/agent-transport-mcp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-transport-mcp')>()),
  createMcpTransport: () => ({
    attach: mock.attach,
    start: mock.start,
    stop: mock.stop,
    waitForClose: mock.waitForClose,
  }),
}));

import { runMcpServeMode } from '../mcp-serve-mode.js';
import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

describe('MCP serve startup lifecycle', () => {
  it('tears down on SIGTERM even if transport startup has not completed', async () => {
    mock.start.mockImplementation(() => new Promise<void>(() => {}));
    mock.waitForClose.mockImplementation(() => new Promise<void>(() => {}));
    mock.stop.mockResolvedValue(undefined);
    mock.shutdown.mockResolvedValue(undefined);
    const previous = new Set(process.listeners('SIGTERM'));
    const running = runMcpServeMode({} as TInteractiveSessionOptions, '1', new PassThrough());
    await vi.waitFor(() => expect(mock.start).toHaveBeenCalledOnce());
    const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
    expect(listener).toBeDefined();
    listener?.('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });
});
