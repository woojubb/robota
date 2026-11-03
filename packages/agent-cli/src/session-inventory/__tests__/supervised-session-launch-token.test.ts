import { createInventoryRuntime as createTestProductRuntime } from './product-runtime.js';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

const { launchSupervisedSession } = await import('../supervised-session-launch.js');

const TOKEN = 'ab12'.repeat(16);

/** What the launcher drives of a spawned child: its channels, its signals and its exit. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly stderr = new PassThrough();
  /** What the child receives on its descriptor 4. */
  readonly received: string[] = [];
  readonly tokenPipe = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.received.push(chunk.toString('utf8'));
      done();
    },
  });
  stdio: unknown[] = [null, null, this.stderr, null, this.tokenPipe];
  send = vi.fn((_message: unknown, done?: (error: Error | null) => void) => {
    done?.(null);
    return true;
  });
  disconnect = vi.fn(() => {
    this.connected = false;
  });
  unref = vi.fn();
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('exit'));
    return true;
  });
}

interface ISpawnCall {
  readonly args: string[];
  readonly options: { stdio: unknown[]; env: NodeJS.ProcessEnv; detached: boolean };
}

function spawnCall(): ISpawnCall {
  expect(spawnMock).toHaveBeenCalledTimes(1);
  const [, args, options] = spawnMock.mock.calls[0] as [string, string[], ISpawnCall['options']];
  return { args, options };
}

/** The child reports ready and acknowledges, as a runtime that started does. */
function completeHandshake(child: FakeChild): void {
  const { args } = spawnCall();
  const id = args[args.indexOf('--supervised-session-id') + 1];
  child.emit('message', { kind: 'ready', id });
  child.emit('message', { kind: 'acknowledged', id });
}

function start(options: Partial<Parameters<typeof launchSupervisedSession>[1]>): Promise<string> {
  return launchSupervisedSession('/work', {
    productRuntime: createTestProductRuntime(),
    entrypoint: 'runtime-entry.ts',
    execArgs: [],
    ...options,
  });
}

let child: FakeChild;

beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeChild();
  spawnMock.mockReturnValue(child);
});

describe('supervised launch transport token', () => {
  it('hands the token to the child on a fifth stdio pipe and leaves it out of its environment', async () => {
    const launched = start({
      daemon: true,
      transportToken: TOKEN,
      // The launching CLI may itself hold a token, under any of the names or spellings a child reads.
      env: {
        PATH: '/bin',
        KEPT: 'yes',
        PRODUCT_WS_TOKEN: 'c'.repeat(64),
        TEST_PRODUCT_WS_TOKEN: 'd'.repeat(64),
        Test_Product_Ws_Token: 'e'.repeat(64),
      },
    });
    const { args, options } = spawnCall();
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    expect(options.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    expect(args).toContain('--supervised-transport-token-fd');
    expect(args.join(' ')).not.toContain(TOKEN);
    expect(child.received).toEqual([TOKEN]);
    expect(child.tokenPipe.writableEnded).toBe(true);
    completeHandshake(child);
    await expect(launched).resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('keeps passing a host-supplied token in the environment when none is piped', async () => {
    const launched = start({ env: { PATH: '/bin', PRODUCT_WS_TOKEN: 'c'.repeat(64) } });
    const { args, options } = spawnCall();
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc']);
    expect(options.env).toEqual({ PATH: '/bin', PRODUCT_WS_TOKEN: 'c'.repeat(64) });
    expect(args).not.toContain('--supervised-transport-token-fd');
    expect(child.received).toEqual([]);
    completeHandshake(child);
    await launched;
  });

  it('refuses a malformed token before it spawns anything', async () => {
    await expect(start({ transportToken: 'not-a-token', env: {} })).rejects.toThrow(
      'Supervised session transport token is invalid.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails the start, and reaps the child, when the pipe cannot take the token', async () => {
    const launched = start({ transportToken: TOKEN, env: {} });
    child.tokenPipe.emit('error', new Error('write EPIPE'));
    await expect(launched).rejects.toThrow(
      'Supervised session could not receive its transport token.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('fails the start when the child has no descriptor 4 to write to', async () => {
    child.stdio = [null, null, child.stderr, null, null];
    await expect(start({ transportToken: TOKEN, env: {} })).rejects.toThrow(
      'Supervised session could not receive its transport token.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('redacts the token from what the child wrote to stderr, though it is in no environment', async () => {
    const launched = start({ transportToken: TOKEN, env: {} });
    child.stderr.write(`could not serve ws://127.0.0.1:9?x=${TOKEN} on this port\n`);
    child.stderr.end();
    child.exitCode = 1;
    child.emit('exit');
    const error = await launched.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'could not serve ws://127.0.0.1:9?x=[REDACTED] on this port',
    );
  });
});
