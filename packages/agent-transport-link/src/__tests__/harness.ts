/**
 * Real loopback sockets for the carrier tests, and the pieces around them a product supplies: a
 * control endpoint that routes the link request line to `serveRuntimeLink`, a recording runtime
 * desk, and raw clients and servers that speak the framing by hand, so a test can send what no
 * well-behaved end would.
 */
import { Buffer } from 'node:buffer';
import { createServer, connect as connectSocket, type Server, type Socket } from 'node:net';

import {
  createKeyring,
  openOwnerHandover,
  type ILinkBinding,
  type IOwnerHandover,
  type IReadKeys,
  type IRuntimeIdentity,
} from '@robota-sdk/agent-keyring';

import {
  OwnerRequestRefusedError,
  isLinkRequest,
  serveRuntimeLink,
  type IAdmittedRuntimeLink,
  type IOwnerControlRequest,
  type IRuntimeLinkPorts,
  type TRequestedLockReason,
} from '../index.js';

export const BINDING: ILinkBinding = {
  runtimeId: '6f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f',
  generation: 'AAECAwQFBgcICQoLDA0ODw',
};

export interface IListening {
  readonly port: number;
  readonly server: Server;
  close(): Promise<void>;
}

/** A loopback server; every connection it accepted is destroyed on close. */
export async function listen(onConnection: (socket: Socket) => void): Promise<IListening> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    onConnection(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('No port was bound.');
  return {
    port: address.port,
    server,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export async function connect(port: number): Promise<Socket> {
  const socket = connectSocket({ host: '127.0.0.1', port });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  return socket;
}

/** Reads the request line as raw bytes, the way a control endpoint routes it: the rest stays bytes. */
export function readRequestLine(
  socket: Socket,
): Promise<{ line: string; rest: Buffer } | undefined> {
  return new Promise((resolve) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf(0x0a);
      if (end === -1) {
        if (buffered.length > 4096) finish(undefined);
        return;
      }
      finish({
        line: buffered.subarray(0, end).toString('utf8'),
        rest: buffered.subarray(end + 1),
      });
    };
    const finish = (value: { line: string; rest: Buffer } | undefined): void => {
      socket.off('data', onData);
      socket.pause();
      resolve(value);
    };
    socket.on('data', onData);
  });
}

/** A control endpoint that serves only owner links. */
export function controlEndpoint(
  identity: IRuntimeIdentity,
  admit: (link: IAdmittedRuntimeLink) => IRuntimeLinkPorts,
  options: { readonly handshakeTimeoutMs?: number } = {},
): (socket: Socket) => void {
  return (socket) => {
    void readRequestLine(socket).then((request) => {
      let value: unknown;
      try {
        value = request === undefined ? undefined : JSON.parse(request.line);
      } catch {
        value = undefined;
      }
      if (request === undefined || !isLinkRequest(value)) {
        socket.destroy();
        return;
      }
      serveRuntimeLink(socket, {
        identity,
        binding: BINDING,
        rest: request.rest,
        admit,
        ...(options.handshakeTimeoutMs !== undefined
          ? { handshakeTimeoutMs: options.handshakeTimeoutMs }
          : {}),
      });
    });
  };
}

/** A runtime's answers that record what each link asked; spawner links alone install a root. */
export function recordingRuntime(identity: IRuntimeIdentity) {
  const record = {
    links: [] as IAdmittedRuntimeLink[],
    calls: [] as unknown[],
    sessionData: [] as string[],
    grantedKeys: [] as IReadKeys[],
    closed: 0,
  };
  const admit = (link: IAdmittedRuntimeLink): IRuntimeLinkPorts => {
    record.links.push(link);
    return {
      desk: {
        custody: () => ({ unlocked: record.grantedKeys.length > 0, certified: identity.certified }),
        installTrustRoot: (root) => {
          if (link.standing !== 'spawner') {
            throw new OwnerRequestRefusedError(
              'not-allowed',
              'Only the spawner installs a trust root.',
            );
          }
          identity.installTrustRoot(root, link.binding);
          record.calls.push('install-trust-root');
        },
        unlock: async (keys) => {
          record.grantedKeys.push(keys);
          record.calls.push('unlock');
          return 'verified' as const;
        },
        lock: (reason: TRequestedLockReason) => {
          record.calls.push(['lock', reason]);
        },
        control: (request: IOwnerControlRequest) => {
          record.calls.push(['control', request.command]);
          return { status: 'renamed', name: request.fields['name'] ?? null };
        },
        closed: () => {
          record.closed += 1;
        },
      },
      sessions: {
        // `held` is never answered, so a test can close the link while a request waits.
        question: (sessionId) =>
          sessionId === 'held'
            ? new Promise<never>(() => undefined)
            : Promise.resolve({
                kind: 'accept',
                digest: 'd'.repeat(64),
                notice: 'This session was not verified as yours.',
                question: `Resume ${sessionId} and mark it as yours?`,
              } as const),
        openAccepted: (sessionId, digest) => {
          record.calls.push(['open-accepted', sessionId, digest]);
        },
      },
      session: {
        receive: (data) => {
          record.sessionData.push(data);
        },
      },
    };
  };
  return { record, admit };
}

/** The owner's keyring and a second one another program made. */
export async function keyrings(): Promise<{
  owner: IOwnerHandover;
  stranger: IOwnerHandover;
  sealingPublicKey: Uint8Array;
}> {
  const mine = await createKeyring({ passphrase: 'the owner passphrase for these tests' });
  const theirs = await createKeyring({ passphrase: 'another program made this keyring' });
  const owner = await openOwnerHandover(mine.keyring, {
    type: 'recoveryKey',
    recoveryKey: mine.recoveryKey,
  });
  const stranger = await openOwnerHandover(theirs.keyring, {
    type: 'recoveryKey',
    recoveryKey: theirs.recoveryKey,
  });
  const sealingPublicKey = Uint8Array.from(mine.unlocked.sealing.publicKey);
  mine.unlocked.lock();
  theirs.unlocked.lock();
  return { owner, stranger, sealingPublicKey };
}

/** One length-prefixed frame, written by hand. */
export function frame(payload: Uint8Array): Buffer {
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(payload.length);
  return Buffer.concat([prefix, payload]);
}

/** Reads length-prefixed frames off a socket by hand, and everything else it receives. */
export function frameReader(socket: Socket) {
  let buffered = Buffer.alloc(0);
  let received = Buffer.alloc(0);
  const waiters: Array<() => void> = [];
  let ended = false;
  const wake = (): void => {
    for (const waiter of waiters.splice(0)) waiter();
  };
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    received = Buffer.concat([received, chunk]);
    wake();
  });
  socket.on('close', () => {
    ended = true;
    wake();
  });
  socket.resume();
  return {
    /** The next frame, or `undefined` once the socket closed without one. */
    async next(): Promise<Buffer | undefined> {
      for (;;) {
        if (buffered.length >= 4) {
          const length = buffered.readUInt32BE(0);
          if (buffered.length >= 4 + length) {
            const payload = buffered.subarray(4, 4 + length);
            buffered = buffered.subarray(4 + length);
            return payload;
          }
        }
        if (ended) return undefined;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
    },
    /** Every byte the socket received so far. */
    received: () => received,
    closed: () => ended,
  };
}

/** Resolves once `condition` holds, polling on the event loop (never a fixed sleep). */
export async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('The condition did not hold in time.');
    await new Promise((resolve) => setImmediate(resolve));
  }
}
