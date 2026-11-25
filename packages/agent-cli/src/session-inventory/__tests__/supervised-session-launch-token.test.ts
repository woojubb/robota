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
  readonly tokenPipe = new Writable({ write: (_chunk: Buffer, _encoding, done) => done() });
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

let child: FakeChild;

beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeChild();
  spawnMock.mockReturnValue(child);
});

describe('supervised launch transport token', () => {
  it('removes the token variables of the product from the child environment and passes the token flag', async () => {
    const launched = launchSupervisedSession('/work', {
      productRuntime: createTestProductRuntime(),
      entrypoint: 'runtime-entry.ts',
      execArgs: [],
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
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, args, options] = spawnMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(options.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    expect(args).toContain('--supervised-transport-token-fd');
    expect(args.join(' ')).not.toContain(TOKEN);
    const id = args[args.indexOf('--supervised-session-id') + 1];
    child.emit('message', { kind: 'ready', id });
    child.emit('message', { kind: 'acknowledged', id });
    await expect(launched).resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });
});
