/**
 * Which conversation each peer message belongs to, and whether a reply may still be sent in it.
 *
 * A conversation is an `inReplyTo` chain. Its depth (hops) and how often THIS session has answered
 * in it (the turn budget) are both counted here, from what this session itself sent and received —
 * never from a count the peer states. A received message joins a conversation only when its
 * `inReplyTo` names a message this session sent to that same peer; anything else starts a new one.
 *
 * Two agents that always answer would otherwise message each other forever, each turn costing a
 * model call on both sides. The limit is checked when a reply is about to leave, so the reply that
 * would cross it is the one not sent.
 */

import type { IPeerMessage } from '@robota-sdk/agent-interface-session-mobility';

export interface IPeerConversationLimits {
  /** The deepest a conversation may run, counted in messages after the first. */
  readonly maxHops: number;
  /** How many replies this session sends in one conversation. */
  readonly maxRepliesPerConversation: number;
}

export const DEFAULT_PEER_CONVERSATION_LIMITS: IPeerConversationLimits = {
  maxHops: 8,
  maxRepliesPerConversation: 4,
};

/** Messages remembered per direction; the oldest are forgotten first. */
const MAX_REMEMBERED = 1000;

interface IThread {
  readonly conversation: string;
  readonly hop: number;
  /** The other session in this message. */
  readonly peer: string;
}

export type TReplyAdmission =
  | { readonly admitted: true; readonly thread: IThread }
  | { readonly admitted: false; readonly reason: string };

function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export class PeerConversationLedger {
  /** What this session sent, by its own message id. */
  private readonly sent = new Map<string, IThread>();
  /** What this session received, by sender and the sender's message id. */
  private readonly received = new Map<string, IThread>();
  private readonly replies = new Map<string, number>();

  constructor(
    private readonly limits: IPeerConversationLimits = DEFAULT_PEER_CONVERSATION_LIMITS,
  ) {}

  /** Place an arriving message in its conversation. */
  receive(message: IPeerMessage): void {
    const sender = message.origin.sessionId;
    const parent = message.inReplyTo !== undefined ? this.sent.get(message.inReplyTo) : undefined;
    const thread: IThread =
      parent !== undefined && parent.peer === sender
        ? { conversation: parent.conversation, hop: parent.hop + 1, peer: sender }
        : { conversation: `${sender}\u0000${message.id}`, hop: 0, peer: sender };
    remember(this.received, `${sender}\u0000${message.id}`, thread);
  }

  /** Whether a reply to `inReplyTo` from `target` may be sent now. */
  admitReply(target: string, inReplyTo: string): TReplyAdmission {
    const answered = this.received.get(`${target}\u0000${inReplyTo}`);
    if (answered === undefined) {
      return {
        admitted: false,
        reason: `${inReplyTo} is not a message this session received from ${target}`,
      };
    }
    const hop = answered.hop + 1;
    if (hop > this.limits.maxHops) {
      return {
        admitted: false,
        reason:
          `the conversation with ${target} reached its limit of ${this.limits.maxHops} ` +
          'messages back and forth',
      };
    }
    const replies = this.replies.get(answered.conversation) ?? 0;
    if (replies >= this.limits.maxRepliesPerConversation) {
      return {
        admitted: false,
        reason:
          `this session already answered ${replies} times in its conversation with ${target}, ` +
          'the limit for one conversation',
      };
    }
    return { admitted: true, thread: { conversation: answered.conversation, hop, peer: target } };
  }

  /** Record a message this session sent: a reply in its thread, or the first of a new one. */
  recordSent(id: string, target: string, thread?: IThread): void {
    if (thread === undefined) {
      remember(this.sent, id, { conversation: `\u0000${id}`, hop: 0, peer: target });
      return;
    }
    remember(this.sent, id, thread);
    remember(this.replies, thread.conversation, (this.replies.get(thread.conversation) ?? 0) + 1);
  }
}
