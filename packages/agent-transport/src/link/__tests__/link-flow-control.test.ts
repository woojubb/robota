/**
 * What a runtime can tell about a client that reads slowly, and what it does when it ends the link:
 * the attach carrier bounds a slow terminal by the bytes its socket still holds (1 MiB), so the link
 * must report the same number, and a runtime that ends a link right after answering (it certifies,
 * then ends the spawner's link) must not lose the answer that is still queued.
 */
import { Buffer } from 'node:buffer';
import type { Socket } from 'node:net';

import {
  createLinkInitiator,
  createRuntimeIdentity,
  startSpawnerExchange,
  type IInitiatorLink,
} from '@robota-sdk/agent-keyring';
import { afterEach, describe, expect, it } from 'vitest';

import { LINK_REQUEST_LINE, type IAdmittedRuntimeLink } from '../index.js';
import { decodeRuntimeMessage } from '../owner-vocabulary.js';
import {
  connect,
  controlEndpoint,
  frame,
  frameReader,
  listen,
  recordingRuntime,
  until,
  type IListening,
} from './harness.js';

const servers: IListening[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

const FRAME_BYTES = 512 * 1024;
const text = (size: number): string => JSON.stringify({ type: 'text_delta', delta: 'x'.repeat(size) });

interface IReadingLater {
  readonly link: IAdmittedRuntimeLink;
  readonly record: ReturnType<typeof recordingRuntime>['record'];
  readonly socket: Socket;
  readonly reader: ReturnType<typeof frameReader>;
  readonly opened: IInitiatorLink;
}

/**
 * A spawner link whose client has finished the handshake and read the custody notice, then stops
 * reading: everything the runtime sends from here on waits in the sockets and in the runtime.
 */
async function slowReader(closeFlushTimeoutMs?: number): Promise<IReadingLater> {
  const identity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  const runtime = recordingRuntime(identity);
  const server = await listen(
    controlEndpoint(identity, runtime.admit, {
      ...(closeFlushTimeoutMs === undefined ? {} : { closeFlushTimeoutMs }),
    }),
  );
  servers.push(server);
  const socket = await connect(server.port);
  const reader = frameReader(socket);
  const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
  socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
  const { proof, link } = initiator.answer((await reader.next())!);
  socket.write(frame(proof));
  expect(decodeRuntimeMessage(link.open((await reader.next())!).plaintext)?.op).toBe('custody');
  await until(() => runtime.record.links.length === 1);
  return { link: runtime.record.links[0]!, record: runtime.record, socket, reader, opened: link };
}

/** Sends frames until the runtime still holds some of them, and returns how many it sent. */
function sendUntilQueued(link: IAdmittedRuntimeLink): number {
  let sent = 0;
  while (link.pendingBytes() === 0) {
    if (sent >= 256) throw new Error('The runtime never held a byte back from a client that does not read.');
    link.sendSession(text(FRAME_BYTES));
    sent += 1;
  }
  return sent;
}

describe('pending bytes of a link', () => {
  it('count what a client that does not read has not taken, and fall back to zero once it reads', async () => {
    const { link, socket, reader } = await slowReader();
    expect(link.pendingBytes()).toBe(0);
    socket.pause();

    const sent = sendUntilQueued(link);
    expect(sent).toBeGreaterThan(0);
    expect(link.pendingBytes()).toBeGreaterThan(0);

    socket.resume();
    for (let index = 0; index < sent; index += 1) expect(await reader.next()).toBeDefined();
    await until(() => link.pendingBytes() === 0);
    socket.destroy();
  });

  it('are zero once the link is gone', async () => {
    const { link, socket, record } = await slowReader();
    socket.destroy();
    await until(() => record.closed === 1);
    expect(link.pendingBytes()).toBe(0);
  });
});

describe('closing a link', () => {
  it('delivers what was queued before it ends', async () => {
    const { link, socket, reader, opened } = await slowReader();
    socket.pause();
    const queued = sendUntilQueued(link);
    const sent = queued + 8;
    for (let index = queued; index < sent; index += 1) link.sendSession(text(FRAME_BYTES));

    link.close();
    expect(link.closed).toBe(true);
    link.sendSession(text(16));

    socket.resume();
    let delivered = 0;
    for (let frameBytes = await reader.next(); frameBytes !== undefined; frameBytes = await reader.next()) {
      expect(opened.open(frameBytes).kind).toBe('session');
      delivered += 1;
    }
    expect(delivered).toBe(sent);
    socket.destroy();
  });

  it('cuts a client that does not take what is queued once the grace has passed', async () => {
    const { link, socket, record } = await slowReader(100);
    socket.pause();
    sendUntilQueued(link);

    link.close();
    // Still held back for the client while the grace runs, then cut.
    expect(link.pendingBytes()).toBeGreaterThan(0);
    await until(() => record.closed === 1);
    expect(link.pendingBytes()).toBe(0);
    socket.destroy();
  });

  it('hears nothing more from the client', async () => {
    const { link, socket, record, opened } = await slowReader();
    socket.pause();
    sendUntilQueued(link);
    link.close();

    socket.write(frame(opened.seal('session', Buffer.from(JSON.stringify({ type: 'get-status' })))));
    socket.resume();
    await until(() => socket.destroyed || socket.readableEnded);
    expect(record.sessionData).toEqual([]);
    socket.destroy();
  });
});
