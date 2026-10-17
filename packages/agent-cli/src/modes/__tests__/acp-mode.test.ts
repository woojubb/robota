import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';

const mock = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  waitForClose: vi.fn(),
  attach: vi.fn(),
  shutdown: vi.fn(),
  executeCommand: vi.fn(),
  options: undefined as undefined | Record<string, unknown>,
  session: undefined as undefined | Record<string, unknown>,
}));

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-framework')>()),
  buildRuntimeSession: () => mock.session,
}));
vi.mock('@robota-sdk/agent-transport-acp', () => ({
  createAcpTransport: (options: Record<string, unknown>) => {
    mock.options = options;
    return {
      attach: mock.attach,
      start: mock.start,
      stop: mock.stop,
      waitForClose: mock.waitForClose,
    };
  },
}));

import { runAcpMode } from '../acp-mode.js';

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

function setup() {
  mock.session = {
    shutdown: mock.shutdown,
    on: vi.fn(),
    off: vi.fn(),
    executeCommand: mock.executeCommand,
  };
  mock.stop.mockResolvedValue(undefined);
  mock.shutdown.mockResolvedValue(undefined);
  const input = new PassThrough();
  const output = new PassThrough();
  const admitWorkspace = vi.fn(() => ({ admitted: true as const }));
  const run = () =>
    runAcpMode({
      productRuntime: createTestProductRuntime(),
      sessionOptions: {} as TInteractiveSessionOptions,
      version: '9.9.9',
      cwd: '/workspace',
      input,
      output,
      admitWorkspace,
    });
  return { input, output, admitWorkspace, run };
}

describe('ACP mode', () => {
  it('serves one session on the given streams and tears down when the editor goes away', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { input, output, admitWorkspace, run } = setup();

    await expect(run()).resolves.toBeUndefined();

    expect(mock.attach).toHaveBeenCalledWith(mock.session);
    expect(mock.start).toHaveBeenCalledOnce();
    expect(mock.stop).toHaveBeenCalledOnce();
    expect(mock.shutdown).toHaveBeenCalledOnce();
    expect(mock.options).toMatchObject({
      input,
      output,
      cwd: '/workspace',
      admitWorkspace,
      agentInfo: { name: 'test-product', version: '9.9.9' },
    });
  });

  it('hands slash commands to the session as transport commands', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    mock.executeCommand.mockResolvedValue({ success: true, message: 'Commands: /help' });
    const { run } = setup();
    await run();

    const executeCommand = mock.options!['executeCommand'] as (
      t: string,
      s: AbortSignal,
    ) => Promise<string>;
    await expect(executeCommand('/help', new AbortController().signal)).resolves.toBe(
      'Commands: /help',
    );
    expect(mock.executeCommand).toHaveBeenCalledWith('help', '', 'remote', 'owner', 'local');
  });

  it('reports errors the editor does not receive on stderr, never stdout', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { run } = setup();
    await run();
    (mock.options!['onDeliveryError'] as (e: Error, c: string) => void)(new Error('cause'), 'turn');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('turn'));
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('cause'));
    stderr.mockRestore();
  });

  it('tears down on SIGTERM even if the transport has not finished starting', async () => {
    mock.start.mockImplementation(() => new Promise<void>(() => {}));
    mock.waitForClose.mockImplementation(() => new Promise<void>(() => {}));
    const { run } = setup();
    const previous = new Set(process.listeners('SIGTERM'));
    const running = run();
    await vi.waitFor(() => expect(mock.start).toHaveBeenCalled());
    const listener = process.listeners('SIGTERM').find((entry) => !previous.has(entry));
    expect(listener).toBeDefined();
    listener?.('SIGTERM');
    await expect(running).resolves.toBeUndefined();
    expect(mock.stop).toHaveBeenCalled();
    expect(mock.shutdown).toHaveBeenCalled();
    expect(new Set(process.listeners('SIGTERM'))).toEqual(previous);
  });

  it('still shuts the session down when the transport fails to stop', async () => {
    mock.start.mockResolvedValue(undefined);
    mock.waitForClose.mockResolvedValue(undefined);
    const { run } = setup();
    mock.stop.mockRejectedValue(new Error('stop failed'));
    mock.shutdown.mockClear();
    await expect(run()).rejects.toThrow('stop failed');
    expect(mock.shutdown).toHaveBeenCalledOnce();
  });
});
