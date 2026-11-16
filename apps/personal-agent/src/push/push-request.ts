/**
 * One push message as a request: the payload encrypted to the browser's own keys (RFC 8291, the
 * `aes128gcm` encoding) and the headers that sign it as this agent (RFC 8292, VAPID). `web-push` builds
 * both and is used for nothing else: it never opens a connection here, because every request leaves
 * through the shared egress policy instead of its own network layer.
 */
import webPush from 'web-push';

import { VAPID_SUBJECT } from './vapid.js';

import type { IPushSubscription } from './subscriptions.js';
import type { IVapidKeys } from './vapid.js';

/** What the worker in the page receives; plain text, and a path inside the page itself. */
export interface IPushPayload {
  readonly title: string;
  readonly text: string;
  readonly tag: string;
  readonly url: string;
}

export interface IPushRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
}

/** A push service holds an undelivered message this long, then drops it: a question is not stale at once. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;

export function buildPushRequest(input: {
  readonly subscription: IPushSubscription;
  readonly payload: IPushPayload;
  readonly vapid: IVapidKeys;
  readonly urgency: 'normal' | 'high';
}): IPushRequest {
  const details = webPush.generateRequestDetails(
    input.subscription,
    JSON.stringify(input.payload),
    {
      vapidDetails: { subject: VAPID_SUBJECT, ...input.vapid },
      TTL: PUSH_TTL_SECONDS,
      urgency: input.urgency,
      contentEncoding: 'aes128gcm',
    },
  );
  if (details.body === null) throw new Error('The push message came out empty');
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(details.headers)) {
    // The length is the body's own; the transport states it, so it is never stated twice.
    if (name.toLowerCase() !== 'content-length') headers[name] = String(value);
  }
  return { url: details.endpoint, headers, body: details.body };
}
