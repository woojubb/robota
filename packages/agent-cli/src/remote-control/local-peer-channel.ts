/**
 * PEER-005 (issue #1863, stage 3) — the carrier that moves one peer message between two local sessions.
 *
 * Everything ABOVE this was already built and waiting for a carrier: the message and ack contracts
 * (`agent-interface-transport`), ordering, duplicates and ack issuance (`agent-transport-protocol`'s
 * ledger), and the session-side ingress (`agent-framework`). This file adds bytes on a wire and
 * nothing else. It must not re-decide any of those, and the one easiest to re-decide by accident is
 * duplicates — the ledger answers a repeated id with the ORIGINAL verdict, and this carries that
 * back rather than forming its own opinion.
 *
 * ## Why a unix socket inside the guarded directory
 *
 * The claim `same-user-same-host` rests on the DIRECTORY's ownership and mode, exactly as it does
 * for the rendezvous. A socket inside a 0700 directory owned by this uid can be connected to only by
 * that uid — or by root, which already controls the process. So admission is established once, at
 * bind time, by `admitLocalPeerSocket`; it is never re-derived per connection from anything a peer
 * chooses.
 *
 * Node's `net` exposes no `SO_PEERCRED`, so there is no per-connection credential to read. Saying
 * that plainly is part of the design: the guarantee is the directory's, and a comment claiming
 * per-connection verification would assert a property the code does not have.
 *
 * ## One message per connection
 *
 * Connect, write one JSON line, read one line, close. A persistent multiplexed stream would need
 * framing, backpressure and a reconnect policy — three places to be wrong — to carry a control
 * message that is sent when a person types. Ordering across messages is the ledger's `sequence`,
 * never the socket's.
 */

import { rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';

import { admitLocalPeerSocket } from '@robota-sdk/agent-remote-pairing/local';

import type { IPeerMessage, IPeerMessageAck } from '@robota-sdk/agent-interface-transport';

const LINE_TIMEOUT_MS = 10_000;

/** Where a session listens. Derived from the session id, so a sender needs no second lookup. */
export function peerSocketPath(guardedDirectory: string, sessionId: string): string {
  return path.join(guardedDirectory, `${sessionId}.sock`);
}

/** A refusal carries its reason. There is no admitted-looking result without evidence. */
function admitOrThrow(socketPath: string, expectedUid: number): void {
  const admission = admitLocalPeerSocket(socketPath, { expectedUid });
  if (!admission.admitted) {
    throw new Error(
      `local peer channel: ${socketPath} was not admitted, so a message arriving there would prove ` +
        `nothing about its sender. ${admission.reason ?? 'No reason was given.'}`,
    );
  }
}

/**
 * Read one newline-terminated JSON line, or reject.
 *
 * A peer that closed without sending a line is a FAILURE, not an empty message. Resolving `''` there
 * would hand the caller a parse error one layer away from the fact that nothing ever arrived.
 */
function readLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = '';
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => {
        socket.destroy();
        reject(new Error(`local peer channel: no line within ${timeoutMs}ms`));
      });
    }, timeoutMs);
    function finish(run: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run();
    }
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const at = buffered.indexOf('\n');
      if (at !== -1) finish(() => resolve(buffered.slice(0, at)));
    });
    socket.on('error', (error) => finish(() => reject(error)));
    socket.on('end', () =>
      finish(() => reject(new Error('local peer channel: the peer closed before sending a line'))),
    );
  });
}

export interface IPeerListenerOptions {
  readonly guardedDirectory: string;
  readonly sessionId: string;
  /** Handles one message and returns the ack to send back. */
  readonly onMessage: (message: IPeerMessage) => Promise<IPeerMessageAck> | IPeerMessageAck;
  readonly expectedUid?: number;
}

export interface IPeerListener {
  readonly socketPath: string;
  close(): Promise<void>;
}

/**
 * Listen for peer messages on this session's socket.
 *
 * A message that cannot be read is answered with a `refused` ack rather than dropped. The sender is
 * waiting, and silence would be indistinguishable from a peer that died mid-send — which is the
 * distinction the delivery states exist to make.
 */
export async function listenForPeerMessages(options: IPeerListenerOptions): Promise<IPeerListener> {
  const socketPath = peerSocketPath(options.guardedDirectory, options.sessionId);
  admitOrThrow(socketPath, options.expectedUid ?? process.getuid?.() ?? 0);
  // A socket left by a crashed session blocks the bind. Removing it is safe precisely BECAUSE the
  // directory is ours: nothing else could have put it there.
  rmSync(socketPath, { force: true });

  const server: Server = createServer((socket) => {
    void (async () => {
      try {
        const message = JSON.parse(await readLine(socket, LINE_TIMEOUT_MS)) as IPeerMessage;
        socket.end(`${JSON.stringify(await options.onMessage(message))}\n`);
      } catch (error) {
        const refusal: IPeerMessageAck = {
          id: '',
          sequence: 0,
          state: 'refused',
          reason: error instanceof Error ? error.message : String(error),
        };
        socket.end(`${JSON.stringify(refusal)}\n`);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });

  return {
    socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(socketPath, { force: true });
          resolve();
        });
      }),
  };
}

export interface IPeerSendOptions {
  readonly guardedDirectory: string;
  readonly targetSessionId: string;
  readonly message: IPeerMessage;
  readonly expectedUid?: number;
}

/**
 * Send one message and return the ack the receiver issued.
 *
 * The TARGET socket is admitted BEFORE connecting, which is the reason `admitLocalPeerSocket` takes
 * a path rather than a directory: a path resolving outside the guarded directory carries none of
 * that directory's guarantees, and connecting first would already have handed the text over.
 */
export async function sendPeerMessage(options: IPeerSendOptions): Promise<IPeerMessageAck> {
  const socketPath = peerSocketPath(options.guardedDirectory, options.targetSessionId);
  admitOrThrow(socketPath, options.expectedUid ?? process.getuid?.() ?? 0);

  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection(socketPath);
    connection.once('connect', () => resolve(connection));
    connection.once('error', reject);
  });

  socket.write(`${JSON.stringify(options.message)}\n`);
  const line = await readLine(socket, LINE_TIMEOUT_MS);
  socket.end();
  return JSON.parse(line) as IPeerMessageAck;
}
