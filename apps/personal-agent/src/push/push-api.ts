/**
 * The push part of the personal API: the page asks for the public key it subscribes with, tells the
 * agent which browser subscribed, and says when it stops. Status answers contain a count and, when
 * asked about one browser, whether it is kept; they never repeat a push address or its keys.
 */
import { DeliveryRefusedError } from '@robota-sdk/agent-product/personal';

import type { ILoopbackGuiApiRequest, ILoopbackGuiApiResponse } from '@robota-sdk/agent-local-host';
import type { IPushSubscriptions } from './subscriptions.js';
import type { IVapid } from './vapid.js';

export interface IPushApiOptions {
  readonly vapid: IVapid;
  readonly subscriptions: IPushSubscriptions;
}

/** Answers the push routes, or `undefined` for a request that is not one of them. */
export type TPushApi = (
  request: ILoopbackGuiApiRequest,
) => Promise<ILoopbackGuiApiResponse | undefined>;

const ok = (body: unknown): ILoopbackGuiApiResponse => ({ status: 200, body });

export function createPushApi(options: IPushApiOptions): TPushApi {
  const { vapid, subscriptions } = options;
  const status = () => ({ subscribed: subscriptions.count(), supported: true });
  return async ({ method, segments, body }) => {
    const [area, collection, extra] = segments;
    if (area !== 'push' || extra !== undefined) return undefined;
    if (collection === undefined && method === 'GET') return ok(status());
    if (collection === 'status' && method === 'POST') {
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        throw new DeliveryRefusedError('Name the browser to check');
      return ok({
        ...status(),
        current: subscriptions.has((body as Record<string, unknown>)['endpoint']),
      });
    }
    if (collection === 'key' && method === 'GET') return ok({ publicKey: vapid.keys().publicKey });
    if (collection === 'subscribe' && method === 'POST') {
      // A subscription belongs to the key it was made with, so the key exists before one is kept: a key
      // made after it would find the subscription bound to nothing and forget it.
      vapid.keys();
      await subscriptions.add(body);
      return ok(status());
    }
    if (collection === 'subscribe' && method === 'DELETE') {
      if (typeof body !== 'object' || body === null || Array.isArray(body))
        throw new DeliveryRefusedError('Name the push address to stop');
      subscriptions.remove((body as Record<string, unknown>)['endpoint']);
      return ok(status());
    }
    if (collection === 'subscriptions' && method === 'DELETE') {
      subscriptions.clear();
      return ok(status());
    }
    return undefined;
  };
}
