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
import { PENDING_DIGEST_MAX } from './stores.js';

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
} from './types.js';

const TEXT_PART_LIMIT = 200;
const TITLE_LIMIT = 100;
const SINK_TIMEOUT_MS = 20_000;
const FEED_POINTER = 'Open your Feed to answer.';

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
      if (open.length === 0) {
        if (state.pendingDigest.length > 0)
          await this.options.state.write({ ...state, pendingDigest: [] });
        return;
      }
      const count = open.length;
      const text = [
        `${count} question${count === 1 ? ' is' : 's are'} waiting for you:`,
        ...open.map((item) => `- ${oneLine(item.title)}`),
        FEED_POINTER,
      ].join('\n');
      await this.options.state.write({ ...state, pendingDigest: [], digestedOn: day });
      await this.send({
        kind: 'digest',
        title: `${count} question${count === 1 ? '' : 's'} waiting for you`,
        text,
      });
    });
  }

  /** The person's limits, how many pushes are used today, and how many questions wait for the digest. */
  async status(): Promise<IDeliveryStatus> {
    const settings = await this.limits();
    const stored = await this.options.state.read();
    const sent = stored !== undefined && stored.day === localDay(this.now()) ? stored.sent : 0;
    const waiting = stored === undefined ? [] : await this.stillOpen(stored.pendingDigest);
    return {
      settings,
      today: { sent, limit: settings.dailyLimit },
      waitingInDigest: waiting.length,
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
