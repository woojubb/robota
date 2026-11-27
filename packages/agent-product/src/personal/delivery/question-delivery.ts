/**
 * What becomes of a question the agent asked: the person's own limits decide, never the agent's
 * suggestion of urgency. A question may be pushed to the person's sinks at once, held for one daily
 * summary, or left in the feed, which is where every question is anyway; so a push that is not wanted,
 * or not possible, loses nothing.
 *
 * The questions are written by the agent from content other people wrote, so what reaches a sink is
 * plain text on one line per part, cut to a bound, with nothing added but a pointer to the feed. A sink
 * gets one attempt: a failure, or a sink that does not answer in time, never fails the ask, is never
 * counted as a push, and is not retried; the question stays in the feed.
 */
import {
  DEFAULT_DELIVERY_SETTINGS,
  applySettingsChange,
  decideDelivery,
  inQuietHours,
  localDay,
  localMinutes,
  minutesOf,
} from './policy.js';
import { OFFER_SOURCES_MAX, PENDING_DIGEST_MAX } from './stores.js';

import type { ICaseAskedEvent } from '../cases/case-book.js';
import type { IFeedItem } from '../goals/types.js';
import type {
  IDeliveryFeed,
  IDeliveryMessage,
  IDeliverySettings,
  IDeliverySink,
  IDeliveryState,
  IDeliveryStatus,
  IDeliveryStore,
  IPendingOffer,
  TDelivery,
} from './types.js';

const TEXT_PART_LIMIT = 200;
const TITLE_LIMIT = 100;
const SINK_TIMEOUT_MS = 20_000;
const FEED_POINTER = 'Open your Feed to answer.';
const OFFER_POINTER = 'Open your Feed to look at it.';
const SOURCE_KEY_LIMIT = 200;
/** A source that had an offer pushed waits this long before another of its offers is pushed. */
export const OFFER_SOURCE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** One line of plain text within a bound: no line breaks, no control or invisible formatting characters. */
function oneLine(text: string, limit = TEXT_PART_LIMIT): string {
  const line = text
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\s]+/gu, ' ')
    .trim();
  const points = [...line];
  return points.length <= limit
    ? line
    : `${points
        .slice(0, limit - 3)
        .join('')
        .trimEnd()}...`;
}

/** One piece of work at a time, in the order it arrived. */
function serial(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
}

export interface IQuestionDeliveryOptions {
  /** The person's limits; none stored means the defaults. */
  readonly settings: IDeliveryStore<IDeliverySettings>;
  readonly state: IDeliveryStore<IDeliveryState>;
  /**
   * Where the person is told; a message goes to every sink. A function is asked again for each message,
   * so a sink that exists only while the person has set it up is there for exactly that long.
   */
  readonly sinks: readonly IDeliverySink[] | (() => Promise<readonly IDeliverySink[]>);
  /** Where a held question is looked up again, to see whether it still waits for an answer. */
  readonly feed: IDeliveryFeed;
  /** The time of the machine running the agent; local day and local clock are read from it. */
  readonly now?: () => Date;
  /** How long a sink may take before its attempt is given up. */
  readonly sinkTimeoutMs?: number;
  /** Whether a held offer is still offered; one that is not is left out of the digest. */
  readonly offers?: { stillOffered(offerId: string): boolean | Promise<boolean> };
}

export interface IOfferDeliveryInput {
  readonly offerId: string;
  /** The title the host verified; nothing else about the offer is ever sent. */
  readonly title: string;
  /** Where the offer came from; one source is pushed at most once per cooldown. */
  readonly sourceKey: string;
  /** What the person chose for offers: a push, or only the digest. */
  readonly mode: 'notify' | 'digest';
}

export class QuestionDelivery {
  private readonly options: IQuestionDeliveryOptions;
  private readonly now: () => Date;
  private readonly sinkTimeoutMs: number;
  /** Decisions, pushes and digests go one at a time, so two questions cannot both pass the same limit. */
  private readonly deliveries = serial();
  private readonly changes = serial();

  constructor(options: IQuestionDeliveryOptions) {
    this.options = options;
    this.now = options.now ?? (() => new Date());
    this.sinkTimeoutMs = options.sinkTimeoutMs ?? SINK_TIMEOUT_MS;
  }

  private async limits(): Promise<IDeliverySettings> {
    return (await this.options.settings.read()) ?? DEFAULT_DELIVERY_SETTINGS;
  }

  /** The counters for the local day of `at`: a new day starts the count over and keeps what is held. */
  private async load(at: Date): Promise<IDeliveryState> {
    const day = localDay(at);
    const stored = await this.options.state.read();
    if (stored === undefined) return { day, sent: 0, pendingDigest: [] };
    return stored.day === day ? stored : { ...stored, day, sent: 0 };
  }

  private async attempt(sink: IDeliverySink, message: IDeliveryMessage): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        sink.deliver(message),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('The sink did not answer in time')),
            this.sinkTimeoutMs,
          );
          timer.unref();
        }),
      ]);
      return true;
    } catch {
      // allow-fallback: one attempt only; the question is in the feed whether or not it was pushed.
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async sinks(): Promise<readonly IDeliverySink[]> {
    const { sinks } = this.options;
    if (typeof sinks !== 'function') return sinks;
    try {
      return await sinks();
    } catch {
      // allow-fallback: a sink list that cannot be read pushes nowhere; the question is in the feed.
      return [];
    }
  }

  /** Send to every sink, once; how many took it. */
  private async send(message: IDeliveryMessage): Promise<number> {
    const results = await Promise.all(
      (await this.sinks()).map((sink) => this.attempt(sink, message)),
    );
    return results.filter(Boolean).length;
  }

  /** The held questions that still wait for an answer; answered, withdrawn and vanished ones drop out. */
  private async stillOpen(ids: readonly string[]): Promise<IFeedItem[]> {
    const items = await Promise.all(ids.map((id) => this.options.feed.feedItem(id)));
    return items.filter((item): item is IFeedItem => item?.question?.state === 'open');
  }

  /**
   * A question was asked. It is pushed now, held for the digest or left alone as the person's limits
   * say; a push counts toward today's limit only when a sink took it.
   */
  onAsked(event: ICaseAskedEvent): Promise<void> {
    return this.deliveries(async () => {
      const now = this.now();
      const settings = await this.limits();
      const state = await this.load(now);
      const decision = decideDelivery({
        urgency: event.urgency,
        now,
        settings,
        sentToday: state.sent,
      });
      if (decision === 'feed') return;
      if (decision === 'digest') {
        const held = [...state.pendingDigest.filter((id) => id !== event.item.id), event.item.id];
        await this.options.state.write({
          ...state,
          pendingDigest: held.slice(-PENDING_DIGEST_MAX),
        });
        return;
      }
      const text = `${oneLine(event.item.title)}: ${oneLine(event.item.question?.text ?? '')}\n${FEED_POINTER}`;
      const title = oneLine(event.item.title, TITLE_LIMIT);
      if ((await this.send({ kind: 'question', title, text })) > 0)
        await this.options.state.write({ ...state, sent: state.sent + 1 });
    });
  }

  /** The offers held for the digest that are still offered; the others drop out. */
  private async stillOffered(held: readonly IPendingOffer[]): Promise<IPendingOffer[]> {
    const { offers } = this.options;
    if (offers === undefined) return [];
    const flags = await Promise.all(
      held.map(async ({ offerId }) => {
        try {
          return await offers.stillOffered(offerId);
        } catch {
          // allow-fallback: an offer that cannot be looked up is left out of the digest; it stays in the feed.
          return false;
        }
      }),
    );
    return held.filter((_offer, index) => flags[index]);
  }

  /**
   * An offer the person chose to receive. It shares the daily limit and quiet hours with questions, and
   * a source that had one pushed waits a day for the next, so a push is a decision only the person's
   * limits make. Held offers wait for the digest or stay in the feed. Resolves to what was done: `feed`
   * also when a push was due but no sink took it.
   */
  onOffer(input: IOfferDeliveryInput): Promise<TDelivery> {
    return this.deliveries(async () => {
      const now = this.now();
      const settings = await this.limits();
      const state = await this.load(now);
      const sourceKey = oneLine(input.sourceKey, SOURCE_KEY_LIMIT);
      const title = oneLine(input.title, TITLE_LIMIT);
      const last = Date.parse(state.offerSources?.[sourceKey] ?? '');
      const cooling = !Number.isNaN(last) && now.getTime() - last < OFFER_SOURCE_COOLDOWN_MS;
      const decision = decideDelivery({
        urgency: input.mode === 'notify' && !cooling ? 'now' : 'digest',
        now,
        settings,
        sentToday: state.sent,
      });
      if (decision === 'feed') return 'feed';
      if (decision === 'digest') {
        const held = [
          ...(state.pendingOffers ?? []).filter((offer) => offer.offerId !== input.offerId),
          { offerId: input.offerId, title },
        ];
        await this.options.state.write({
          ...state,
          pendingOffers: held.slice(-PENDING_DIGEST_MAX),
        });
        return 'digest';
      }
      const text = `Suggested: ${title}\n${OFFER_POINTER}`;
      if ((await this.send({ kind: 'offer', title, text })) === 0) return 'feed';
      const sources = Object.entries({ ...state.offerSources, [sourceKey]: now.toISOString() })
        .sort(([, a], [, b]) => Date.parse(a) - Date.parse(b))
        .slice(-OFFER_SOURCES_MAX);
      await this.options.state.write({
        ...state,
        sent: state.sent + 1,
        offerSources: Object.fromEntries(sources),
      });
      return 'notify';
    });
  }

  /**
   * Called every minute and once at start. Sends the day's one digest when its time has come, outside
   * quiet hours, and some held question still waits for an answer; then forgets what was held and
   * records the day, so a digest is attempted once a day.
   */
  tick(): Promise<void> {
    return this.deliveries(async () => {
      const now = this.now();
      const settings = await this.limits();
      if (!settings.digest.enabled) return;
      if (localMinutes(now) < minutesOf(settings.digest.at)) return;
      if (inQuietHours(settings.quietHours, now)) return;
      const state = await this.load(now);
      const day = localDay(now);
      if (state.digestedOn === day) return;
      const open = await this.stillOpen(state.pendingDigest);
      const offered = await this.stillOffered(state.pendingOffers ?? []);
      if (open.length === 0 && offered.length === 0) {
        if (state.pendingDigest.length > 0 || (state.pendingOffers ?? []).length > 0)
          await this.options.state.write({ ...state, pendingDigest: [], pendingOffers: [] });
        return;
      }
      const parts: string[] = [];
      const titles: string[] = [];
      if (open.length > 0) {
        const count = open.length;
        parts.push(
          `${count} question${count === 1 ? ' is' : 's are'} waiting for you:`,
          ...open.map((item) => `- ${oneLine(item.title)}`),
        );
        titles.push(`${count} question${count === 1 ? '' : 's'}`);
      }
      if (offered.length > 0) {
        const count = offered.length;
        parts.push(
          `${count} suggestion${count === 1 ? ' is' : 's are'} ready to look at:`,
          ...offered.map((offer) => `- ${oneLine(offer.title)}`),
        );
        titles.push(`${count} suggestion${count === 1 ? '' : 's'}`);
      }
      parts.push(open.length > 0 ? FEED_POINTER : OFFER_POINTER);
      await this.options.state.write({
        ...state,
        pendingDigest: [],
        pendingOffers: [],
        digestedOn: day,
      });
      await this.send({
        kind: 'digest',
        title: `${titles.join(' and ')} waiting for you`,
        text: parts.join('\n'),
      });
    });
  }

  /** The person's limits, how many pushes are used today, and how many questions and offers wait for the digest. */
  async status(): Promise<IDeliveryStatus> {
    const settings = await this.limits();
    const stored = await this.options.state.read();
    const sent = stored !== undefined && stored.day === localDay(this.now()) ? stored.sent : 0;
    const waiting = stored === undefined ? [] : await this.stillOpen(stored.pendingDigest);
    const offered = await this.stillOffered(stored?.pendingOffers ?? []);
    return {
      settings,
      today: { sent, limit: settings.dailyLimit },
      waitingInDigest: waiting.length,
      offersWaitingInDigest: offered.length,
    };
  }

  /**
   * Change the person's limits: only what the change names, refused whole when any part is not valid.
   * Only the person's own request reaches this; no tool does.
   */
  updateSettings(change: unknown): Promise<IDeliverySettings> {
    return this.changes(async () => {
      const next = applySettingsChange(await this.limits(), change);
      await this.options.settings.write(next);
      return next;
    });
  }

  /** Resolves when everything started so far has finished. */
  idle(): Promise<void> {
    return this.deliveries(async () => undefined);
  }
}
