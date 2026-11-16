/**
 * Delivery to the person's own browser while its page is closed: a Web Push message to each browser
 * they subscribed, which a worker in the page turns into a notification. It is one more sink under the
 * person's own limits; it decides nothing about what is sent.
 *
 * What is sent is what the other sinks send, as plain text on one line per part within a bound, plus
 * the page's own address for the click to open: never a link from content. Each browser gets one
 * attempt, which is judged by the egress policy like every other outbound request; a push service that
 * answers that the browser is gone (404 or 410) is forgotten, and any other failure leaves the browser
 * subscribed. The push counts only when some browser's push service took it; otherwise the sink throws
 * and the question stays in the feed, unspent against the day's limit.
 */
import { randomBytes } from 'node:crypto';

import { buildPushRequest } from './push-request.js';

import type { IDeliveryMessage, IDeliverySink } from '@robota-sdk/agent-product/personal';
import type { INotificationTransport } from '../notification-transport.js';
import type { IPushPayload } from './push-request.js';
import type { IPushSubscription, IPushSubscriptions } from './subscriptions.js';
import type { IVapid } from './vapid.js';

const TITLE_LIMIT = 100;
/** A notification shows a few lines; a message may be at most about 4 KB, so the text stays far below it. */
const TEXT_LIMIT = 500;
const PUSH_TIMEOUT_MS = 10_000;
/**
 * The Feed, as an address relative to the page the worker serves: the worker resolves it against its own
 * scope, which is the random path the page was served under, so the sink never needs to know that path.
 */
export const FEED_URL = './#feed';

/** One line of plain text within a bound: no line breaks, no control or invisible formatting characters. */
function oneLine(text: string, limit: number): string {
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

export interface IPushSinkOptions {
  readonly vapid: IVapid;
  readonly subscriptions: IPushSubscriptions;
  readonly transport: Pick<INotificationTransport, 'postBytes'>;
}

export function createPushSink(options: IPushSinkOptions): IDeliverySink {
  const { vapid, subscriptions, transport } = options;
  /** Whether this browser's push service took the message. */
  const sendTo = async (
    target: IPushSubscription,
    payload: IPushPayload,
    urgency: 'normal' | 'high',
  ): Promise<boolean> => {
    try {
      const request = buildPushRequest({
        subscription: target,
        payload,
        vapid: vapid.keys(),
        urgency,
      });
      const answer = await transport.postBytes({ ...request, timeoutMs: PUSH_TIMEOUT_MS });
      if ('refused' in answer) return false;
      if (answer.status >= 200 && answer.status <= 299) return true;
      if (answer.status === 404 || answer.status === 410) subscriptions.drop(target.endpoint);
      return false;
    } catch {
      // allow-fallback: one attempt per browser; a failure is not a push, and the question is in the feed.
      return false;
    }
  };
  return {
    id: 'push',
    deliver: async (message: IDeliveryMessage) => {
      const targets = subscriptions.list();
      if (targets.length === 0) throw new Error('No browser is subscribed');
      const payload: IPushPayload = {
        title: oneLine(message.title, TITLE_LIMIT),
        text: oneLine(message.text, TEXT_LIMIT),
        // A digest replaces the one still showing; every question stays until the person has seen it.
        tag:
          message.kind === 'digest'
            ? 'digest'
            : `${message.kind}-${randomBytes(6).toString('base64url')}`,
        url: FEED_URL,
      };
      const urgency = message.kind === 'question' ? 'high' : 'normal';
      const took = await Promise.all(targets.map((target) => sendTo(target, payload, urgency)));
      if (!took.includes(true)) throw new Error('No browser took the notification');
    },
  };
}
