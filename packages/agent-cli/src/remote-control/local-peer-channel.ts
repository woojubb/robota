/**
 * PEER-005 (issue #1863, stage 3) — the carrier that moves one peer message between two local sessions.
 *
 * Everything ABOVE this was already built and waiting for a carrier: the message and ack contracts
 * (`agent-interface-transport`), ordering, duplicates and ack issuance (`agent-transport`'s
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
 * ## Which session a message is from
 *
 * The directory says the sender is this user; it does not say which session. A message names its
 * sender, and that name decides where an answer goes, so it is confirmed rather than believed: the
 * receiver asks the named session, at its own socket, whether it has exactly this message in flight
 * to this receiver, and refuses the message when it does not. A session answers only for what it is
 * sending at that moment, so a message it sent earlier cannot be presented again under its name.
 * What the receiver is handed is the confirmed sender, apart from the message, so nothing downstream
 * has to read the name out of what the sender wrote.
 *
 * ## One message per connection
 *
 * Connect, write one JSON line, read one line, close. A persistent multiplexed stream would need
 * framing, backpressure and a reconnect policy — three places to be wrong — to carry a control
 * message that is sent when a person types. Ordering across messages is the ledger's `sequence`,
 * never the socket's.
 */

import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import path from 'node:path';

import { admitLocalPeerSocket } from '@robota-sdk/agent-remote-pairing/local';

import {
  receiveFileOverChannel,
  sendFileOverChannel,
  type IFileSource,
  type IReceiveFileOptions,
  type TFileReceiveOutcome,
  type TFileSendOutcome,
} from '@robota-sdk/agent-transport/node';

import type {
  IFileFrameChannel,
  IFileOffer,
  IPeerMessage,
  IPeerMessageAck,
} from '@robota-sdk/agent-interface-session-mobility';

const LINE_TIMEOUT_MS = 10_000;
/** Longer than any message or file frame; a longer line is a peer that does not speak this protocol. */
const MAX_LINE_CHARS = 1024 * 1024;
const CLOSE_GRACE_MS = 1_000;
/** Shorter than the sender's wait for an ack, so a refusal still reaches a sender that is waiting. */
const CONFIRM_TIMEOUT_MS = 5_000;

/** The session a message was confirmed to come from. */
export interface IPeerSender {
  readonly sessionId: string;
}

/** Asks a session whether it has this message in flight to the asker. */
interface IConfirmRequest {
  readonly confirm: { readonly id: string; readonly to: string; readonly digest: string };
}

/** Everything a receiver acts on, so a confirmed id cannot vouch for different content. */
function messageDigest(message: IPeerMessage): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        message.id,
        message.sequence,
        message.text,
        message.sentAt,
        message.inReplyTo ?? null,
      ]),
    )
    .digest('hex');
}

/** What a file offer is confirmed by: its sender vouches for exactly this name, size and hash. */
function offerDigest(offer: IFileOffer): string {
  return createHash('sha256')
    .update(JSON.stringify(['file', offer.transferId, offer.name, offer.size, offer.sha256]))
    .digest('hex');
}

/** In-flight ids of offers, apart from those of messages, so neither can vouch for the other. */
function offerKey(offer: IFileOffer): string {
  return `file:${offer.transferId}`;
}

/**
 * The first line of a connection that carries a file: who claims to send it, and the offer frame the
 * file carrier then reads as its first.
 */
interface IFileOpening {
  readonly file: { readonly from: string; readonly offer: string };
}

function isFileOpening(frame: unknown): frame is IFileOpening {
  if (typeof frame !== 'object' || frame === null || !('file' in frame)) return false;
  const { file } = frame as { file: unknown };
  return (
    typeof file === 'object' &&
    file !== null &&
    typeof (file as Record<string, unknown>)['from'] === 'string' &&
    typeof (file as Record<string, unknown>)['offer'] === 'string'
  );
}

/**
 * The first line of a connection that carries a hand-off: who claims to push it, an id its claimant
 * confirms, and the first hand-off frame, which the receiver then reads as its first.
 */
interface IHandoffOpening {
  readonly handoff: { readonly from: string; readonly id: string; readonly first: string };
}

function isHandoffOpening(frame: unknown): frame is IHandoffOpening {
  if (typeof frame !== 'object' || frame === null || !('handoff' in frame)) return false;
  const { handoff } = frame as { handoff: unknown };
  if (typeof handoff !== 'object' || handoff === null) return false;
  const fields = handoff as Record<string, unknown>;
  return (
    typeof fields['from'] === 'string' &&
    typeof fields['id'] === 'string' &&
    typeof fields['first'] === 'string'
  );
}

/** What a hand-off opening is confirmed by: its claimant vouches for this id and this first frame. */
function handoffDigest(id: string, first: string): string {
  return createHash('sha256')
    .update(JSON.stringify(['handoff', id, first]))
    .digest('hex');
}

/** The offer inside an opening, read only far enough to confirm it; the carrier decodes it again. */
function parseOffer(text: string): IFileOffer | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const { transferId, name, size, sha256 } = value;
    if (value['t'] !== 'file-offer') return undefined;
    if (typeof transferId !== 'string' || typeof name !== 'string') return undefined;
    if (typeof size !== 'number' || typeof sha256 !== 'string') return undefined;
    return { transferId, name, size, sha256 };
  } catch {
    return undefined;
  }
}

function isConfirmRequest(frame: unknown): frame is IConfirmRequest {
  if (typeof frame !== 'object' || frame === null || !('confirm' in frame)) return false;
  const { confirm } = frame as { confirm: unknown };
  return (
    typeof confirm === 'object' &&
    confirm !== null &&
    typeof (confirm as Record<string, unknown>)['id'] === 'string' &&
    typeof (confirm as Record<string, unknown>)['to'] === 'string' &&
    typeof (confirm as Record<string, unknown>)['digest'] === 'string'
  );
}

/**
 * Where a session listens. Derived from the session id, so a sender needs no second lookup.
 *
 * The id is a caller-supplied string, so it is joined and then CHECKED: a traversal segment
 * (`../escape`) resolves outside the guarded directory, and a socket there proves nothing about
 * who is listening. The refusal happens here, before any connection is opened, because connecting
 * first would already have handed the message over.
 */
export function peerSocketPath(guardedDirectory: string, sessionId: string): string {
  const socketPath = path.resolve(guardedDirectory, `${sessionId}.sock`);
  const root = path.resolve(guardedDirectory);
  if (socketPath !== root && !socketPath.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `local peer channel: session id ${JSON.stringify(sessionId)} resolves to ${socketPath}, ` +
        `which is outside the guarded directory ${root}. A socket there is not admitted.`,
    );
  }
  return socketPath;
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
    const onData = (chunk: string): void => {
      buffered += chunk;
      const at = buffered.indexOf('\n');
      if (at !== -1) finish(() => resolve(buffered.slice(0, at)));
      else if (buffered.length > MAX_LINE_CHARS) {
        finish(() => {
          socket.destroy();
          reject(new Error('local peer channel: a line was too long'));
        });
      }
    };
    const onError = (error: Error): void => finish(() => reject(error));
    const onEnd = (): void =>
      finish(() => reject(new Error('local peer channel: the peer closed before sending a line')));
    // The reader is detached once the line is read: a connection that carries a file goes on to be
    // read by the file carrier, and must not keep feeding this buffer. The error listener stays: a
    // peer that leaves while its answer is being written must not become an uncaught error here.
    function finish(run: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('end', onEnd);
      run();
    }
    socket.setEncoding('utf8');
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
  });
}

/**
 * A connection as a file frame channel: one frame per line. The file carrier paces the sender, so
 * nothing here buffers more than a window of chunks; a line longer than any frame ends the channel.
 */
export function socketFrameChannel(socket: Socket): IFileFrameChannel {
  const frames = new Set<(frame: string) => void>();
  const closes = new Set<() => void>();
  let buffered = '';
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    for (const handler of closes) handler();
    closes.clear();
    frames.clear();
  };
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    for (let at = buffered.indexOf('\n'); at !== -1; at = buffered.indexOf('\n')) {
      const line = buffered.slice(0, at);
      buffered = buffered.slice(at + 1);
      for (const handler of frames) handler(line);
    }
    if (buffered.length > MAX_LINE_CHARS) socket.destroy();
  });
  socket.on('close', close);
  socket.on('error', () => socket.destroy());
  return {
    send: (frame) => {
      if (closed || socket.destroyed) throw new Error('local peer channel: the connection closed');
      socket.write(`${frame}\n`);
    },
    onFrame: (handler) => {
      frames.add(handler);
      return () => frames.delete(handler);
    },
    onClose: (handler) => {
      if (closed) {
        queueMicrotask(handler);
        return () => undefined;
      }
      closes.add(handler);
      return () => closes.delete(handler);
    },
    close: () => {
      socket.end();
      // A peer that does not close its half is not waited on.
      setTimeout(() => socket.destroy(), CLOSE_GRACE_MS).unref();
    },
  };
}

export interface IPeerListenerOptions {
  readonly guardedDirectory: string;
  readonly sessionId: string;
  /** Handles one message from a confirmed sender and returns the ack to send back. */
  readonly onMessage: (
    message: IPeerMessage,
    sender: IPeerSender,
  ) => Promise<IPeerMessageAck> | IPeerMessageAck;
  /**
   * Decides on and stores a file from a confirmed sender. Absent: every file is refused. Called with
   * the carrier's receive options minus the channel, which this listener owns.
   */
  readonly onFile?: (sender: IPeerSender) => Omit<IReceiveFileOptions, 'channel'> | undefined;
  /** Told how each received file ended. */
  readonly onFileOutcome?: (outcome: TFileReceiveOutcome, sender: IPeerSender) => void;
  /**
   * Takes the channel of a hand-off a confirmed sender opened; its first frame is the sender's first.
   * Absent: every hand-off is refused.
   */
  readonly onHandoff?: (sender: IPeerSender, channel: IFileFrameChannel) => void;
  readonly expectedUid?: number;
}

export interface IPeerListener {
  readonly socketPath: string;
  /**
   * Send one message as this session and return the ack the receiver issued. The message must name
   * this session as its origin: this listener is what confirms it to the receiver.
   */
  send(targetSessionId: string, message: IPeerMessage): Promise<IPeerMessageAck>;
  /**
   * Send one file as this session, on a connection of its own. Resolves when the receiver kept it,
   * or with why it did not.
   */
  sendFile(
    targetSessionId: string,
    offer: IFileOffer,
    source: IFileSource,
  ): Promise<TFileSendOutcome>;
  /**
   * Open a channel to push a hand-off to another session. Its first frame travels in the opening,
   * which the receiver confirms with this session before it reads anything.
   */
  openHandoffChannel(targetSessionId: string): Promise<IFileFrameChannel>;
  close(): Promise<void>;
}

/** Ask `claimed` at its own socket whether it is sending exactly `message` to `receiver`. */
async function confirmSender(
  guardedDirectory: string,
  claimed: string,
  receiver: string,
  sending: { readonly id: string; readonly digest: string },
  expectedUid: number,
): Promise<boolean> {
  try {
    const socketPath = peerSocketPath(guardedDirectory, claimed);
    admitOrThrow(socketPath, expectedUid);
    const socket = await new Promise<Socket>((resolve, reject) => {
      const connection = createConnection(socketPath);
      connection.once('connect', () => resolve(connection));
      connection.once('error', reject);
    });
    const request: IConfirmRequest = {
      confirm: { id: sending.id, to: receiver, digest: sending.digest },
    };
    socket.write(`${JSON.stringify(request)}\n`);
    const line = await readLine(socket, CONFIRM_TIMEOUT_MS);
    socket.end();
    const answer = JSON.parse(line) as { confirmed?: unknown };
    return answer.confirmed === true;
  } catch {
    // allow-fallback: a sender that cannot be reached, or answers anything else, is not confirmed.
    return false;
  }
}

/**
 * Listen for peer messages on this session's socket.
 *
 * A message that cannot be read is answered with a `refused` ack rather than dropped. The sender is
 * waiting, and silence would be indistinguishable from a peer that died mid-send — which is the
 * distinction the delivery states exist to make.
 */
export async function listenForPeerMessages(options: IPeerListenerOptions): Promise<IPeerListener> {
  const expectedUid = options.expectedUid ?? process.getuid?.() ?? 0;
  const socketPath = peerSocketPath(options.guardedDirectory, options.sessionId);
  admitOrThrow(socketPath, expectedUid);
  // A socket left by a crashed session blocks the bind. Removing it is safe precisely BECAUSE the
  // directory is ours: nothing else could have put it there.
  rmSync(socketPath, { force: true });

  /** What this session is sending right now, by id: the receiver and the digest it will ask about. */
  const inFlight = new Map<string, { readonly to: string; readonly digest: string }>();

  const receive = async (message: IPeerMessage): Promise<IPeerMessageAck> => {
    const claimed: unknown = message.origin?.sessionId;
    if (typeof claimed !== 'string') {
      throw new Error('local peer channel: the message names no sender session.');
    }
    const confirmed = await confirmSender(
      options.guardedDirectory,
      claimed,
      options.sessionId,
      { id: message.id, digest: messageDigest(message) },
      expectedUid,
    );
    if (!confirmed) {
      return {
        id: message.id,
        sequence: message.sequence,
        state: 'refused',
        reason:
          `session ${JSON.stringify(claimed)} did not confirm sending this message, so it is not ` +
          'taken as coming from that session.',
      };
    }
    return options.onMessage(message, { sessionId: claimed });
  };

  /**
   * A connection that opened with a file: confirm who sends it, exactly as for a message, then let
   * the file carrier read the rest. The offer it reads first is the one the sender confirmed.
   */
  const receiveFile = async (socket: Socket, opening: IFileOpening): Promise<void> => {
    const channel = socketFrameChannel(socket);
    const offer = parseOffer(opening.file.offer);
    const refuse = (reason: string): void => {
      channel.send(JSON.stringify({ t: 'file-refuse', reason: 'declined', detail: reason }));
      channel.close();
    };
    if (offer === undefined) {
      channel.send(JSON.stringify({ t: 'file-refuse', reason: 'protocol' }));
      channel.close();
      return;
    }
    const claimed = opening.file.from;
    const confirmed = await confirmSender(
      options.guardedDirectory,
      claimed,
      options.sessionId,
      { id: offerKey(offer), digest: offerDigest(offer) },
      expectedUid,
    );
    if (!confirmed) {
      refuse(`session ${JSON.stringify(claimed)} did not confirm sending this file.`);
      return;
    }
    const sender: IPeerSender = { sessionId: claimed };
    const receiving = options.onFile?.(sender);
    if (receiving === undefined) {
      refuse('this session does not take files.');
      return;
    }
    // The carrier reads the offer as its first frame; it arrives now, after the carrier listens.
    const first = opening.file.offer;
    const outcome = await receiveFileOverChannel({
      ...receiving,
      channel: {
        ...channel,
        onFrame: (handler) => {
          const stop = channel.onFrame(handler);
          queueMicrotask(() => handler(first));
          return stop;
        },
      },
    });
    options.onFileOutcome?.(outcome, sender);
  };

  /** A connection that opened with a hand-off: confirm who pushes it, then hand the channel over. */
  const receiveHandoff = async (socket: Socket, opening: IHandoffOpening): Promise<void> => {
    const channel = socketFrameChannel(socket);
    const refuse = (reason: 'unauthorized' | 'declined', detail: string): void => {
      channel.send(JSON.stringify({ t: 'handoff-refuse', reason, detail }));
      channel.close();
    };
    const { from, id, first } = opening.handoff;
    const confirmed = await confirmSender(
      options.guardedDirectory,
      from,
      options.sessionId,
      { id: `handoff:${id}`, digest: handoffDigest(id, first) },
      expectedUid,
    );
    if (!confirmed) {
      refuse('unauthorized', `session ${JSON.stringify(from)} did not confirm this hand-off.`);
      return;
    }
    if (options.onHandoff === undefined) {
      refuse('declined', 'this session does not take hand-offs.');
      return;
    }
    // The receiver reads the first frame as its first; it arrives now, after the receiver listens.
    options.onHandoff(
      { sessionId: from },
      {
        ...channel,
        onFrame: (handler) => {
          const stop = channel.onFrame(handler);
          queueMicrotask(() => handler(first));
          return stop;
        },
      },
    );
  };

  const server: Server = createServer((socket) => {
    void (async () => {
      try {
        const frame: unknown = JSON.parse(await readLine(socket, LINE_TIMEOUT_MS));
        if (isFileOpening(frame)) {
          await receiveFile(socket, frame);
          return;
        }
        if (isHandoffOpening(frame)) {
          await receiveHandoff(socket, frame);
          return;
        }
        if (isConfirmRequest(frame)) {
          const sending = inFlight.get(frame.confirm.id);
          const confirmed =
            sending !== undefined &&
            sending.to === frame.confirm.to &&
            sending.digest === frame.confirm.digest;
          socket.end(`${JSON.stringify({ confirmed })}\n`);
          return;
        }
        socket.end(`${JSON.stringify(await receive(frame as IPeerMessage))}\n`);
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
    send: async (targetSessionId: string, message: IPeerMessage): Promise<IPeerMessageAck> => {
      if (message.origin.sessionId !== options.sessionId) {
        throw new Error(
          `local peer channel: this listener sends as session ${options.sessionId}, not as ` +
            `${JSON.stringify(message.origin.sessionId)}.`,
        );
      }
      if (inFlight.has(message.id)) {
        throw new Error(`local peer channel: message ${message.id} is already being sent.`);
      }
      inFlight.set(message.id, { to: targetSessionId, digest: messageDigest(message) });
      try {
        return await sendPeerMessage({
          guardedDirectory: options.guardedDirectory,
          targetSessionId,
          message,
          expectedUid,
        });
      } finally {
        inFlight.delete(message.id);
      }
    },
    sendFile: async (
      targetSessionId: string,
      offer: IFileOffer,
      source: IFileSource,
    ): Promise<TFileSendOutcome> => {
      const key = offerKey(offer);
      if (inFlight.has(key)) {
        throw new Error(`local peer channel: file ${offer.transferId} is already being sent.`);
      }
      const socketPath = peerSocketPath(options.guardedDirectory, targetSessionId);
      admitOrThrow(socketPath, expectedUid);
      inFlight.set(key, { to: targetSessionId, digest: offerDigest(offer) });
      try {
        const socket = await new Promise<Socket>((resolve, reject) => {
          const connection = createConnection(socketPath);
          connection.once('connect', () => resolve(connection));
          connection.once('error', reject);
        });
        const channel = socketFrameChannel(socket);
        // The opening carries the offer for the receiver to confirm; the carrier's own offer frame
        // is then consumed from it rather than sent a second time.
        let opened = false;
        return await sendFileOverChannel({
          offer,
          source,
          channel: {
            ...channel,
            send: (frame) => {
              if (!opened) {
                opened = true;
                channel.send(
                  JSON.stringify({
                    file: { from: options.sessionId, offer: frame },
                  } satisfies IFileOpening),
                );
                return;
              }
              channel.send(frame);
            },
          },
        });
      } finally {
        inFlight.delete(key);
      }
    },
    openHandoffChannel: async (targetSessionId: string): Promise<IFileFrameChannel> => {
      const socketPath = peerSocketPath(options.guardedDirectory, targetSessionId);
      admitOrThrow(socketPath, expectedUid);
      const socket = await new Promise<Socket>((resolve, reject) => {
        const connection = createConnection(socketPath);
        connection.once('connect', () => resolve(connection));
        connection.once('error', reject);
      });
      const channel = socketFrameChannel(socket);
      const id = randomUUID();
      const key = `handoff:${id}`;
      // Vouched for while the channel is open: the receiver asks once it has read the opening.
      channel.onClose(() => inFlight.delete(key));
      let opened = false;
      return {
        ...channel,
        send: (frame) => {
          if (opened) {
            channel.send(frame);
            return;
          }
          opened = true;
          inFlight.set(key, { to: targetSessionId, digest: handoffDigest(id, frame) });
          channel.send(
            JSON.stringify({
              handoff: { from: options.sessionId, id, first: frame },
            } satisfies IHandoffOpening),
          );
        },
      };
    },
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
 * Write one message and return the ack the receiver issued. Nothing here confirms the sender, so a
 * receiver refuses what this sends unless a listener's `send` is behind it.
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
