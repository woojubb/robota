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
  createLinkInitiator,
  createRuntimeIdentity,
  startSpawnerExchange,
  type IOwnerHandover,
  type IRuntimeIdentity,
  type SpawnerKey,
} from '@robota-sdk/agent-keyring';

import {
  LINK_REQUEST_LINE,
  OwnerLinkClosedError,
  OwnerRequestRefusedError,
  openOwnerLink,
  openSpawnerLink,
  serveRuntimeLink,
  type IRuntimeCustodyState,
} from '../index.js';
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

/** A runtime that ran its spawner exchange and serves its control endpoint. */
async function startRuntime(
  options: { readonly handshakeTimeoutMs?: number } = {},
): Promise<IStartedRuntime> {
  const identity = createRuntimeIdentity();
  const exchange = startSpawnerExchange();
  const { spawnerKey, instancePublicKey } = exchange.complete(
    identity.answerSpawnerExchange(exchange.message),
  );
  const runtime = recordingRuntime(identity);
  const server = await listen(controlEndpoint(identity, runtime.admit, options));
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
      digest: 'd'.repeat(64),
      notice: 'This session was not verified as yours.',
      question: 'Resume sess_1 and mark it as yours?',
    });
    await client.openAccepted('sess_1', 'd'.repeat(64));
    expect(await client.control({ command: 'rename', fields: { name: 'Mine' } })).toEqual({
      status: 'renamed',
      name: 'Mine',
    });
    expect(runtime.record.calls.slice(-3)).toEqual([
      ['lock', 'screen-lock'],
      ['open-accepted', 'sess_1', 'd'.repeat(64)],
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
  it('a link that floods it with requests it has not answered yet', async () => {
    const { runtime, port } = await startCertifiedRuntime();
    const client = await openOwnerLink(await connect(port), owner);
    const held = Array.from({ length: 65 }, () =>
      client.question('held').catch((error: unknown) => error),
    );
    for (const outcome of await Promise.all(held))
      expect(outcome).toBeInstanceOf(OwnerLinkClosedError);
    await client.closed;
    expect(runtime.record.grantedKeys).toEqual([]);
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
    return await Promise.race([opening.then(() => 'opened', (error: unknown) => error), never]);
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
