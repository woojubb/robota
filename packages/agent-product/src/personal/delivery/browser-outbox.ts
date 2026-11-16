/**
 * The page the person has open as a place to be told: a small bounded outbox in memory that the page
 * reads by polling. A message only counts as pushed when a page has polled lately, so while nobody is
 * looking it is not taken: it does not use up the day's limit and the question waits in the feed. The
 * outbox is not kept across a restart and is never a record; the feed is.
 *
 * What it holds is text the agent wrote from content other people wrote, so the page shows it as
 * plain text and nothing else.
 */
import type { IDeliveryMessage, IDeliverySink } from './types.js';

/** How many messages are kept; an older one is dropped for a new one. */
export const BROWSER_OUTBOX_CAPACITY = 20;
/** How long after its last poll a page still counts as open. */
export const BROWSER_LISTENING_MS = 90_000;

export interface IBrowserNotification {
  /** Counts up from 1 for as long as the agent runs, so a page asks for what came after the last one it saw. */
  readonly id: number;
  readonly at: string;
  readonly kind: IDeliveryMessage['kind'];
  readonly title: string;
  readonly text: string;
}

export interface IBrowserOutboxOptions {
  /** Milliseconds, on the clock the page's polls are counted by. */
  readonly now?: () => number;
  readonly capacity?: number;
  readonly listeningMs?: number;
}

export class BrowserOutbox implements IDeliverySink {
  readonly id = 'browser';
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly listeningMs: number;
  private messages: IBrowserNotification[] = [];
  private latest = 0;
  private polledAt: number | undefined;

  constructor(options: IBrowserOutboxOptions = {}) {
    this.now = options.now ?? Date.now;
    this.capacity = options.capacity ?? BROWSER_OUTBOX_CAPACITY;
    this.listeningMs = options.listeningMs ?? BROWSER_LISTENING_MS;
  }

  /** Whether a page has polled lately enough to be open. */
  listening(): boolean {
    return this.polledAt !== undefined && this.now() - this.polledAt <= this.listeningMs;
  }

  /** Keeps the message for the page to fetch, or throws when no page is open to take it. */
  async deliver(message: IDeliveryMessage): Promise<void> {
    if (!this.listening()) throw new Error('No page is open to take it');
    this.latest += 1;
    this.messages = [
      ...this.messages,
      {
        id: this.latest,
        at: new Date(this.now()).toISOString(),
        kind: message.kind,
        title: message.title,
        text: message.text,
      },
    ].slice(-this.capacity);
  }

  /**
   * A page asks what came after the last message it saw; that it asked is what shows a page is open.
   * A page with nothing yet asks from now on and gets none; one that remembers a later message than any
   * here, as after a restart, gets everything kept.
   */
  poll(after?: number): {
    readonly messages: readonly IBrowserNotification[];
    readonly latest: number;
  } {
    this.polledAt = this.now();
    if (after === undefined) return { messages: [], latest: this.latest };
    const from = after > this.latest ? 0 : after;
    return { messages: this.messages.filter((message) => message.id > from), latest: this.latest };
  }
}
