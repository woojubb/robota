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
  remoteOptions: vi.fn(),
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
  createMcpRemoteHttpHost: (options: unknown) => {
    mock.remoteOptions(options);
    return { start: mock.httpStart, stop: mock.httpStop, waitForClose: mock.httpWaitForClose };
  },
}));

import { runMcpServeMode } from '../mcp-serve-mode.js';
import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';
import type { IMcpRemoteHttpHostOptions } from '@robota-sdk/agent-transport-mcp';

const REMOTE = {
  host: '0.0.0.0',
  publicUrl: 'https://agents.example.test/robota/mcp',
  issuer: 'https://auth.example.test',
  scopes: ['mcp:use'],
  allowedSubjects: ['alice'],
  trustedProxies: ['10.0.0.2'],
};

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
      const running = runMcpServeMode({} as TInteractiveSessionOptions, '1', new PassThrough(), {
        tokenFile,
      });
      await vi.waitFor(async () =>
        expect(await readFile(tokenFile, 'utf8')).toBe('secret-token\n'),
      );
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
    mock.httpStart.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ url: 'http://127.0.0.1:12345/mcp', token: 'secret-token' });
        }),
    );
    mock.httpStop.mockResolvedValue(undefined);
    mock.shutdown.mockResolvedValue(undefined);
    const previous = new Set(process.listeners('SIGTERM'));
    const running = runMcpServeMode({} as TInteractiveSessionOptions, '1', new PassThrough(), {
      tokenFile,
    });
    try {
      await vi.waitFor(() => expect(release).toBeDefined());
      const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
      listener?.('SIGTERM');
      let settled = false;
      void running.finally(() => {
        settled = true;
      });
      await vi.waitFor(() => expect(settled).toBe(true), { timeout: 200 });
    } finally {
      release?.();
      await running.catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serves remote authorization through an access-token verifier and a stderr audit', async () => {
    mock.remoteOptions.mockClear();
    mock.httpStart.mockResolvedValue({
      listening: '0.0.0.0:8443',
      url: 'https://agents.example.test/robota/mcp',
    });
    mock.httpWaitForClose.mockImplementation(() => new Promise<void>(() => {}));
    mock.httpStop.mockResolvedValue(undefined);
    mock.shutdown.mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const previous = new Set(process.listeners('SIGTERM'));
    try {
      const running = runMcpServeMode({} as TInteractiveSessionOptions, '1', new PassThrough(), {
        port: 8443,
        remote: REMOTE,
      });
      await vi.waitFor(() => expect(mock.remoteOptions).toHaveBeenCalledOnce());
      const options = mock.remoteOptions.mock.calls[0]?.[0] as IMcpRemoteHttpHostOptions;
      expect(options).toMatchObject({
        host: '0.0.0.0',
        port: 8443,
        authorization: {
          publicUrl: REMOTE.publicUrl,
          issuer: REMOTE.issuer,
          scopes: REMOTE.scopes,
          trustedProxies: REMOTE.trustedProxies,
        },
      });
      expect(typeof options.authorization.verifier.verify).toBe('function');
      options.authorization.audit?.({
        refusal: 'bad-signature',
        remote: 'public',
        throttled: true,
      });
      expect(stderr).toHaveBeenCalledWith('MCP HTTP refused: bad-signature (public, throttled)\n');
      const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
      listener?.('SIGTERM');
      await running;
      expect(mock.httpStop).toHaveBeenCalled();
      expect(mock.shutdown).toHaveBeenCalled();
    } finally {
      stderr.mockRestore();
    }
  });

  it('refuses the loopback bearer file together with remote authorization', async () => {
    mock.remoteOptions.mockClear();
    await expect(
      runMcpServeMode({} as TInteractiveSessionOptions, '1', new PassThrough(), {
        tokenFile: '/private/token',
        remote: REMOTE,
      }),
    ).rejects.toThrow(/not accepted with remote authorization/);
    expect(mock.remoteOptions).not.toHaveBeenCalled();
  });
});
