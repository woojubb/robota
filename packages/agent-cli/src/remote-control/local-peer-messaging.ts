/**
 * PEER-006 (issue #1863, stage 4) — the join between the carrier and the session ingress.
 *
 * Every piece below this file was built and merged, and none of them touched each other: the
 * contracts and ledger in `agent-interface-transport` / `agent-transport-protocol`, the session
 * ingress in `agent-framework`, discovery in PEER-004, and the unix-socket carrier in PEER-005. This
 * module owns exactly the wiring, and deliberately re-decides nothing any of them settled.
 *
 * ## Why the wire ack is the IMMEDIATE one
 *
 * `PeerMessageIngress` returns two acks: one now, and a promise for how the turn settled. Only the
 * first goes back on the socket. A message queued behind a long turn would otherwise hold the
 * sender's connection open for as long as that turn runs — minutes — and the contract already has
 * the word for "taken, not settled": `pending`. The settled ack is still consumed, so a refusal is
 * reported to the operator rather than dropped on the floor.
 *
 * ## Attribution is derived, never accepted
 *
 * `IPeerOrigin.driverId` is peer-supplied. The driver id this session attributes a peer turn to is
 * computed from the peer's SESSION id, which is the one thing the sender cannot choose: it is the
 * name the rendezvous directory published for them. Issue #1809 fixed this and it is not re-decided
 * here — a name the transcript's reader trusts must not be picked by the party being named.
 */

import { listenForPeerMessages, sendPeerMessage } from './local-peer-channel.js';

import type { IPeerListener } from './local-peer-channel.js';
import type {
  IPeerMessage,
  IPeerMessageAck,
  IPeerMessageIngress,
} from '@robota-sdk/agent-interface-session-mobility';

/** What this module needs from `PeerMessageIngress`, and nothing more. */
export interface IPeerIngressPort {
  receive(ingress: IPeerMessageIngress): Promise<{
    readonly ack: IPeerMessageAck;
    readonly settled?: Promise<IPeerMessageAck>;
  }>;
}

/** One announced session, as discovery reports it. */
export interface IAddressablePeer {
  readonly sessionId: string;
  readonly liveness: 'alive' | 'dead' | 'unknown';
}

export interface IPeerMessagingOptions {
  readonly guardedDirectory: string;
  readonly sessionId: string;
  readonly ingress: IPeerIngressPort;
  /** Discovery, injected: this module must not become a second reader of the rendezvous. */
  readonly list: () => readonly IAddressablePeer[];
  /** Where a settled refusal is reported. Absent means nobody is told, which is a choice. */
  readonly report?: (message: string) => void;
  readonly newMessageId?: () => string;
  readonly now?: () => number;
}

export interface IPeerMessaging {
  readonly socketPath: string;
  send(targetSessionId: string, text: string): Promise<IPeerMessageAck>;
  close(): Promise<void>;
}

/**
 * The driver id a peer turn is attributed to.
 *
 * Prefixed rather than bare so a transcript reader can never mistake it for the owner's, and derived
 * from the session id so the sender cannot choose it.
 */
export function peerDriverId(peerSessionId: string): string {
  return `peer:${peerSessionId}`;
}

/**
 * Report, and never let reporting become the thing that fails.
 *
 * This runs inside a detached promise chain. A `report` that throws there produces an unhandled
 * rejection — which would silence the very channel whose job is to say something went wrong.
 */
function reportQuietly(report: ((message: string) => void) | undefined, message: string): void {
  try {
    report?.(message);
  } catch {
    // allow-fallback: there is nowhere left to report a reporter that throws. Swallowing here is
    // narrower than the alternative, which is an unhandled rejection taking the process with it.
  }
}

function refusal(message: IPeerMessage | undefined, reason: string): IPeerMessageAck {
  return { id: message?.id ?? '', sequence: message?.sequence ?? 0, state: 'refused', reason };
}

/**
 * Start listening, and return the sending half.
 *
 * The listener is bound BEFORE this returns, so a caller that awaits it knows this session is
 * reachable. Returning early with a socket that is not yet bound would make "announced" and
 * "addressable" two different moments, and the gap between them is exactly when a peer's first
 * message would vanish.
 */
export async function startLocalPeerMessaging(
  options: IPeerMessagingOptions,
): Promise<IPeerMessaging> {
  let sequence = 0;
  const now = options.now ?? ((): number => Date.now());
  const newMessageId = options.newMessageId ?? ((): string => `${options.sessionId}-${sequence}`);

  const listener: IPeerListener = await listenForPeerMessages({
    guardedDirectory: options.guardedDirectory,
    sessionId: options.sessionId,
    onMessage: async (message: IPeerMessage): Promise<IPeerMessageAck> => {
      // The admission is the DIRECTORY's, established when the socket was bound. It is restated
      // here as the ingress's contract requires, not re-derived from anything the peer sent.
      const result = await options.ingress.receive({
        message: {
          ...message,
          origin: {
            sessionId: message.origin.sessionId,
            driverId: peerDriverId(message.origin.sessionId),
          },
        },
        admission: {
          admitted: true,
          trust: 'same-user-same-host',
          origin: {
            sessionId: message.origin.sessionId,
            driverId: peerDriverId(message.origin.sessionId),
          },
        },
      });

      // Consumed, not awaited on the wire. A refusal the operator never hears is the failure mode
      // this repository calls "silence is not success".
      //
      // The rejection handler is not defensive decoration. `settled` today resolves in BOTH
      // directions — `PeerMessageIngress` attaches its own onRejected — but this module does not own
      // that promise, and an unhandled rejection here would take out the one channel that reports
      // failure, which is the same silence one layer up. A `report` that itself throws would do it too.
      void result.settled?.then(
        (settled) => {
          if (settled.state === 'refused' || settled.state === 'failed') {
            reportQuietly(
              options.report,
              `[peers] a message from ${message.origin.sessionId} did not run: ` +
                `${settled.reason ?? 'no reason was given'}`,
            );
          }
        },
        (error: unknown) => {
          reportQuietly(
            options.report,
            `[peers] a message from ${message.origin.sessionId} failed after it was accepted: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );

      return result.ack;
    },
  });

  return {
    socketPath: listener.socketPath,
    send: async (targetSessionId: string, text: string): Promise<IPeerMessageAck> => {
      if (targetSessionId === options.sessionId) {
        return refusal(undefined, 'that is this session; a session does not message itself.');
      }

      // Resolved through discovery BEFORE a socket is opened, so an unannounced target is told what
      // is wrong rather than handed a connection error that names a path they never typed.
      const target = options.list().find((peer) => peer.sessionId === targetSessionId);
      if (target === undefined) {
        return refusal(
          undefined,
          `no session ${targetSessionId} is announced on this host. Run /peers to see which are.`,
        );
      }
      if (target.liveness === 'dead') {
        return refusal(undefined, `session ${targetSessionId} is no longer running.`);
      }

      sequence += 1;
      const message: IPeerMessage = {
        id: newMessageId(),
        sequence,
        origin: { sessionId: options.sessionId },
        text,
        sentAt: now(),
      };

      try {
        return await sendPeerMessage({
          guardedDirectory: options.guardedDirectory,
          targetSessionId,
          message,
        });
      } catch (error) {
        // A carrier failure is `failed`, not `refused`: the receiver never got to have an opinion,
        // and telling the sender it was refused would name a decision nobody made.
        return {
          id: message.id,
          sequence: message.sequence,
          state: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
    close: () => listener.close(),
  };
}
