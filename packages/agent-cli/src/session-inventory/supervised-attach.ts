/**
 * The session side of attach: a terminal on the same host drives or observes a supervised session
 * over that session's guarded control socket.
 *
 * The control endpoint has already proven the caller is this OS user (the socket lives in a 0700
 * directory) and that it names this process start (the generation). This module decides the role,
 * assigns the driver id, and carries the ordinary session protocol, so attach reuses the co-drive,
 * prompt and observe rules every other surface follows instead of adding its own.
 *
 * A supervised session has no terminal, so nobody here can be asked. The attaching terminal asked its
 * own human before connecting; the target cannot verify that answer, and the one-shot approver below
 * only lets that already-given answer through for the requested role on this one connection. It is
 * never an approver for anything else: an attached terminal does not admit other devices.
 */

import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';
import {
  ATTACHED_SURFACE_MAX_PENDING_BYTES,
  MAX_INBOUND_FRAME_BYTES,
  createOutboundDelivery,
  createSessionMessageHandler,
} from '@robota-sdk/agent-transport';

import type { Socket } from 'node:net';
import type { ISessionDirectory } from '@robota-sdk/agent-interface-session';
import type {
  ICapabilityApprovalRequest,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';
import type { IProtocolSession, TSessionSurfaceRole } from '@robota-sdk/agent-transport';

/** Attached terminals one session serves at once. */
export const MAX_ATTACHED_SURFACES = 4;
const ATTACH_PROTOCOL = 1;

export type TAttachRefusal = 'unsupported-attach' | 'attach-limit' | 'declined';

/**
 * Approve exactly one question: the requested role, for this connection. Every other question — a
 * second one, another role, any request-scoped capability — is a no.
 */
export function createHandshakeApprover(mode: TSessionSurfaceRole): IOperatorApprover {
  let answered = false;
  return {
    approve: (request: ICapabilityApprovalRequest): Promise<boolean> => {
      if (answered || request.capability !== mode || request.scope !== 'connection') {
        return Promise.resolve(false);
      }
      answered = true;
      return Promise.resolve(true);
    },
  };
}

function isAttachMode(value: unknown): value is TSessionSurfaceRole {
  return value === 'drive' || value === 'observe';
}

export interface ISupervisedAttachResponder {
  /** Refuse the handshake and end the connection. */
  refuse(reason: TAttachRefusal): void;
  /** Accept the handshake; the connection stays open for the session protocol. */
  accept(driverId: string): void;
}

export interface ISupervisedAttachCarrier {
  /**
   * Admit one connection whose id and generation the control endpoint already verified. `rest` is
   * whatever arrived after the handshake line; the socket is paused until the protocol takes over.
   */
  admit(socket: Socket, request: object, rest: string, respond: ISupervisedAttachResponder): Promise<void>;
}

export interface ISupervisedAttachCarrierOptions {
  /**
   * The host's sessions, the same directory its WebSocket clients reach: an attached terminal lists,
   * starts and switches them, and a switch moves every client. Absent, listing is not available.
   */
  readonly sessionDirectory?: ISessionDirectory;
}

export function createSupervisedAttachCarrier(
  session: IProtocolSession,
  options: ISupervisedAttachCarrierOptions = {},
): ISupervisedAttachCarrier {
  const attached = new Set<Socket>();
  let admitted = 0;
  return {
    admit: async (socket, request, rest, respond) => {
      const mode = 'mode' in request ? request.mode : undefined;
      if (!isAttachMode(mode) || !('protocol' in request) || request.protocol !== ATTACH_PROTOCOL) {
        respond.refuse('unsupported-attach');
        return;
      }
      // A connection already gone would never report its close, so its slot would never come back.
      if (socket.destroyed) return;
      if (attached.size >= MAX_ATTACHED_SURFACES) {
        respond.refuse('attach-limit');
        return;
      }
      // Held from here, so concurrent handshakes cannot overshoot the cap while one is decided.
      attached.add(socket);
      const gone = new AbortController();
      socket.once('close', () => {
        attached.delete(socket);
        gone.abort();
      });
      const decision = await new ConnectionAuthority(
        { locality: 'same-host', capabilities: ['drive', 'observe'] },
        createHandshakeApprover(mode),
      ).authorize(mode, { signal: gone.signal });
      if (socket.destroyed) return;
      if (!decision.allowed) {
        respond.refuse('declined');
        return;
      }
      const driverId = `attach:${(admitted += 1)}`;
      respond.accept(driverId);
      const deliver = createOutboundDelivery(
        (message) => {
          if (socket.destroyed) throw new Error('Attached terminal is gone.');
          socket.write(`${JSON.stringify(message)}\n`);
        },
        // A reader that stopped reading, or a broken socket, loses only its own connection.
        () => socket.destroy(),
        () => socket.writableLength,
        ATTACHED_SURFACE_MAX_PENDING_BYTES,
      );
      const handler = createSessionMessageHandler({
        session,
        deliver,
        driverId,
        surface: 'attach',
        role: mode,
        ...(options.sessionDirectory !== undefined ? { sessionDirectory: options.sessionDirectory } : {}),
      });
      // Detaching, a crash of the attacher, and the session closing its control all end here. The
      // session is never told to abort: an unsubscribed surface is simply gone, and a prompt only it
      // could answer is settled closed by the session itself.
      socket.once('close', () => handler.cleanup());
      let buffered = rest;
      const drain = (): void => {
        let end = buffered.indexOf('\n');
        // A frame can cut this connection off (over budget, broken write); what follows it in the
        // same chunk is then not this surface's to send.
        while (end !== -1 && !socket.destroyed) {
          const line = buffered.slice(0, end);
          buffered = buffered.slice(end + 1);
          if (Buffer.byteLength(line, 'utf8') > MAX_INBOUND_FRAME_BYTES) {
            socket.destroy();
            return;
          }
          if (line.trim() !== '') {
            try {
              handler.onMessage(line);
            } catch {
              socket.destroy();
              return;
            }
          }
          end = buffered.indexOf('\n');
        }
        if (Buffer.byteLength(buffered, 'utf8') > MAX_INBOUND_FRAME_BYTES) socket.destroy();
      };
      socket.on('data', (chunk: string) => {
        buffered += chunk;
        drain();
      });
      drain();
      socket.resume();
    },
  };
}
