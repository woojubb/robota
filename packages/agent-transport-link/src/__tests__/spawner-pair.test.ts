/**
 * The runtime's end of the spawner exchange, on a descriptor stood in for by scripted I/O: it takes
 * exactly what the spawner wrote, answers, and gives the descriptor back on every path, so nothing
 * the runtime starts afterwards can inherit it. The same key the runtime derives must admit the
 * spawner it came from, and the spawner's end must refuse a runtime that answers wrongly.
 */
import { Buffer } from 'node:buffer';
import { Duplex } from 'node:stream';

import {
  LinkRefusedError,
  SPAWNER_EXCHANGE_MESSAGE_BYTES,
  SPAWNER_EXCHANGE_REPLY_BYTES,
  createRuntimeIdentity,
  startSpawnerExchange,
} from '@robota-sdk/agent-keyring';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SPAWNER_PAIR_FD,
  SpawnerPairError,
  answerSpawnerPair,
  completeSpawnerPair,
  openSpawnerLink,
  type ISpawnerPairIo,
} from '../index.js';
import { BINDING, connect, controlEndpoint, listen, recordingRuntime, type IListening } from './harness.js';

const servers: IListening[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

interface IScriptedPair extends ISpawnerPairIo {
  /** What the spawner wrote, handed out `readSize` bytes at a time; empty once it is read. */
  incoming: Buffer;
  readonly written: Buffer[];
  readonly calls: string[];
  /** The most one `read` or `write` call moves. */
  chunk: number;
  isPair: boolean;
  failWrite?: Error;
}

function scriptedPair(incoming: Uint8Array): IScriptedPair {
  const pair: IScriptedPair = {
    incoming: Buffer.from(incoming),
    written: [],
    calls: [],
    chunk: 5,
    isPair: true,
    isHandedOverPair: () => {
      pair.calls.push('check');
      return pair.isPair;
    },
    read: (_fd, buffer, offset, length) => {
      pair.calls.push('read');
      const size = Math.min(pair.chunk, length, pair.incoming.length);
      pair.incoming.copy(buffer, offset, 0, size);
      pair.incoming = pair.incoming.subarray(size);
      return size;
    },
    write: (_fd, buffer, offset, length) => {
      pair.calls.push('write');
      if (pair.failWrite !== undefined) throw pair.failWrite;
      const size = Math.min(pair.chunk, length);
      pair.written.push(Buffer.from(buffer.subarray(offset, offset + size)));
      return size;
    },
    close: () => {
      pair.calls.push('close');
    },
  };
  return pair;
}

describe('the runtime end of the spawner pair', () => {
  it('is descriptor 4: the first one after stdio and the IPC channel', () => {
    expect(SPAWNER_PAIR_FD).toBe(4);
  });

  it('reads what the spawner wrote in however many pieces, answers in however many, and closes', () => {
    const exchange = startSpawnerExchange();
    const pair = scriptedPair(exchange.message);
    answerSpawnerPair(createRuntimeIdentity(), SPAWNER_PAIR_FD, pair);

    const reply = Buffer.concat(pair.written);
    expect(reply.length).toBe(SPAWNER_EXCHANGE_REPLY_BYTES);
    expect(pair.written.length).toBeGreaterThan(1);
    expect(pair.calls.at(-1)).toBe('close');
    expect(pair.calls.filter((call) => call === 'close')).toHaveLength(1);
    expect(pair.calls.indexOf('check')).toBe(0);
  });

  it('derives the key its spawner derives, which then admits the spawner on a link', async () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const pair = scriptedPair(exchange.message);
    answerSpawnerPair(identity, SPAWNER_PAIR_FD, pair);
    const { spawnerKey, instancePublicKey } = exchange.complete(Buffer.concat(pair.written));

    const runtime = recordingRuntime(identity);
    const server = await listen(controlEndpoint(identity, runtime.admit));
    servers.push(server);
    const client = await openSpawnerLink(await connect(server.port), spawnerKey, instancePublicKey);
    expect(client.standing).toBe('spawner');
    expect(client.binding).toEqual(BINDING);
    client.close();
  });

  it.each([
    ['the spawner closes before it has written all of it', SPAWNER_EXCHANGE_MESSAGE_BYTES - 1],
    ['the spawner wrote nothing', 0],
  ])('gives the descriptor back and refuses when %s', (_name, bytes) => {
    const pair = scriptedPair(Buffer.alloc(bytes, 1));

    expect(() => answerSpawnerPair(createRuntimeIdentity(), SPAWNER_PAIR_FD, pair)).toThrow(
      SpawnerPairError,
    );
    expect(pair.written).toEqual([]);
    expect(pair.calls.at(-1)).toBe('close');
  });

  it('gives the descriptor back when the identity refuses what it read', () => {
    const pair = scriptedPair(Buffer.alloc(SPAWNER_EXCHANGE_MESSAGE_BYTES, 0));

    expect(() => answerSpawnerPair(createRuntimeIdentity(), SPAWNER_PAIR_FD, pair)).toThrow(
      LinkRefusedError,
    );
    expect(pair.written).toEqual([]);
    expect(pair.calls.at(-1)).toBe('close');
  });

  it('gives the descriptor back when the answer cannot be written', () => {
    const exchange = startSpawnerExchange();
    const pair = scriptedPair(exchange.message);
    pair.failWrite = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });

    expect(() => answerSpawnerPair(createRuntimeIdentity(), SPAWNER_PAIR_FD, pair)).toThrow(
      SpawnerPairError,
    );
    expect(pair.calls.at(-1)).toBe('close');
  });

  it('answers once: a second call on the same identity is refused', () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    answerSpawnerPair(identity, SPAWNER_PAIR_FD, scriptedPair(exchange.message));

    const second = scriptedPair(startSpawnerExchange().message);
    expect(() => answerSpawnerPair(identity, SPAWNER_PAIR_FD, second)).toThrow(LinkRefusedError);
    expect(second.calls.at(-1)).toBe('close');
  });

  it('reads nothing from, and does not close, a descriptor that is not the spawner pair', () => {
    // A runtime started without a spawner has its own descriptors at this index: a blocking read
    // there never returns, and closing it would break the runtime.
    const pair = scriptedPair(startSpawnerExchange().message);
    pair.isPair = false;

    expect(() => answerSpawnerPair(createRuntimeIdentity(), SPAWNER_PAIR_FD, pair)).toThrow(
      SpawnerPairError,
    );
    expect(pair.calls).toEqual(['check']);
  });
});

/** Both ends of a pair as streams: what one end writes, the other reads, and ending one ends the other's reading. */
function connectedDuplexes(): { spawner: Duplex; runtime: Duplex } {
  const spawner: Duplex = new Duplex({
    read: () => undefined,
    write: (chunk: Buffer, _encoding, callback) => {
      runtime.push(chunk);
      callback();
    },
    final: (callback) => {
      runtime.push(null);
      callback();
    },
  });
  const runtime: Duplex = new Duplex({
    read: () => undefined,
    write: (chunk: Buffer, _encoding, callback) => {
      spawner.push(chunk);
      callback();
    },
    final: (callback) => {
      spawner.push(null);
      callback();
    },
  });
  return { spawner, runtime };
}

describe('the spawner end of the spawner pair', () => {
  it('writes first, takes the runtime instance key from the answer, and closes its end', async () => {
    const identity = createRuntimeIdentity();
    const { spawner, runtime } = connectedDuplexes();

    const completing = completeSpawnerPair(spawner);
    const message = await new Promise<Buffer>((resolve) => runtime.once('data', resolve));
    expect(message.length).toBe(SPAWNER_EXCHANGE_MESSAGE_BYTES);
    const pair = scriptedPair(message);
    answerSpawnerPair(identity, SPAWNER_PAIR_FD, pair);
    runtime.write(Buffer.concat(pair.written));

    const { spawnerKey, instancePublicKey } = await completing;
    expect(Buffer.from(instancePublicKey)).toEqual(Buffer.from(identity.instancePublicKey));
    expect(spawnerKey.wiped).toBe(false);
    expect(spawner.destroyed).toBe(true);
    spawnerKey.wipe();
  });

  it.each([
    ['a runtime that closes without answering', (runtime: Duplex) => runtime.end()],
    [
      'an answer that stops short',
      (runtime: Duplex) => {
        runtime.write(Buffer.alloc(SPAWNER_EXCHANGE_REPLY_BYTES - 1));
        runtime.end();
      },
    ],
    [
      'an answer with more behind it',
      (runtime: Duplex) => runtime.write(Buffer.alloc(SPAWNER_EXCHANGE_REPLY_BYTES + 1, 2)),
    ],
  ])('refuses %s, and closes its end', async (_name, answer) => {
    const { spawner, runtime } = connectedDuplexes();
    const completing = completeSpawnerPair(spawner, { timeoutMs: 5_000 });
    answer(runtime);

    await expect(completing).rejects.toBeInstanceOf(SpawnerPairError);
    expect(spawner.destroyed).toBe(true);
  });

  it('gives up on a runtime that never answers', async () => {
    const { spawner } = connectedDuplexes();

    await expect(completeSpawnerPair(spawner, { timeoutMs: 50 })).rejects.toBeInstanceOf(
      SpawnerPairError,
    );
    expect(spawner.destroyed).toBe(true);
  });
});
