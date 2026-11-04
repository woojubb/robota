/**
 * A program that took over the control socket and answers like a runtime. It may run a real runtime
 * of its own, certified by its own keyring or by nobody, or forge an answer by hand. Every byte the
 * client sends it is recorded: the client is refused before it sends anything but the request line
 * and its hello, so the squatter never sees a proof, a grant or a session frame.
 */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import type { Socket } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  LINK_CHALLENGE_MAX_BYTES,
  LINK_HELLO_BYTES,
  LinkRefusedError,
  createLinkResponder,
  createRuntimeIdentity,
  startSpawnerExchange,
  type IOwnerHandover,
  type IRuntimeIdentity,
} from '@robota-sdk/agent-keyring';

import {
  LINK_REQUEST_LINE,
  OwnerLinkClosedError,
  openOwnerLink,
  openSpawnerLink,
} from '../index.js';
import { BINDING, connect, frame, keyrings, listen, type IListening } from './harness.js';

let owner: IOwnerHandover;
let stranger: IOwnerHandover;
const servers: IListening[] = [];

beforeAll(async () => {
  ({ owner, stranger } = await keyrings());
});
afterAll(() => {
  owner.dispose();
  stranger.dispose();
});
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

/** A squatter that answers each hello with `answer(hello)` and records everything it receives. */
async function squatter(answer: (hello: Uint8Array) => Uint8Array) {
  const received: Buffer[] = [];
  const server = await listen((socket: Socket) => {
    let buffered = Buffer.alloc(0);
    let answered = false;
    socket.on('data', (chunk: Buffer) => {
      received.push(chunk);
      buffered = Buffer.concat([buffered, chunk]);
      const helloStart = buffered.indexOf(0x0a) + 1;
      if (!answered && helloStart > 0 && buffered.length >= helloStart + 4 + LINK_HELLO_BYTES) {
        answered = true;
        socket.write(
          frame(answer(buffered.subarray(helloStart + 4, helloStart + 4 + LINK_HELLO_BYTES))),
        );
      }
    });
  });
  servers.push(server);
  return { port: server.port, received: () => Buffer.concat(received) };
}

/** What a client sends before it has checked the runtime: the request line and its hello, no more. */
function expectOnlyHello(received: Buffer): void {
  const line = Buffer.from(LINK_REQUEST_LINE);
  expect(received.subarray(0, line.length).toString()).toBe(LINK_REQUEST_LINE);
  expect(received.readUInt32BE(line.length)).toBe(LINK_HELLO_BYTES);
  expect(received.length).toBe(line.length + 4 + LINK_HELLO_BYTES);
}

function certifiedBy(handover: IOwnerHandover): IRuntimeIdentity {
  const identity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  exchange.complete(identity.answerSpawnerExchange(exchange.message)).spawnerKey.wipe();
  identity.installTrustRoot(handover.certify(identity.instancePublicKey, BINDING), BINDING);
  return identity;
}

async function refusal(opening: Promise<unknown>): Promise<string> {
  const error = await opening.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(LinkRefusedError);
  return (error as LinkRefusedError).reason;
}

describe('a squatter on the control socket', () => {
  it('running a runtime another keyring certified gets no proof from the owner', async () => {
    const identity = certifiedBy(stranger);
    const { port, received } = await squatter((hello) =>
      createLinkResponder(identity, BINDING).challenge(hello),
    );
    expect(await refusal(openOwnerLink(await connect(port), owner))).toBe('certificate-mismatch');
    expectOnlyHello(received());
  });

  it('forging an owner-mode answer gets no proof from the owner', async () => {
    const forged = (): Uint8Array =>
      Buffer.concat([
        randomBytes(96),
        Buffer.from([0, 4]),
        Buffer.from('fake'),
        Buffer.from([0, 4]),
        Buffer.from('fake'),
        Buffer.from([0, 64]),
        randomBytes(64),
        randomBytes(64),
      ]);
    const { port, received } = await squatter(forged);
    expect(await refusal(openOwnerLink(await connect(port), owner))).toBe('certificate-mismatch');
    expectOnlyHello(received());
  });

  it('running a runtime of its own gets nothing from the real spawner', async () => {
    const real = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    const { spawnerKey, instancePublicKey } = exchange.complete(
      real.answerSpawnerExchange(exchange.message),
    );
    const own = createRuntimeIdentity();
    const ownExchange = startSpawnerExchange();
    ownExchange.complete(own.answerSpawnerExchange(ownExchange.message));
    const { port, received } = await squatter((hello) =>
      createLinkResponder(own, BINDING).challenge(hello),
    );
    expect(await refusal(openSpawnerLink(await connect(port), spawnerKey, instancePublicKey))).toBe(
      'instance-mismatch',
    );
    expectOnlyHello(received());
  });

  it('announcing a challenge over its bound is closed on, not read, and nothing more is sent', async () => {
    const { port, received } = await squatter(() => randomBytes(LINK_CHALLENGE_MAX_BYTES + 1));
    // A closed link, not a refusal: the client never read the challenge to judge it.
    await expect(openOwnerLink(await connect(port), owner)).rejects.toBeInstanceOf(
      OwnerLinkClosedError,
    );
    expectOnlyHello(received());
  });
});
