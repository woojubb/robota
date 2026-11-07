/**
 * The one-shot exchange between a runtime and the process that started it, over the socket pair the
 * runtime inherited, and the two ends of how it is carried.
 *
 * The runtime's end is synchronous on purpose and runs where the runtime starts, before it starts any
 * child (a `git` trust check, an identity reader, a session, an MCP server, a hook, a worker): the
 * descriptor is the runtime's open handle on the one channel only the two processes hold, and a child
 * that inherited it could answer in the runtime's place. It reads exactly what the spawner wrote
 * first, answers, and closes the descriptor on every path, so nothing started later can hold it. A
 * POSIX child started through libuv does not inherit a descriptor it was not given (measured on Node
 * 22), but a Windows child inherits every inheritable handle still open, which is why the close
 * comes before the first spawn and not after it.
 *
 * The spawner's end writes first, takes the runtime's instance key from the answer and closes its own
 * end: the spawner key it derives is never an owner credential, so it lives only as long as its
 * holder keeps it.
 */
import { Buffer } from 'node:buffer';
import { fstatSync, closeSync, readSync, writeSync } from 'node:fs';
import type { Duplex } from 'node:stream';

import {
  SPAWNER_EXCHANGE_MESSAGE_BYTES,
  SPAWNER_EXCHANGE_REPLY_BYTES,
  startSpawnerExchange,
  type IRuntimeIdentity,
  type SpawnerKey,
} from '@robota-sdk/agent-keyring';

/** The spawner's pair is the first descriptor after stdio and the IPC channel. */
export const SPAWNER_PAIR_FD = 4;

/** How long a spawner waits for a runtime to answer: a runtime loads its whole module graph first. */
export const DEFAULT_SPAWNER_PAIR_TIMEOUT_MS = 20_000;

/** How long the runtime waits on a descriptor that is not blocking before it gives up. */
const NONBLOCKING_WAIT_MS = 20_000;
const NONBLOCKING_STEP_MS = 5;

/** The exchange could not be carried out. The message never holds a byte of what was exchanged. */
export class SpawnerPairError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpawnerPairError';
  }
}

/** The descriptor operations the runtime's end uses, so a test can script them. */
export interface ISpawnerPairIo {
  /**
   * Whether `fd` is the pair a spawner handed over. A runtime started without a spawner has its own
   * internal descriptors at this index: a blocking read there never returns, and closing one would
   * break the runtime.
   */
  isHandedOverPair(fd: number): boolean;
  /** Bytes read into `buffer`; zero at the end of the data. */
  read(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  /** Bytes written from `buffer`. */
  write(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  close(fd: number): void;
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

/**
 * A spawner's pair is a socket pair on every POSIX runtime (measured on Node and Bun), and Windows
 * has no internal descriptors at a CRT index. The stat is a bigint one: Node 22 keeps the result of a
 * plain stat in a buffer its path resolution reads back, and a socket left there made the next
 * module resolution stop following links.
 */
const NODE_IO: ISpawnerPairIo = {
  isHandedOverPair: (fd) => {
    if (process.platform === 'win32') return true;
    try {
      return fstatSync(fd, { bigint: true }).isSocket();
    } catch {
      return false;
    }
  },
  read: (fd, buffer, offset, length) => readSync(fd, buffer, offset, length, null),
  write: (fd, buffer, offset, length) => writeSync(fd, buffer, offset, length),
  close: (fd) => closeSync(fd),
};

/** Waits without spinning a core; only a descriptor that is not blocking gets here. */
function pause(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, NONBLOCKING_STEP_MS);
}

/** `operation`, retried while the descriptor says it would block, for a bounded time. */
function whileBlocking(operation: () => number, what: string): number {
  const deadline = Date.now() + NONBLOCKING_WAIT_MS;
  for (;;) {
    try {
      return operation();
    } catch (error) {
      const code = errorCode(error);
      // Windows reports a closed pipe as an `EOF` error: the end of the data, not a failure.
      if (code === 'EOF') return 0;
      if (code !== 'EAGAIN') {
        throw new SpawnerPairError(`The spawner pair could not be ${what}${code === undefined ? '' : ` (${code})`}.`);
      }
      if (Date.now() >= deadline) {
        throw new SpawnerPairError(`The spawner pair could not be ${what} in time.`);
      }
      pause();
    }
  }
}

function readExactly(io: ISpawnerPairIo, fd: number, length: number): Buffer {
  const buffer = Buffer.alloc(length);
  let have = 0;
  while (have < length) {
    const bytes = whileBlocking(() => io.read(fd, buffer, have, length - have), 'read');
    if (bytes === 0) throw new SpawnerPairError('The spawner closed the pair before it had written its part.');
    have += bytes;
  }
  return buffer;
}

function writeAll(io: ISpawnerPairIo, fd: number, bytes: Uint8Array): void {
  let sent = 0;
  while (sent < bytes.length) {
    const written = whileBlocking(() => io.write(fd, bytes, sent, bytes.length - sent), 'written');
    if (written <= 0) throw new SpawnerPairError('The spawner pair took none of the answer.');
    sent += written;
  }
}

/**
 * The runtime's end: reads the spawner's first message from `fd`, answers it with `identity`
 * (which keeps the spawner key it derives), and closes `fd`, on every path once it is known to be the
 * pair. Throws {@link SpawnerPairError} when the descriptor is not the pair (and then leaves it
 * alone) or the spawner does not do its part, and the identity's own refusal when it will not answer
 * (a message that is no key, a second exchange). Synchronous, so no other work starts in between.
 */
export function answerSpawnerPair(
  identity: IRuntimeIdentity,
  fd: number = SPAWNER_PAIR_FD,
  io: ISpawnerPairIo = NODE_IO,
): void {
  if (!io.isHandedOverPair(fd)) {
    throw new SpawnerPairError(`Descriptor ${fd} is not the pair a spawner hands over.`);
  }
  try {
    const message = readExactly(io, fd, SPAWNER_EXCHANGE_MESSAGE_BYTES);
    writeAll(io, fd, identity.answerSpawnerExchange(message));
  } finally {
    try {
      io.close(fd);
    } catch {
      // allow-fallback: the descriptor is already gone, which is what closing was for.
    }
  }
}

export interface ICompleteSpawnerPairOptions {
  readonly timeoutMs?: number;
}

/** What the spawner takes from the exchange. It wipes the key as soon as it no longer needs it. */
export interface ISpawnerPairResult {
  readonly spawnerKey: SpawnerKey;
  /** The runtime's instance key, as it answered over the pair. */
  readonly instancePublicKey: Uint8Array;
}

/**
 * The spawner's end on `stream`, its side of the pair: writes first, reads the runtime's answer,
 * derives the spawner key and closes its end. Rejects with {@link SpawnerPairError} when the runtime
 * closes without answering, answers with anything but exactly its part, or does not answer in time,
 * and with the keyring's refusal when the answer is no key; the stream is closed in each case.
 */
export function completeSpawnerPair(
  stream: Duplex,
  options: ICompleteSpawnerPairOptions = {},
): Promise<ISpawnerPairResult> {
  const exchange = startSpawnerExchange();
  return new Promise<ISpawnerPairResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const finish = (outcome: () => ISpawnerPairResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      try {
        const result = outcome();
        stream.destroy();
        resolve(result);
      } catch (error) {
        stream.destroy();
        reject(error);
      }
    };
    const fail = (message: string): void =>
      finish(() => {
        throw new SpawnerPairError(message);
      });
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      received += chunk.length;
      if (received > SPAWNER_EXCHANGE_REPLY_BYTES) {
        fail('The runtime answered with more than its part of the exchange.');
      } else if (received === SPAWNER_EXCHANGE_REPLY_BYTES) {
        finish(() => exchange.complete(Buffer.concat(chunks)));
      }
    };
    const onEnd = (): void => fail('The runtime closed the pair without answering.');
    const onError = (): void => fail('The pair failed before the runtime answered.');
    const timer = setTimeout(
      () => fail('The runtime did not answer the exchange in time.'),
      options.timeoutMs ?? DEFAULT_SPAWNER_PAIR_TIMEOUT_MS,
    );
    timer.unref?.();
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.write(exchange.message);
  });
}
