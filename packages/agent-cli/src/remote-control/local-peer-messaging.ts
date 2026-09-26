/**
 * PEER-006 (issue #1863, stage 4) — the join between the carrier and the session ingress.
 *
 * Every piece below this file was built and merged, and none of them touched each other: the
 * contracts and ledger in `agent-interface-transport` / `agent-transport`, the session
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
 * Everything this session attributes to a peer — the turn's origin, its driver id, where an answer
 * goes, the conversation it joins, what the operator is told — comes from the sender the carrier
 * confirmed, never from the origin the message states. The driver id is computed from that session
 * id, so a name the transcript's reader trusts is not picked by the party being named.
 */

import { randomUUID } from 'node:crypto';

import { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';

import { describeFileRefusal, describeReceived, fileReceiving } from '../peer-files/receiving.js';
import { listenForPeerMessages } from './local-peer-channel.js';
import { PeerConversationLedger } from './peer-conversation-ledger.js';

import type { IPeerListener, IPeerSender } from './local-peer-channel.js';
import type { IPeerConversationLimits } from './peer-conversation-ledger.js';
import type { IOutgoingFile } from '../peer-files/outgoing-file.js';
import type {
  IFileFrameChannel,
  IOperatorApprover,
  IPeerMessage,
  IPeerMessageAck,
  IPeerMessageIngress,
  IPeerOrigin,
  TWorkspaceRelation,
} from '@robota-sdk/agent-interface-session-mobility';
import type { TFileReceiveOutcome } from '@robota-sdk/agent-transport/node';

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
  /**
   * The sender's workspace relation as this session judges it, carried into the peer-turn origin
   * for display and routing. Asked for the sender alone, never for every peer.
   */
  readonly relate?: (sessionId: string) => Promise<TWorkspaceRelation | undefined>;
  /** Where a settled refusal is reported. Absent means nobody is told, which is a choice. */
  readonly report?: (message: string) => void;
  readonly newMessageId?: () => string;
  readonly now?: () => number;
  /** How far one conversation may run before a reply is refused. Defaults apply when absent. */
  readonly limits?: IPeerConversationLimits;
  /** Receiving files. Absent: every file is refused. */
  readonly files?: IPeerFileReceiving;
  /** Takes each hand-off channel a confirmed session opens. Absent: every hand-off is refused. */
  readonly onHandoff?: (sender: IPeerSender, channel: IFileFrameChannel) => void;
}

/** How this session takes files from its peers. */
export interface IPeerFileReceiving {
  /** `~/.robota` of this session's `HOME`; received files are kept under it. */
  readonly root: string;
  /** Asked for every file. Absent: every file is refused, since nobody can approve it. */
  readonly approver?: IOperatorApprover;
  readonly maxBytes?: number;
}

/** How a send of a file ended, in the vocabulary the operator reads. */
export interface IPeerFileSendResult {
  readonly state: 'delivered' | 'refused' | 'failed';
  readonly reason?: string;
}

/** What a send may say beyond the text. */
export interface IPeerSendOptions {
  /** The received message this answers. The reply then counts against that conversation's limits. */
  readonly inReplyTo?: string;
}

export interface IPeerMessaging {
  readonly socketPath: string;
  send(targetSessionId: string, text: string, options?: IPeerSendOptions): Promise<IPeerMessageAck>;
  /** Send a prepared file's content to another announced session. */
  sendFile(targetSessionId: string, file: IOutgoingFile): Promise<IPeerFileSendResult>;
  /** Open a channel to push a hand-off to another announced session. Rejects with why it cannot. */
  openHandoffChannel(targetSessionId: string): Promise<IFileFrameChannel>;
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
  const conversations = new PeerConversationLedger(options.limits);
  const now = options.now ?? ((): number => Date.now());
  const newMessageId = options.newMessageId ?? ((): string => `${options.sessionId}-${sequence}`);

  const files = options.files;
  const listener: IPeerListener = await listenForPeerMessages({
    guardedDirectory: options.guardedDirectory,
    sessionId: options.sessionId,
    ...(files !== undefined
      ? {
          onFile: (sender: IPeerSender) =>
            fileReceiving({
              root: files.root,
              senderId: `local-${sender.sessionId}`,
              authority: new ConnectionAuthority(
                { sessionId: sender.sessionId, locality: 'same-host', capabilities: ['file'] },
                files.approver,
              ),
              ...(files.maxBytes !== undefined ? { maxBytes: files.maxBytes } : {}),
            }),
          onFileOutcome: (outcome: TFileReceiveOutcome, sender: IPeerSender) =>
            reportQuietly(options.report, describeReceived(sender.sessionId, outcome)),
        }
      : {}),
    ...(options.onHandoff !== undefined ? { onHandoff: options.onHandoff } : {}),
    onMessage: async (received: IPeerMessage, sender: IPeerSender): Promise<IPeerMessageAck> => {
      const from = sender.sessionId;
      const message: IPeerMessage = { ...received, origin: { sessionId: from } };
      conversations.receive(message);
      // The admission is the DIRECTORY's, established when the socket was bound, and the sender is
      // the one the carrier confirmed. Both are restated here as the ingress's contract requires,
      // not re-derived from anything the peer sent. The workspace relation is likewise this
      // session's own verdict, never the sender's.
      const relation = await options.relate?.(from).catch(() => {
        // allow-fallback: the relation is display-only; without it the turn simply carries none.
        return undefined;
      });
      const origin: IPeerOrigin = { sessionId: from, driverId: peerDriverId(from) };
      const result = await options.ingress.receive({
        message: {
          ...message,
          origin: { ...origin, ...(relation !== undefined ? { workspaceRelation: relation } : {}) },
        },
        // The admission carries no relation: it is what authority is decided on, and the relation
        // must never be one of its inputs.
        admission: { admitted: true, trust: 'same-user-same-host', origin },
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
              `[peers] a message from ${from} did not run: ` +
                `${settled.reason ?? 'no reason was given'}`,
            );
          }
        },
        (error: unknown) => {
          reportQuietly(
            options.report,
            `[peers] a message from ${from} failed after it was accepted: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );

      return result.ack;
    },
  });

  /**
   * Why `targetSessionId` cannot be addressed, or undefined when it can. Resolved through discovery
   * BEFORE a socket is opened, so an unannounced target is told what is wrong rather than handed a
   * connection error that names a path they never typed.
   */
  const addressable = (targetSessionId: string): string | undefined => {
    const target = options.list().find((peer) => peer.sessionId === targetSessionId);
    if (target === undefined) {
      return `no session ${targetSessionId} is announced on this host. Run /peers to see which are.`;
    }
    if (target.liveness === 'dead') return `session ${targetSessionId} is no longer running.`;
    return undefined;
  };

  return {
    socketPath: listener.socketPath,
    send: async (
      targetSessionId: string,
      text: string,
      sendOptions: IPeerSendOptions = {},
    ): Promise<IPeerMessageAck> => {
      if (targetSessionId === options.sessionId) {
        return refusal(undefined, 'that is this session; a session does not message itself.');
      }

      const reachable = addressable(targetSessionId);
      if (reachable !== undefined) return refusal(undefined, reachable);

      // A reply is held to its conversation's limits before anything is sent, and a refusal is said
      // to the operator: the model hearing it is not the operator hearing it.
      const { inReplyTo } = sendOptions;
      const admission =
        inReplyTo === undefined ? undefined : conversations.admitReply(targetSessionId, inReplyTo);
      if (admission !== undefined && !admission.admitted) {
        reportQuietly(
          options.report,
          `[peers] a reply to ${targetSessionId} was not sent: ${admission.reason}.`,
        );
        return refusal(undefined, `the reply was not sent: ${admission.reason}.`);
      }

      sequence += 1;
      const message: IPeerMessage = {
        id: newMessageId(),
        sequence,
        origin: { sessionId: options.sessionId },
        text,
        sentAt: now(),
        ...(inReplyTo !== undefined ? { inReplyTo } : {}),
      };
      conversations.recordSent(message.id, targetSessionId, admission?.thread);

      try {
        return await listener.send(targetSessionId, message);
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
    sendFile: async (
      targetSessionId: string,
      file: IOutgoingFile,
    ): Promise<IPeerFileSendResult> => {
      if (targetSessionId === options.sessionId) {
        return { state: 'refused', reason: 'that is this session; it already has the file.' };
      }
      const reachable = addressable(targetSessionId);
      if (reachable !== undefined) return { state: 'refused', reason: reachable };
      try {
        const outcome = await listener.sendFile(
          targetSessionId,
          { transferId: randomUUID(), name: file.name, size: file.size, sha256: file.sha256 },
          file.source,
        );
        if (outcome.ok) return { state: 'delivered' };
        const reason = describeFileRefusal(outcome.reason, outcome.detail);
        const refusedThere =
          outcome.reason !== 'closed' &&
          outcome.reason !== 'timeout' &&
          outcome.reason !== 'unavailable';
        return { state: refusedThere ? 'refused' : 'failed', reason };
      } catch (error) {
        return { state: 'failed', reason: error instanceof Error ? error.message : String(error) };
      }
    },
    openHandoffChannel: async (targetSessionId: string): Promise<IFileFrameChannel> => {
      if (targetSessionId === options.sessionId) {
        throw new Error('that is this session; it already holds the session.');
      }
      const reachable = addressable(targetSessionId);
      if (reachable !== undefined) throw new Error(reachable);
      return listener.openHandoffChannel(targetSessionId);
    },
    close: () => listener.close(),
  };
}
