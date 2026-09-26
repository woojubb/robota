/**
 * The attaching terminal's end of the session protocol over a supervised session's control socket:
 * newline-delimited JSON frames, decoded with the same runtime decoders every client uses.
 */

import { decodeFrame, decodeServerMessage } from '@robota-sdk/agent-transport';

import { openSupervisedAttachSocket } from './supervised-session-control.js';

import type { Socket } from 'node:net';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

/**
 * Largest single frame accepted from the session. A conversation snapshot is one frame, so this is
 * generous; it exists so a broken peer cannot grow one line without bound.
 */
const MAX_SERVER_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * Frames held for a subscriber that has not arrived yet. The view subscribes as it mounts, so a
 * backlog this long means nothing is reading; the connection is closed rather than grown.
 */
export const MAX_EARLY_FRAMES = 1024;

export interface ISupervisedAttachConnection {
  readonly driverId: string;
  send(message: TClientMessage): void;
  /** Frames that arrived before the first subscriber are delivered to it, in order. */
  subscribe(listener: (message: TServerMessage) => void): () => void;
  onClose(listener: () => void): () => void;
  /** Leave the session. Nothing is sent to it: the session keeps running and its turn continues. */
  detach(): void;
}

export async function openSupervisedAttach(
  id: string,
  mode: 'drive' | 'observe',
  root?: string,
  expectedGeneration?: string,
): Promise<ISupervisedAttachConnection> {
  const { socket, driverId, rest } = await openSupervisedAttachSocket(id, mode, root, expectedGeneration);
  return createSupervisedAttachConnection(socket, driverId, rest);
}

/** The protocol over an admitted attach socket; `rest` is what arrived with the handshake reply. */
export function createSupervisedAttachConnection(
  socket: Socket,
  driverId: string,
  rest: string,
): ISupervisedAttachConnection {
  const listeners = new Set<(message: TServerMessage) => void>();
  const early: TServerMessage[] = [];
  const dispatch = (message: TServerMessage): void => {
    if (listeners.size === 0) {
      if (early.length >= MAX_EARLY_FRAMES) {
        socket.destroy();
        return;
      }
      early.push(message);
      return;
    }
    for (const listener of [...listeners]) listener(message);
  };
  let buffered = rest;
  const drain = (): void => {
    let end = buffered.indexOf('\n');
    while (end !== -1 && !socket.destroyed) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      if (line.trim() !== '') {
        const decoded = decodeFrame(line, decodeServerMessage);
        // A frame this client cannot read is skipped; the next snapshot request recovers the state.
        if (decoded.ok) dispatch(decoded.message);
      }
      end = buffered.indexOf('\n');
    }
    if (Buffer.byteLength(buffered, 'utf8') > MAX_SERVER_FRAME_BYTES) socket.destroy();
  };
  socket.on('data', (chunk: string) => {
    buffered += chunk;
    drain();
  });
  socket.on('error', () => socket.destroy());
  drain();
  socket.resume();
  return {
    driverId,
    send: (message) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) for (const message of early.splice(0)) listener(message);
      return () => { listeners.delete(listener); };
    },
    onClose: (listener) => {
      if (socket.destroyed) {
        queueMicrotask(listener);
        return () => undefined;
      }
      socket.once('close', listener);
      return () => { socket.off('close', listener); };
    },
    detach: () => { socket.destroy(); },
  };
}
