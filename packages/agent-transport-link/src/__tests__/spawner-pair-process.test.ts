/**
 * The spawner pair between real processes. A runtime process answers the exchange on its inherited
 * descriptor 4 and the spawner, here the test, derives the same key from the other end: the key
 * admits a spawner link on the runtime's endpoint. The runtime closes the descriptor before it starts
 * anything, so the spawner sees the pair end while a child of the runtime lives.
 *
 * What the native legs must show: on Linux and macOS (Node) the pair ends with the grandchild alive in
 * both variants, because libuv passes a child only the descriptors it was given. On Windows the
 * variant that starts the child before closing is the control: a handle still open is inherited, so
 * the pair may stay open there, and that is what the log line below reports; only the variant that
 * closes first must always end.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import type { Duplex } from 'node:stream';

import { SPAWNER_EXCHANGE_REPLY_BYTES, startSpawnerExchange } from '@robota-sdk/agent-keyring';
import { afterEach, describe, expect, it } from 'vitest';

import { completeSpawnerPair, openSpawnerLink } from '../index.js';
import { BINDING, connect } from './harness.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/pair-runtime.ts', import.meta.url));
const PACKAGE_DIR = fileURLToPath(new URL('../..', import.meta.url));

interface IStartedRuntime {
  readonly child: ChildProcess;
  readonly pair: Duplex;
  /** The one JSON line the runtime printed once it served its endpoint. */
  readonly ready: Promise<{ readonly port: number; readonly grandchild?: number }>;
}

const running: ChildProcess[] = [];
const grandchildren: number[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
  for (const pid of grandchildren.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
});

/** A runtime whose descriptor 4 is a pipe to this test, as a spawner hands it over. */
function startRuntime(...flags: string[]): IStartedRuntime {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', '--conditions=source', FIXTURE, ...flags],
    { cwd: PACKAGE_DIR, stdio: ['ignore', 'pipe', 'inherit', 'ignore', 'pipe'] },
  );
  running.push(child);
  const ready = new Promise<{ port: number; grandchild?: number }>((resolve, reject) => {
    let line = '';
    child.stdout!.on('data', (chunk: Buffer) => {
      line += chunk.toString('utf8');
      if (!line.includes('\n')) return;
      const answer = JSON.parse(line) as { port: number; grandchild?: number };
      if (answer.grandchild !== undefined) grandchildren.push(answer.grandchild);
      resolve(answer);
    });
    child.once('exit', () => reject(new Error('The runtime ended before it was ready.')));
  });
  return { child, pair: child.stdio[4] as Duplex, ready };
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The spawner's side by hand, to watch the pair itself: writes first, reads the answer, waits for the end. */
async function exchangeAndWatch(pair: Duplex, waitMs: number): Promise<{ reply: Buffer; ended: boolean }> {
  const exchange = startSpawnerExchange();
  const chunks: Buffer[] = [];
  pair.on('data', (chunk: Buffer) => chunks.push(chunk));
  pair.write(exchange.message);
  const ended = await Promise.race([
    once(pair, 'end').then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), waitMs)),
  ]);
  const reply = Buffer.concat(chunks);
  expect(reply.length).toBe(SPAWNER_EXCHANGE_REPLY_BYTES);
  return { reply, ended };
}

describe('the spawner pair between real processes', () => {
  it('gives the spawner the key its runtime derived, which admits the spawner on the runtime endpoint', async () => {
    const runtime = startRuntime();
    const { spawnerKey, instancePublicKey } = await completeSpawnerPair(runtime.pair);
    const { port } = await runtime.ready;

    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    expect(client.standing).toBe('spawner');
    expect(client.binding).toEqual(BINDING);
    client.close();
    spawnerKey.wipe();
  }, 60_000);

  it('closes the descriptor before it starts anything, so the pair ends while a child of the runtime lives', async () => {
    const runtime = startRuntime('--grandchild');
    const watching = exchangeAndWatch(runtime.pair, 30_000);
    const { grandchild } = await runtime.ready;
    const { ended } = await watching;

    expect(grandchild).toBeDefined();
    expect(alive(grandchild!)).toBe(true);
    expect(ended).toBe(true);
  }, 60_000);

  it('measures whether a child started before the close holds the pair open (the control)', async () => {
    const runtime = startRuntime('--spawn-before-close');
    // The runtime waits for the spawner's first message, so the exchange starts before it is ready.
    const watching = exchangeAndWatch(runtime.pair, 2_000);
    const { grandchild } = await runtime.ready;
    const { ended } = await watching;

    expect(alive(grandchild!)).toBe(true);
    // eslint-disable-next-line no-console -- the measurement the native legs report.
    console.info(
      `spawn-before-close on ${process.platform}: the pair ${ended ? 'ended' : 'stayed open'} while the child lived`,
    );
    // libuv passes a POSIX child only what it was given, so nothing leaks there; Windows is measured.
    if (process.platform !== 'win32') expect(ended).toBe(true);
  }, 60_000);
});
