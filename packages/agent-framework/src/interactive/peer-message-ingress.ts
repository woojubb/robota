/**
 * PEER-002 (#1809): how a peer message becomes something the agent can read, without losing where it
 * came from.
 *
 * ## The requirement that shapes this
 *
 * The issue asks that an incoming message "be added to the receiving runtime context with explicit
 * peer origin and can trigger an agent response". Both halves matter, and the second is why the
 * origin cannot be flattened into the text: an agent that answers a peer must be able to tell that
 * it is answering a PEER rather than its own operator, because the two carry different authority.
 *
 * `TDriverId` is display attribution and must never become an authorization input — the contract
 * says so and asserts it. This module keeps that separation on the runtime side: the trust level
 * travels beside the text, and the renderer gets the driver id.
 *
 * ## Concurrency, which the issue requires documented rather than discovered
 *
 * A session may already be running a turn when a peer message arrives. The repository already owns
 * that question — `InteractiveExecutionClaimOwner` refuses a second concurrent claim — so this does
 * NOT invent a second answer. It reads the claim and reports what happened:
 *
 * - **idle** → the message is delivered and may start a turn.
 * - **busy** → the message is QUEUED, not dropped and not run concurrently. Dropping would lose a
 *   peer's message with an ack that said `delivered`; running concurrently would violate the
 *   single-foreground-claim invariant that the rest of the session depends on.
 *
 * The queue is bounded. An unbounded one turns a chatty peer into a memory leak, and the bound is
 * surfaced as a refusal so the sender learns rather than being silently dropped — the same principle
 * the ledger applies to duplicates.
 */

import {
  isSameEnvironmentPeer,
  type IPeerMessageAck,
  type IPeerMessageIngress,
} from '@robota-sdk/agent-interface-transport';

/** What the session did with an arriving peer message. */
export type TIngressOutcome =
  /** Handed to the runtime now. */
  | 'delivered'
  /** Held because a turn is running; will be handed over when the claim frees. */
  | 'queued'
  /** Refused — the queue is full, or admission did not establish enough. */
  | 'refused';

export interface IIngressResult {
  readonly outcome: TIngressOutcome;
  readonly ack: IPeerMessageAck;
  /** How many messages are waiting behind this one. Present when queued. */
  readonly queueDepth?: number;
}

/**
 * The narrow view of a session this module needs.
 *
 * Deliberately not the session itself: the ingress decision depends on exactly two facts — whether a
 * turn is running, and where to put a message that is ready. Taking the whole session would let this
 * module grow into a second place that knows how sessions work.
 */
export interface IPeerIngressHost {
  /** Is a foreground turn running right now? Reads the session's existing execution claim. */
  isBusy(): boolean;
  /** Hand a message to the runtime, with its origin and trust intact. */
  deliver(ingress: IPeerMessageIngress): void;
}

export interface IPeerIngressOptions {
  /**
   * How many messages may wait while a turn runs.
   *
   * Bounded on purpose: an unbounded queue turns a chatty peer into a memory leak, and a silent
   * drop would contradict the `delivered` ack the sender already holds.
   */
  readonly maxQueued?: number;
  /**
   * Require the strongest local proof before a message reaches the runtime.
   *
   * Default false: #1809 owns message flow and #1810 owns admission, and this module must not
   * quietly become a second admission gate. A composition root that wants the stricter posture asks
   * for it explicitly.
   */
  readonly requireSameEnvironment?: boolean;
}

const DEFAULT_MAX_QUEUED = 32;

/**
 * The receiving side of peer messaging for one session.
 *
 * Holds the queue and nothing else — the ordering, duplicate and retry decisions belong to the
 * protocol ledger, and re-deciding them here would be a second answer to one question.
 */
export class PeerMessageIngress {
  private readonly queue: IPeerMessageIngress[] = [];

  constructor(
    private readonly host: IPeerIngressHost,
    private readonly options: IPeerIngressOptions = {},
  ) {}

  get pending(): number {
    return this.queue.length;
  }

  /** Take an admitted peer message and decide what happens to it now. */
  receive(ingress: IPeerMessageIngress): IIngressResult {
    const base = { id: ingress.message.id, sequence: ingress.message.sequence };

    if (!ingress.admission.admitted) {
      return {
        outcome: 'refused',
        ack: {
          ...base,
          state: 'refused',
          reason: ingress.admission.reason ?? 'the peer was not admitted',
        },
      };
    }

    if (this.options.requireSameEnvironment === true && !isSameEnvironmentPeer(ingress.admission)) {
      return {
        outcome: 'refused',
        ack: {
          ...base,
          state: 'refused',
          reason:
            `this session requires a same-environment peer; admission established ` +
            `'${ingress.admission.trust}'. A token proves possession, which is copyable, and says ` +
            'nothing about where the peer runs.',
        },
      };
    }

    // The queue has to be empty too, not just the session idle: a message that arrives while
    // earlier ones are still waiting would otherwise overtake them and reach the agent out of
    // order. Arrival order is the only order a peer conversation has.
    if (!this.host.isBusy() && this.queue.length === 0) {
      this.host.deliver(ingress);
      return { outcome: 'delivered', ack: { ...base, state: 'delivered' } };
    }

    const limit = this.options.maxQueued ?? DEFAULT_MAX_QUEUED;
    if (this.queue.length >= limit) {
      return {
        outcome: 'refused',
        ack: {
          ...base,
          state: 'refused',
          reason:
            `this session already has ${limit} peer message(s) waiting for the running turn. ` +
            'Refused rather than dropped: the sender holds the ack, so a silent drop would leave it ' +
            'believing a message landed that never will.',
        },
      };
    }

    this.queue.push(ingress);
    return {
      outcome: 'queued',
      // `delivered` would be a lie while it sits in a queue, and `pending` is the contract's word
      // for "not settled yet" — the sender keeps waiting, which is the truth.
      ack: { ...base, state: 'pending' },
      queueDepth: this.queue.length,
    };
  }

  /**
   * Hand over everything that was waiting, in arrival order.
   *
   * Called when the session's turn finishes. Returns what it delivered so a caller can ack them —
   * this module does not send, because a module that both decided and transmitted would be two
   * responsibilities and one of them would be untestable without a transport.
   *
   * Busy is re-read BEFORE EVERY hand-over, not once at the top. Delivering a message may start a
   * turn — that is the point of delivering it — so a loop that checked once would hand the whole
   * queue to a session that went busy on the first one, which is exactly the concurrent delivery
   * this class exists to prevent. Whatever is still waiting stays queued for the next drain.
   */
  drain(): readonly IPeerMessageIngress[] {
    const handed: IPeerMessageIngress[] = [];
    while (!this.host.isBusy()) {
      const next = this.queue.shift();
      if (next === undefined) break;
      this.host.deliver(next);
      handed.push(next);
    }
    return handed;
  }

  /**
   * Drop everything waiting — the peer disconnected, or the session is shutting down.
   *
   * Returns the abandoned messages so the caller can tell the sender, if the channel still exists.
   * Silently discarding them would leave a sender that holds a `pending` ack waiting forever.
   */
  abandon(): readonly IPeerMessageIngress[] {
    const waiting = [...this.queue];
    this.queue.length = 0;
    return waiting;
  }
}
