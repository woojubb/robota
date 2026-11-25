import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRuntimeChild, onlySpawnCall } from './helpers/fake-runtime-child.js';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { startPlainRuntime, type IRuntimeStartLayout, type IRuntimeStartRequest } from '../runtime-process-launch.js';
import { SUPERVISED_TRANSPORT_TOKEN_FLAG } from '../supervised-transport-token.js';

const TOKEN = 'ab12'.repeat(16);

/** A layout that names two token variables and spells the token flag when a token is piped. */
const layout: IRuntimeStartLayout = {
  arguments: (facts) => ['--id', facts.id, ...(facts.transportToken ? [SUPERVISED_TRANSPORT_TOKEN_FLAG] : [])],
  transportTokenNames: ['FIXTURE_WS_TOKEN', 'HOST_FIXTURE_WS_TOKEN'],
};

/** The child reports ready and acknowledges, as a runtime that started does. */
function completeHandshake(child: FakeRuntimeChild): void {
  const { args } = onlySpawnCall(spawnMock);
  const id = args[args.indexOf('--id') + 1];
  child.emit('message', { kind: 'ready', id });
  child.emit('message', { kind: 'acknowledged', id });
}

function start(options: Partial<IRuntimeStartRequest>): Promise<string> {
  return startPlainRuntime('/work', {
    command: { executable: 'fixture-runtime', execArgs: [], entryArgs: ['runtime-entry.js'] },
    layout,
    environment: {},
    ...options,
  });
}

let child: FakeRuntimeChild;

beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeRuntimeChild();
  spawnMock.mockReturnValue(child);
});

describe('runtime launch transport token', () => {
  it('hands the token to the child on a fifth stdio pipe and leaves it out of its environment', async () => {
    const launched = start({
      daemon: true,
      transportToken: TOKEN,
      // The launching process may itself hold a token, under any of the names or spellings a child reads.
      environment: {
        PATH: '/bin',
        KEPT: 'yes',
        FIXTURE_WS_TOKEN: 'c'.repeat(64),
        HOST_FIXTURE_WS_TOKEN: 'd'.repeat(64),
        Host_Fixture_Ws_Token: 'e'.repeat(64),
        UNLISTED_WS_TOKEN: 'f'.repeat(64),
      },
    });
    const { args, options } = onlySpawnCall(spawnMock);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    expect(options.env).toEqual({ PATH: '/bin', KEPT: 'yes', UNLISTED_WS_TOKEN: 'f'.repeat(64) });
    expect(args).toContain(SUPERVISED_TRANSPORT_TOKEN_FLAG);
    expect(args.join(' ')).not.toContain(TOKEN);
    expect(child.received).toEqual([TOKEN]);
    expect(child.tokenPipe.writableEnded).toBe(true);
    completeHandshake(child);
    await expect(launched).resolves.toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('keeps passing a host-supplied token in the environment when none is piped', async () => {
    const launched = start({ environment: { PATH: '/bin', FIXTURE_WS_TOKEN: 'c'.repeat(64) } });
    const { args, options } = onlySpawnCall(spawnMock);
    expect(options.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc']);
    expect(options.env).toEqual({ PATH: '/bin', FIXTURE_WS_TOKEN: 'c'.repeat(64) });
    expect(args).not.toContain(SUPERVISED_TRANSPORT_TOKEN_FLAG);
    expect(child.received).toEqual([]);
    completeHandshake(child);
    await launched;
  });

  it('refuses a malformed token before it spawns anything', async () => {
    await expect(start({ transportToken: 'not-a-token' })).rejects.toThrow(
      'Supervised session transport token is invalid.',
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('fails the start, and reaps the child, when the pipe cannot take the token', async () => {
    const launched = start({ transportToken: TOKEN });
    child.tokenPipe.emit('error', new Error('write EPIPE'));
    await expect(launched).rejects.toThrow(
      'Supervised session could not receive its transport token.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('fails the start when the child has no descriptor 4 to write to', async () => {
    child.stdio = [null, null, child.stderr, null, null];
    await expect(start({ transportToken: TOKEN })).rejects.toThrow(
      'Supervised session could not receive its transport token.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('redacts the token from what the child wrote to stderr, though it is in no environment', async () => {
    const launched = start({ transportToken: TOKEN });
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
