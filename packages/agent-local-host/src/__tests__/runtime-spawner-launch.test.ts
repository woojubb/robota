import { Duplex } from 'node:stream';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRuntimeChild, onlySpawnCall } from './helpers/fake-runtime-child.js';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: spawnMock,
}));

import { startSpawnerRuntime, type IRuntimeStartRequest } from '../runtime-process-launch.js';

const request: IRuntimeStartRequest = {
  command: { executable: 'fixture-runtime', execArgs: [], entryArgs: ['runtime-entry.js'] },
  layout: { arguments: (facts) => ['--id', facts.id], transportTokenNames: [] },
  environment: {},
};

/** A pair the runtime holds the other end of and never answers on. */
function silentPair(): Duplex {
  return new Duplex({ read: () => undefined, write: (_chunk, _encoding, done) => done() });
}

let child: FakeRuntimeChild;

beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeRuntimeChild();
  spawnMock.mockReturnValue(child);
});

describe('spawner runtime launch', () => {
  // The default wait is 20 s; the test's own limit is what shows the given timeout is the one used.
  it('ends a start whose runtime is ready but never answers the pair, at the timeout it was given', async () => {
    const pair = silentPair();
    child.stdio = [null, null, child.stderr, null, pair];
    const launched = startSpawnerRuntime('/work', request, { pairTimeoutMs: 50 });
    const { args } = onlySpawnCall(spawnMock);
    const id = args[args.indexOf('--id') + 1];
    child.emit('message', { kind: 'ready', id });
    child.emit('message', { kind: 'acknowledged', id });
    await expect(launched).rejects.toThrow('Supervised session could not complete its spawner exchange.');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(pair.destroyed).toBe(true);
  }, 5_000);

  it('fails the start when the child has no pair descriptor to exchange on', async () => {
    child.stdio = [null, null, child.stderr, null, null];
    await expect(startSpawnerRuntime('/work', request)).rejects.toThrow(
      'Supervised session could not receive its spawner pair.',
    );
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
