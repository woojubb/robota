/**
 * The owner link over a real loopback socket pair, as a runtime's control endpoint and its two kinds
 * of client use it: the spawner links with its spawner key, learns the binding and certifies the
 * runtime; the owner then links with its handover, unlocks it with a read grant and uses the owner
 * vocabulary. The runtime closes, and says nothing, on a handshake that fails, a request that does
 * not decode, a frame over its bound and a handshake that never finishes.
 */
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import type { Socket } from 'node:net';
import { Duplex, PassThrough } from 'node:stream';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  LINK_HELLO_BYTES,
  LINK_PROOF_MAX_BYTES,
  createLinkInitiator,
  createRuntimeIdentity,
  startSpawnerExchange,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type SpawnerKey,
} from '@robota-sdk/agent-keyring';
import { MAX_INBOUND_FRAME_BYTES } from '@robota-sdk/agent-transport';

import {
  LINK_REQUEST_LINE,
  OwnerLinkClosedError,
  OwnerRequestRefusedError,
  openOwnerLink,
  openSpawnerLink,
  serveRuntimeLink,
  type IAdmittedRuntimeLink,
  type IRuntimeCustodyState,
  type IRuntimeLinkPorts,
} from '../index.js';
import { MAX_PENDING_CLIENT_BYTES, MAX_REQUESTS_IN_FLIGHT } from '../link-bounds.js';
import {
  decodeRuntimeMessage,
  encodeOwnerRequest,
  encodeRuntimeMessage,
} from '../owner-vocabulary.js';
import {
  BINDING,
  connect,
  controlEndpoint,
  frame,
  frameReader,
  handRuntime,
  keyrings,
  listen,
  recordingRuntime,
  until,
  type IListening,
} from './harness.js';

let owner: IOwnerHandover;
let sealingPublicKey: Uint8Array;
const servers: IListening[] = [];

/** A real connected stream whose outgoing write can be held without consuming any bytes. */
class PausableWriteDuplex extends Duplex {
  blocked = false;
  #held: { chunk: Buffer; callback: (error?: Error | null) => void } | undefined;
  readonly #socket: Socket;

  constructor(socket: Socket) {
    super({ highWaterMark: 1024 });
    this.#socket = socket;
    socket.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) socket.pause();
    });
    socket.on('end', () => this.push(null));
    socket.on('error', (error) => this.destroy(error));
    socket.on('close', () => this.destroy());
  }

  override _read(): void {
    this.#socket.resume();
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (this.blocked) {
      this.#held = { chunk, callback };
      return;
    }
    this.#socket.write(chunk, callback);
  }

  release(): void {
    this.blocked = false;
    const held = this.#held;
    this.#held = undefined;
    if (held) this.#socket.write(held.chunk, held.callback);
  }

  override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.#socket.destroy();
    callback(error);
  }
}

beforeAll(async () => {
  ({ owner, sealingPublicKey } = await keyrings());
});
afterAll(() => owner.dispose());
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

interface IStartedRuntime {
  readonly identity: IRuntimeIdentity;
  readonly spawnerKey: SpawnerKey;
  readonly instancePublicKey: Uint8Array;
  readonly runtime: ReturnType<typeof recordingRuntime>;
  readonly port: number;
}

/**
 * A runtime that ran its spawner exchange and serves its control endpoint; `onAdmit` runs inside
 * the runtime's `admit`, where a runtime may already want to send something.
 */
async function startRuntime(
  options: {
    readonly handshakeTimeoutMs?: number;
    readonly onAdmit?: (link: IAdmittedRuntimeLink) => void;
  } = {},
): Promise<IStartedRuntime> {
  const identity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  const runtime = recordingRuntime(identity);
  const admit = (link: IAdmittedRuntimeLink): IRuntimeLinkPorts => {
    const ports = runtime.admit(link);
    options.onAdmit?.(link);
    return ports;
  };
  const server = await listen(controlEndpoint(identity, admit, options));
  servers.push(server);
  return { identity, spawnerKey, instancePublicKey, runtime, port: server.port };
}

/** A runtime its spawner has already certified for the owner; the spawner wipes its key unless told not to. */
async function startCertifiedRuntime(
  options: { readonly keepSpawnerKey?: boolean } = {},
): Promise<IStartedRuntime> {
  const started = await startRuntime();
  const spawner = await openSpawnerLink(
    await connect(started.port),
    started.spawnerKey,
    started.instancePublicKey,
  );
  await spawner.installTrustRoot(owner.certify(spawner.instancePublicKey, spawner.binding));
  spawner.close();
  if (options.keepSpawnerKey !== true) started.spawnerKey.wipe();
  return started;
}

describe('a spawner link', () => {
  it('bounds queued writes, closes an overloaded link and leaves a different link usable', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const stream = new PausableWriteDuplex(await connect(port));
    const client = await openSpawnerLink(stream, spawnerKey, instancePublicKey);
    await client.installTrustRoot(owner.certify(client.instancePublicKey, client.binding));
    const other = await openOwnerLink(await connect(port), owner);
    const pending = client.question('gated').then(
      () => undefined,
      (error: unknown) => error,
    );
    await until(() => runtime.record.gates.length === 1);
    stream.blocked = true;
    let sent = 0;
    let refusal: unknown;
    let peakQueued = 0;
    try {
      for (; sent < 100; sent++) {
        try {
          client.session.send({ type: 'submit', prompt: 'x'.repeat(65_536) });
          peakQueued = Math.max(peakQueued, stream.writableLength);
        } catch (error) {
          refusal = error;
          break;
        }
      }
      expect(refusal).toBeInstanceOf(OwnerLinkClosedError);
      expect(sent).toBeGreaterThan(0);
      expect(sent).toBeLessThan(100);
      expect(peakQueued).toBeGreaterThan(0);
      expect(peakQueued).toBeLessThanOrEqual(MAX_PENDING_CLIENT_BYTES);
      await client.closed;
      expect(await pending).toBeInstanceOf(OwnerLinkClosedError);
      other.session.send({ type: 'get-messages' });
      await until(() =>
        runtime.record.sessionData.some((entry) => JSON.parse(entry).type === 'get-messages'),
      );
    } finally {
      client.close();
      other.close();
      runtime.record.gates.forEach((resolve) => resolve());
    }
  });

  it('continues in message order when a temporarily stalled stream drains', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const stream = new PausableWriteDuplex(await connect(port));
    const client = await openSpawnerLink(stream, spawnerKey, instancePublicKey);
    try {
      stream.blocked = true;
      client.session.send({ type: 'submit', prompt: 'first '.repeat(256) });
      expect(stream.writableNeedDrain).toBe(true);
      const drained = once(stream, 'drain');
      stream.release();
      await drained;
      client.session.send({ type: 'submit', prompt: 'second' });
      await until(() => runtime.record.sessionData.length === 2);
      expect(runtime.record.sessionData.map((data) => JSON.parse(data).prompt)).toEqual([
        'first '.repeat(256),
        'second',
      ]);
    } finally {
      client.close();
    }
  });

  it('admits the spawner, which learns the binding and certifies the runtime', async () => {
    const { identity, spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    expect(client.standing).toBe('spawner');
    expect(client.binding).toEqual(BINDING);
    expect(client.custody).toEqual({ unlocked: false, certified: false });
    expect(runtime.record.links.map((link) => link.standing)).toEqual(['spawner']);

    await client.installTrustRoot(owner.certify(client.instancePublicKey, client.binding));
    expect(identity.certified).toBe(true);
    expect(runtime.record.calls).toEqual(['install-trust-root']);

    client.close();
    await client.closed;
    await until(() => runtime.record.closed === 1);
  });

  it('keeps the link when a listener throws', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    const received: unknown[] = [];
    client.session.onMessage(() => {
      throw new Error('a listener bug');
    });
    client.session.onMessage((message) => received.push(message));
    for (const delta of ['a', 'b']) {
      runtime.record.links[0]!.sendSession(JSON.stringify({ type: 'text_delta', delta }));
    }
    await until(() => received.length === 2);
    expect(runtime.record.links[0]!.closed).toBe(false);
    client.close();
  });

  it('carries the session protocol both ways', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    client.session.send({ type: 'submit', prompt: 'hello' });
    await until(() => runtime.record.sessionData.length === 1);
    expect(JSON.parse(runtime.record.sessionData[0]!)).toEqual({ type: 'submit', prompt: 'hello' });

    const received: unknown[] = [];
    client.session.onMessage((message) => received.push(message));
    runtime.record.links[0]!.sendSession(JSON.stringify({ type: 'text_delta', delta: 'hi' }));
    await until(() => received.length === 1);
    expect(received).toEqual([{ type: 'text_delta', delta: 'hi' }]);
    client.close();
  });
});

describe('what a runtime sends from inside admit', () => {
  const early = (link: IAdmittedRuntimeLink): void => {
    link.sendSession(JSON.stringify({ type: 'text_delta', delta: 'early' }));
    link.notifyCustody({ unlocked: true, certified: false });
  };

  it('goes out after the custody notice, in the order it was sent', async () => {
    const { spawnerKey, instancePublicKey, port } = await startRuntime({ onAdmit: early });
    const socket = await connect(port);
    const reader = frameReader(socket);
    const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
    const { proof, link } = initiator.answer((await reader.next())!);
    socket.write(frame(proof));

    const opened = [];
    for (let index = 0; index < 3; index += 1) opened.push(link.open((await reader.next())!));
    expect(opened.map((frame) => frame.kind)).toEqual(['owner', 'session', 'owner']);
    expect(decodeRuntimeMessage(opened[0]!.plaintext)).toEqual({
      op: 'custody',
      state: { unlocked: false, certified: false },
    });
    expect(JSON.parse(opened[1]!.plaintext.toString('utf8'))).toEqual({
      type: 'text_delta',
      delta: 'early',
    });
    expect(decodeRuntimeMessage(opened[2]!.plaintext)).toEqual({
      op: 'custody',
      state: { unlocked: true, certified: false },
    });
    socket.destroy();
  });

  it('does not make the client refuse the link it was just admitted to', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime({ onAdmit: early });
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    // Listeners attached as the open resolves hear what was sent behind the notice.
    const received: unknown[] = [];
    client.session.onMessage((message) => received.push(message));
    await until(() => client.custody.unlocked && received.length === 1, 1_000);
    expect(received).toEqual([{ type: 'text_delta', delta: 'early' }]);
    expect(runtime.record.links[0]!.closed).toBe(false);
    client.close();
  });
});

describe('what a runtime sends right behind its custody notice', () => {
  /** A certified runtime, by hand, that writes the notice and a session message in one write. */
  async function behindTheNotice(finish: (socket: Socket, bytes: Buffer) => void) {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    exchange.complete(identity.answerSpawnerExchange(exchange.message)).spawnerKey.wipe();
    identity.installTrustRoot(owner.certify(identity.instancePublicKey, BINDING), BINDING);
    const server = await listen(
      handRuntime(identity, (socket, link) => {
        const notice = encodeRuntimeMessage({
          op: 'custody',
          state: { unlocked: false, certified: true },
        });
        const message = Buffer.from(JSON.stringify({ type: 'text_delta', delta: 'behind' }));
        finish(
          socket,
          Buffer.concat([frame(link.seal('owner', notice)), frame(link.seal('session', message))]),
        );
      }),
    );
    servers.push(server);
    return server.port;
  }

  it('reaches listeners attached as the open resolves', async () => {
    const port = await behindTheNotice((socket, bytes) => socket.write(bytes));
    const client = await openOwnerLink(await connect(port), owner);
    const received: unknown[] = [];
    client.session.onMessage((message) => received.push(message));
    await until(() => received.length === 1, 1_000);
    expect(received).toEqual([{ type: 'text_delta', delta: 'behind' }]);
    client.close();
  });

  it('reaches them though the runtime closed the stream right behind it', async () => {
    const port = await behindTheNotice((socket, bytes) => socket.end(bytes));
    const client = await openOwnerLink(await connect(port), owner);
    const received: unknown[] = [];
    client.session.onMessage((message) => received.push(message));
    await until(() => received.length === 1, 1_000);
    expect(received).toEqual([{ type: 'text_delta', delta: 'behind' }]);
    await client.closed;
  });
});

/** A text-delta message from the runtime, serialized, whose `delta` is `text`. */
const textDelta = (text: string): string => JSON.stringify({ type: 'text_delta', delta: text });
/** A submit from a client, serialized, whose `prompt` is `text`. */
const submit = (text: string): string => JSON.stringify({ type: 'submit', prompt: text });
/** `text` repeated so that `make(text)` is exactly `bytes` UTF-8 bytes long. */
function sized(make: (text: string) => string, bytes: number): string {
  return make('x'.repeat(bytes - Buffer.byteLength(make(''))));
}

describe('a session message at and over the bound the receiving decoder applies', () => {
  const over = (make: (text: string) => string): string[] => [
    sized(make, MAX_INBOUND_FRAME_BYTES + 1),
    // Under the decoder's limit in characters, over it in bytes: the local attach path refuses it too.
    make('\u20ac'.repeat(Math.ceil(MAX_INBOUND_FRAME_BYTES / 3))),
  ];

  it('from the runtime: an over-bound send throws, the link stays open, and the next message arrives', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);
    const received: unknown[] = [];
    client.session.onMessage((message) => received.push(message));
    const link = runtime.record.links[0]!;

    link.sendSession(sized(textDelta, MAX_INBOUND_FRAME_BYTES));
    for (const data of over(textDelta)) expect(() => link.sendSession(data)).toThrow(RangeError);
    link.sendSession(textDelta('after'));

    await until(() => received.length === 2);
    expect(received.at(-1)).toEqual({ type: 'text_delta', delta: 'after' });
    expect(link.closed).toBe(false);
    client.close();
  });

  it('from the client: an over-bound send throws, the link stays open, and the next message arrives', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const client = await openSpawnerLink(await connect(port), spawnerKey, instancePublicKey);

    client.session.send(JSON.parse(sized(submit, MAX_INBOUND_FRAME_BYTES)));
    for (const data of over(submit)) {
      expect(() => client.session.send(JSON.parse(data))).toThrow(RangeError);
    }
    client.session.send({ type: 'submit', prompt: 'after' });

    await until(() => runtime.record.sessionData.length === 2);
    expect(JSON.parse(runtime.record.sessionData.at(-1)!)).toEqual({
      type: 'submit',
      prompt: 'after',
    });
    expect(runtime.record.links[0]!.closed).toBe(false);
    client.close();
  });
});

describe('an owner link', () => {
  it('admits the owner of a certified runtime and unlocks it with a read grant', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const client = await openOwnerLink(await connect(port), owner);
    expect(client.standing).toBe('owner');
    expect(client.custody).toEqual({ unlocked: false, certified: true });

    expect(await client.unlock()).toBe('verified');
    expect(Buffer.from(runtime.record.grantedKeys[0]!.sealing.publicKey)).toEqual(
      Buffer.from(sealingPublicKey),
    );
    expect('attach' in runtime.record.grantedKeys[0]!).toBe(false);
    client.close();
  });

  it('asks and answers the owner vocabulary, and hears custody notices', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const client = await openOwnerLink(await connect(port), owner);
    await client.lock('screen-lock');
    expect(await client.question('sess_1')).toEqual({
      kind: 'accept',
      questionId: 'question-1',
      digest: 'd'.repeat(64),
      notice: 'This session was not verified as yours.',
      question: 'Resume sess_1 and mark it as yours?',
    });
    await client.openAccepted('attach:1', 'sess_1', 'd'.repeat(64), 'question-1');
    expect(await client.control({ command: 'rename', fields: { name: 'Mine' } })).toEqual({
      status: 'renamed',
      name: 'Mine',
    });
    expect(runtime.record.calls.slice(-3)).toEqual([
      ['lock', 'screen-lock'],
      ['open-accepted', 'attach:1', 'sess_1', 'd'.repeat(64), 'question-1'],
      ['control', 'rename'],
    ]);

    const notices: IRuntimeCustodyState[] = [];
    client.onCustody((state) => notices.push(state));
    runtime.record.links.at(-1)!.notifyCustody({ unlocked: true, certified: true });
    await until(() => notices.length === 1);
    expect(client.custody).toEqual({ unlocked: true, certified: true });
    client.close();
  });

  it('reports a refusal the runtime decided, with its code and message', async () => {
    const { port } = await startCertifiedRuntime();
    const client = await openOwnerLink(await connect(port), owner);
    const refusal = await client
      .installTrustRoot(owner.certify(client.instancePublicKey, client.binding))
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(OwnerRequestRefusedError);
    expect(refusal).toMatchObject({
      code: 'not-allowed',
      message: 'Only the spawner installs a trust root.',
    });
    // The link survives a refusal.
    await client.lock('explicit');
    client.close();
  });
});

describe('the runtime refuses, and says nothing', () => {
  it('spawner standing once certified, and owner standing before', async () => {
    const certified = await startCertifiedRuntime({ keepSpawnerKey: true });
    await expect(
      openSpawnerLink(
        await connect(certified.port),
        certified.spawnerKey,
        certified.instancePublicKey,
      ),
    ).rejects.toBeInstanceOf(OwnerLinkClosedError);
    expect(certified.runtime.record.links.map((link) => link.standing)).toEqual(['spawner']);
    const uncertified = await startRuntime();
    await expect(openOwnerLink(await connect(uncertified.port), owner)).rejects.toBeInstanceOf(
      OwnerLinkClosedError,
    );
    expect(uncertified.runtime.record.links).toEqual([]);
  });

  it('a wrong proof: the link closes after the challenge, and nothing is admitted', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const admittedBefore = runtime.record.links.length;
    const socket = await connect(port);
    const reader = frameReader(socket);
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
    expect(await reader.next()).toBeDefined();
    socket.write(frame(Buffer.alloc(64, 1)));
    expect(await reader.next()).toBeUndefined();
    expect(runtime.record.links.length).toBe(admittedBefore);
  });

  it('a request that does not decode: the link closes before the desk sees it', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const socket = await connect(port);
    const reader = frameReader(socket);
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
    const { proof, link } = initiator.answer((await reader.next())!);
    socket.write(frame(proof));
    expect(link.open((await reader.next())!).kind).toBe('owner');
    const callsBefore = runtime.record.calls.length;
    socket.write(frame(link.seal('owner', Buffer.from('{"op":"unlock","requestId":"r1"}'))));
    expect(await reader.next()).toBeUndefined();
    expect(runtime.record.calls.length).toBe(callsBefore);
    await until(() => runtime.record.closed >= 2);
  });

  it('a frame announced over its bound, before any of it is read', async () => {
    const { runtime, port } = await startRuntime();
    const socket = await connect(port);
    const reader = frameReader(socket);
    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(0xffffffff);
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), oversized]));
    expect(await reader.next()).toBeUndefined();
    expect(reader.received()).toHaveLength(0);
    expect(runtime.record.links).toEqual([]);
  });

  it('a frame announced over its bound at the hello step, which is the size of a hello', async () => {
    const { runtime, port } = await startRuntime();
    const socket = await connect(port);
    const reader = frameReader(socket);
    const announced = Buffer.alloc(4);
    announced.writeUInt32BE(LINK_HELLO_BYTES + 1);
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), announced]));
    // Closed on the length alone, long before the handshake would time out.
    await until(() => reader.closed(), 2_000);
    expect(reader.received()).toHaveLength(0);
    expect(runtime.record.links).toEqual([]);
  });

  it('a frame announced over its bound at the proof step, which is the size of a proof', async () => {
    const { spawnerKey, instancePublicKey, runtime, port } = await startRuntime();
    const socket = await connect(port);
    const reader = frameReader(socket);
    const initiator = createLinkInitiator({ mode: 'spawner', spawnerKey, instancePublicKey });
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
    const challenge = (await reader.next())!;
    const announced = Buffer.alloc(4);
    announced.writeUInt32BE(LINK_PROOF_MAX_BYTES + 1);
    socket.write(announced);
    await until(() => reader.closed(), 2_000);
    expect(reader.received()).toHaveLength(frame(challenge).length);
    expect(runtime.record.links).toEqual([]);
  });

  it('a handshake that does not finish in time', async () => {
    const { port } = await startRuntime({ handshakeTimeoutMs: 50 });
    const socket = await connect(port);
    const reader = frameReader(socket);
    socket.write(LINK_REQUEST_LINE);
    expect(await reader.next()).toBeUndefined();
    expect(reader.received()).toHaveLength(0);
  });
});

describe('the runtime closes', () => {
  it('a peer that sends more requests than it may have waiting', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const socket = await connect(port);
    const reader = frameReader(socket);
    const initiator = createLinkInitiator({ mode: 'owner', handover: owner });
    socket.write(Buffer.concat([Buffer.from(LINK_REQUEST_LINE), frame(initiator.hello())]));
    const { proof, link } = initiator.answer((await reader.next())!);
    socket.write(frame(proof));
    expect(link.open((await reader.next())!).kind).toBe('owner');

    // `held` is never answered, so each of these still waits when the next arrives.
    for (let id = 1; id <= MAX_REQUESTS_IN_FLIGHT + 1; id += 1) {
      const request = { op: 'question', requestId: `r${id}`, sessionId: 'held' } as const;
      socket.write(frame(link.seal('owner', encodeOwnerRequest(request))));
    }
    expect(await reader.next()).toBeUndefined();
    expect(runtime.record.grantedKeys).toEqual([]);
  });
});

describe('the requests a client has waiting at once', () => {
  it('may be as many as the runtime allows; one more is refused locally and the link carries on', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    runtime.record.gateUnlock = true;
    const client = await openOwnerLink(await connect(port), owner);
    const waiting = [
      client.unlock(),
      ...Array.from({ length: MAX_REQUESTS_IN_FLIGHT - 1 }, () => client.question('gated')),
    ];
    await until(() => runtime.record.gates.length === MAX_REQUESTS_IN_FLIGHT);

    for (const refused of [client.question('gated'), client.unlock()]) {
      await expect(refused).rejects.toBeInstanceOf(OwnerRequestRefusedError);
      await expect(refused).rejects.toMatchObject({ code: 'busy' });
    }
    // Nothing was sent for the refused ones, and the link is still open.
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.record.gates).toHaveLength(MAX_REQUESTS_IN_FLIGHT);
    expect(runtime.record.links.at(-1)!.closed).toBe(false);

    for (const open of runtime.record.gates.splice(0)) open();
    expect(await Promise.all(waiting)).toEqual(['verified', ...Array(63).fill({ kind: 'open' })]);
    runtime.record.gateUnlock = false;
    // A slot is free again.
    expect(await client.question('sess_2')).toMatchObject({ kind: 'accept' });
    client.close();
  });
});

describe('the client', () => {
  it('reports a runtime that admitted it but did not announce its custody as a closed link', async () => {
    const identity = createRuntimeIdentity();
    const exchange = startSpawnerExchange();
    exchange.complete(identity.answerSpawnerExchange(exchange.message)).spawnerKey.wipe();
    identity.installTrustRoot(owner.certify(identity.instancePublicKey, BINDING), BINDING);
    const server = await listen(
      handRuntime(identity, (socket, link) => {
        // A sealed frame that does not open, where the custody notice belongs.
        socket.write(frame(Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 9)])));
        void link;
      }),
    );
    servers.push(server);
    await expect(openOwnerLink(await connect(server.port), owner)).rejects.toBeInstanceOf(
      OwnerLinkClosedError,
    );
  });

  it('rejects what it was waiting for when the link closes', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const client = await openOwnerLink(await connect(port), owner);
    const pending = client.question('held');
    runtime.record.links.at(-1)!.close();
    await expect(pending).rejects.toBeInstanceOf(OwnerLinkClosedError);
    await client.closed;
    await expect(client.lock('explicit')).rejects.toBeInstanceOf(OwnerLinkClosedError);
  });
});

/** How an opening ended, or `'never settled'`: an open that waits forever is the failure under test. */
async function outcomeOf(opening: Promise<unknown>, withinMs = 2_000): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const never = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve('never settled'), withinMs);
  });
  try {
    return await Promise.race([
      opening.then(
        () => 'opened',
        (error: unknown) => error,
      ),
      never,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** A stream that takes writes, never answers, and ignores `destroy`. */
class StuckStream extends Duplex {
  override _read(): void {}
  override _write(_chunk: unknown, _encoding: string, done: () => void): void {
    done();
  }
  override destroy(): this {
    return this;
  }
}

describe('a stream that cannot answer', () => {
  it('rejects an opening on a stream that is already closed, as a closed link', async () => {
    const { spawnerKey, instancePublicKey, port } = await startRuntime();
    const openings = [
      (stream: Socket) =>
        openSpawnerLink(stream, spawnerKey, instancePublicKey, { timeoutMs: 200 }),
      (stream: Socket) => openOwnerLink(stream, owner, { timeoutMs: 200 }),
    ];
    for (const open of openings) {
      const socket = await connect(port);
      const closed = once(socket, 'close');
      socket.destroy();
      await closed;
      expect(await outcomeOf(open(socket))).toBeInstanceOf(OwnerLinkClosedError);
    }
  });

  it('rejects an opening at its timeout as a closed link, whatever the stream does when destroyed', async () => {
    const { spawnerKey, instancePublicKey } = await startRuntime();
    const opening = openSpawnerLink(new StuckStream(), spawnerKey, instancePublicKey, {
      timeoutMs: 50,
    });
    expect(await outcomeOf(opening)).toBeInstanceOf(OwnerLinkClosedError);
  });

  it('serves a stream that is already closed by admitting nothing and releasing its handshake timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const stream = new PassThrough();
      stream.destroy();
      await once(stream, 'close');
      const admit = vi.fn();
      serveRuntimeLink(stream, { identity: createRuntimeIdentity(), binding: BINDING, admit });
      await new Promise((resolve) => setImmediate(resolve));
      expect(admit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
