/**
 * Delivery: which of the agent's questions reach the person beyond the feed, and when. The agent only
 * suggests how urgent a question is; the limits here are the person's own words and decide what is
 * actually sent. Nothing in this module is reachable by a tool or by content the agent reads.
 */
import type { IFeedItem } from '../goals/types.js';

/** Times are `HH:MM` on a 24-hour clock, in the local time of the machine that runs the agent. */
export interface IQuietHours {
  readonly enabled: boolean;
  readonly from: string;
  readonly to: string;
}

export interface IDigestSchedule {
  readonly enabled: boolean;
  readonly at: string;
}

/** The person's limits. Local time throughout: that of the machine running the agent. */
export interface IDeliverySettings {
  /** How many questions may be pushed immediately in one local day, 0 to 20; 0 pushes none. */
  readonly dailyLimit: number;
  /** While it lasts nothing is pushed immediately; a window may cross midnight. */
  readonly quietHours: IQuietHours;
  /** Whether questions that can wait are gathered into one daily summary, and when it goes out. */
  readonly digest: IDigestSchedule;
}

/** What delivery remembers between runs. */
export interface IDeliveryState {
  /** The local day `sent` counts, as `YYYY-MM-DD`. */
  readonly day: string;
  /** How many questions were pushed immediately on `day`. */
  readonly sent: number;
  /** The local day the last digest went out. */
  readonly digestedOn?: string;
  /** Feed items waiting for the next digest. */
  readonly pendingDigest: readonly string[];
  /** When a source last had an offer pushed, by source key; at most a few dozen, the oldest dropped. */
  readonly offerSources?: Readonly<Record<string, string>>;
  /** Offers waiting for the next digest, by id, with the title the host verified. */
  readonly pendingOffers?: readonly IPendingOffer[];
}

export interface IPendingOffer {
  readonly offerId: string;
  readonly title: string;
}

/** What becomes of one question or offer: pushed now, held for the daily summary, or left in the feed. */
export type TDelivery = 'notify' | 'digest' | 'feed';

export interface IDeliveryMessage {
  /** A `test` message is the person's own check that a sink works; it is never a question. */
  readonly kind: 'question' | 'offer' | 'digest' | 'test';
  /** A short plain line that says what the message is about, for a sink that shows a heading. */
  readonly title: string;
  /** Plain text on one or a few lines; a sink adds nothing to it. */
  readonly text: string;
}

/**
 * Somewhere a message can be pushed to: the person's connected messengers, an address they gave, a page
 * they have open. A sink that cannot take a message throws, which is how a push is told from one that
 * was not taken.
 */
export interface IDeliverySink {
  readonly id: string;
  deliver(message: IDeliveryMessage): Promise<void>;
}

/** Where one value lives between runs; a host supplies one for each. */
export interface IDeliveryStore<T> {
  /** The stored value, or `undefined` when nothing was stored yet. */
  read(): Promise<T | undefined>;
  write(value: T): Promise<void>;
}

/** What the person sees of delivery: their limits, today's pushes against them, and what waits for the digest. */
export interface IDeliveryStatus {
  readonly settings: IDeliverySettings;
  readonly today: { readonly sent: number; readonly limit: number };
  /** Open questions held for the next digest. */
  readonly waitingInDigest: number;
  /** Offers held for the next digest that are still offered. */
  readonly offersWaitingInDigest: number;
}

/** The feed as delivery needs it: a card, looked up again before a digest names it. */
export interface IDeliveryFeed {
  feedItem(id: string): Promise<IFeedItem | undefined>;
}
