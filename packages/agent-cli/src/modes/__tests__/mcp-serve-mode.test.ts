import { mkdtemp, readFile, stat, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  waitForClose: vi.fn(),
  attach: vi.fn(),
  shutdown: vi.fn(),
  httpStart: vi.fn(),
  httpStop: vi.fn(),
  httpWaitForClose: vi.fn(),
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
  createMcpHttpHost: () => ({
    start: mock.httpStart,
    stop: mock.httpStop,
    waitForClose: mock.httpWaitForClose,
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

  it('writes an owner-only HTTP bearer file and removes it on signal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'robota-mcp-http-'));
    const tokenFile = join(root, 'token');
    mock.httpStart.mockResolvedValue({ url: 'http://127.0.0.1:12345/mcp', token: 'secret-token' });
    mock.httpWaitForClose.mockImplementation(() => new Promise<void>(() => {}));
    mock.httpStop.mockResolvedValue(undefined);
    mock.shutdown.mockResolvedValue(undefined);
    const previous = new Set(process.listeners('SIGTERM'));
    try {
      const running = runMcpServeMode(
        {} as TInteractiveSessionOptions,
        '1',
        new PassThrough(),
        { tokenFile },
      );
      await vi.waitFor(async () => expect(await readFile(tokenFile, 'utf8')).toBe('secret-token\n'));
      expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
      const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
      listener?.('SIGTERM');
      await running;
      await expect(access(tokenFile)).rejects.toThrow();
      expect(mock.httpStop).toHaveBeenCalledOnce();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tears down HTTP mode when a signal arrives before catalog validation completes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'robota-mcp-http-pending-'));
    const tokenFile = join(root, 'token');
    let release: (() => void) | undefined;
    mock.httpStart.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ url: 'http://127.0.0.1:12345/mcp', token: 'secret-token' });
    }));
    mock.httpStop.mockResolvedValue(undefined);
    mock.shutdown.mockResolvedValue(undefined);
    const previous = new Set(process.listeners('SIGTERM'));
    const running = runMcpServeMode(
      {} as TInteractiveSessionOptions, '1', new PassThrough(), { tokenFile },
    );
    try {
      await vi.waitFor(() => expect(release).toBeDefined());
      const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
      listener?.('SIGTERM');
      let settled = false;
      void running.finally(() => { settled = true; });
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 200 });
    } finally {
      release?.();
      await running.catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});
