/**
 * Messages between this session and another of the user's devices, over their admitted mesh link.
 *
 * A message arriving here is handled exactly like one from a session on this host: attributed to the
 * device the handshake proved — never to a name the frame states — submitted as a peer turn that
 * carries no authority, and held to the same conversation limits. The link's own message channel
 * carries the message and the receiver's immediate answer; nothing else travels on it.
 */

import { randomUUID } from 'node:crypto';

import { PeerConversationLedger } from '../remote-control/peer-conversation-ledger.js';
import {
  peerDriverId,
  type IPeerIngressPort,
  type IPeerSendOptions,
} from '../remote-control/local-peer-messaging.js';

import type {
  IPeerMessage,
  IPeerMessageAck,
  TPeerDeliveryState,
} from '@robota-sdk/agent-interface-session-mobility';
import type { IDeviceMeshLink } from '@robota-sdk/agent-transport-webrtc';

/** How long a sender waits for the receiver to say it has the message. */
const ACK_TIMEOUT_MS = 30_000;
/** Longest message id either side takes. */
const MAX_ID_CHARS = 128;

const STATES: ReadonlySet<string> = new Set<TPeerDeliveryState>([
  'pending',
  'delivered',
  'acknowledged',
  'duplicate',
  'refused',
  'failed',
]);

interface IMessageFrame {
  readonly t: 'peer-message';
  readonly id: string;
  readonly sequence: number;
  readonly text: string;
  readonly sentAt: number;
  readonly inReplyTo?: string;
}

interface IAckFrame {
  readonly t: 'peer-ack';
  readonly id: string;
  readonly sequence: number;
  readonly state: TPeerDeliveryState;
  readonly reason?: string;
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
}

/** A frame from the peer, decoded as hostile input: anything malformed is `undefined`. */
function decode(body: string): IMessageFrame | IAckFrame | undefined {
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  if (!isId(r['id']) || typeof r['sequence'] !== 'number' || !Number.isSafeInteger(r['sequence'])) {
    return undefined;
  }
  if (r['t'] === 'peer-message') {
    if (typeof r['text'] !== 'string' || typeof r['sentAt'] !== 'number') return undefined;
    if (r['inReplyTo'] !== undefined && !isId(r['inReplyTo'])) return undefined;
    return {
      t: 'peer-message',
      id: r['id'],
      sequence: r['sequence'],
      text: r['text'],
      sentAt: r['sentAt'],
      ...(r['inReplyTo'] !== undefined ? { inReplyTo: r['inReplyTo'] as string } : {}),
    };
  }
  if (r['t'] === 'peer-ack' && typeof r['state'] === 'string' && STATES.has(r['state'])) {
    return {
      t: 'peer-ack',
      id: r['id'],
      sequence: r['sequence'],
      state: r['state'] as TPeerDeliveryState,
      ...(typeof r['reason'] === 'string' ? { reason: r['reason'].slice(0, 500) } : {}),
    };
  }
  return undefined;
}

function refusal(reason: string, id = '', sequence = 0): IPeerMessageAck {
  return { id, sequence, state: 'refused', reason };
}

export interface IMeshMessagingOptions {
  /** The live session's ingress, when there is one. */
  readonly ingress: () => IPeerIngressPort | undefined;
  /** Where a message that did not run is reported. */
  readonly report: (message: string) => void;
  readonly now?: () => number;
}

/** Messaging over every link of this session's mesh endpoint. */
export class MeshMessaging {
  private readonly conversations = new PeerConversationLedger();
  private readonly waiting = new Map<string, (ack: IPeerMessageAck) => void>();
  private sequence = 0;

  public constructor(private readonly options: IMeshMessagingOptions) {}

  /** Take messages and answers the device on `link` sends. Returns an unsubscribe. */
  public attach(link: IDeviceMeshLink): () => void {
    return link.onMessage((body) => {
      const frame = decode(body);
      if (frame === undefined) return;
      if (frame.t === 'peer-ack') {
        this.waiting.get(`${link.admission.deviceId}\u0000${frame.id}`)?.({
          id: frame.id,
          sequence: frame.sequence,
          state: frame.state,
          ...(frame.reason !== undefined ? { reason: frame.reason } : {}),
        });
        return;
      }
      void this.receive(link, frame).then(
        (ack) => this.answer(link, ack),
        (error: unknown) =>
          this.answer(
            link,
            refusal(
              error instanceof Error ? error.message : String(error),
              frame.id,
              frame.sequence,
            ),
          ),
      );
    });
  }

  private answer(link: IDeviceMeshLink, ack: IPeerMessageAck): void {
    const frame: IAckFrame = {
      t: 'peer-ack',
      id: ack.id,
      sequence: ack.sequence,
      state: ack.state,
      ...(ack.reason !== undefined ? { reason: ack.reason } : {}),
    };
    try {
      link.send(JSON.stringify(frame));
    } catch {
      // allow-fallback: the link is gone; the sender's wait ends on its own timeout.
    }
  }

  private async receive(link: IDeviceMeshLink, frame: IMessageFrame): Promise<IPeerMessageAck> {
    // The sender is the device the handshake proved, whatever the frame might say.
    const from = link.admission.deviceId;
    const origin = { sessionId: from, driverId: peerDriverId(from) };
    const message: IPeerMessage = {
      id: frame.id,
      sequence: frame.sequence,
      origin,
      text: frame.text,
      sentAt: frame.sentAt,
      ...(frame.inReplyTo !== undefined ? { inReplyTo: frame.inReplyTo } : {}),
    };
    const ingress = this.options.ingress();
    if (ingress === undefined) {
      return refusal('no session is ready to take it here', frame.id, frame.sequence);
    }
    this.conversations.receive(message);
    const result = await ingress.receive({
      message,
      admission: { admitted: true, trust: link.admission.trust, origin },
    });
    void result.settled?.then(
      (settled) => {
        if (settled.state === 'refused' || settled.state === 'failed') {
          this.report(
            `[peers] a message from device ${from} did not run: ${settled.reason ?? 'no reason was given'}`,
          );
        }
      },
      () => this.report(`[peers] a message from device ${from} failed after it was accepted`),
    );
    return result.ack;
  }

  private report(message: string): void {
    try {
      this.options.report(message);
    } catch {
      // allow-fallback: there is nowhere left to report a reporter that throws.
    }
  }

  /** Send `text` to the device on `link` and wait for its answer. */
  public async send(
    link: IDeviceMeshLink,
    text: string,
    options: IPeerSendOptions = {},
  ): Promise<IPeerMessageAck> {
    const target = link.admission.deviceId;
    const { inReplyTo } = options;
    const admission =
      inReplyTo === undefined ? undefined : this.conversations.admitReply(target, inReplyTo);
    if (admission !== undefined && !admission.admitted) {
      this.report(`[peers] a reply to device ${target} was not sent: ${admission.reason}.`);
      return refusal(`the reply was not sent: ${admission.reason}.`);
    }
    this.sequence += 1;
    const frame: IMessageFrame = {
      t: 'peer-message',
      id: randomUUID(),
      sequence: this.sequence,
      text,
      sentAt: (this.options.now ?? Date.now)(),
      ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    };
    const key = `${target}\u0000${frame.id}`;
    const failed = (reason: string): IPeerMessageAck => ({
      id: frame.id,
      sequence: frame.sequence,
      state: 'failed',
      reason,
    });
    const answered = new Promise<IPeerMessageAck>((resolve) => {
      const timer = setTimeout(
        () => done(failed('the device did not answer in time')),
        ACK_TIMEOUT_MS,
      );
      timer.unref?.();
      const offClose = link.onClose(() => done(failed('the link to the device closed')));
      const done = (ack: IPeerMessageAck): void => {
        clearTimeout(timer);
        offClose();
        this.waiting.delete(key);
        resolve(ack);
      };
      this.waiting.set(key, done);
    });
    this.conversations.recordSent(frame.id, target, admission?.thread);
    try {
      link.send(JSON.stringify(frame));
    } catch (error) {
      this.waiting.get(key)?.(failed(error instanceof Error ? error.message : String(error)));
    }
    return answered;
  }
}
