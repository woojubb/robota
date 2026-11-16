/**
 * How a notification reaches the address the person gave, and the push service of a browser they
 * subscribed: through the shared egress policy, which refuses loopback, private and metadata destinations
 * unless the owner named the host, pins the connection to the addresses it checked and never follows a
 * redirect for a POST. Every outcome is reported in words that name no address, because the address may
 * carry a token.
 */
import {
  openEgressExchange,
  postWithEgressPolicy,
  rejectDestination,
} from '@robota-sdk/agent-core/node';

import type {
  IEgressDeps,
  IEgressPolicy,
  TEgressLookup,
  TEgressRejectionReason,
} from '@robota-sdk/agent-core/node';
import type { IWebhookTransport, TWebhookAnswer } from '@robota-sdk/agent-product/personal';

/** What a push-to-phone or chat service answers is a few words; anything near this is not one. */
const ANSWER_LIMIT_BYTES = 64 * 1024;

const REFUSALS: Readonly<Record<TEgressRejectionReason, string>> = {
  unsupported_scheme: 'only https addresses are used',
  private_destination:
    'it is a loopback, private or link-local address, which is reached only when the owner names its host',
  metadata_host: 'it is a loopback or metadata host, which is reached only when the owner names it',
  unresolvable: 'its name does not resolve',
  redirect_limit: 'it answered with a redirect, which is never followed',
  redirect_without_location: 'it answered with a redirect, which is never followed',
  redirect_refused: 'it answered with a redirect, which is never followed',
  response_too_large: 'its answer was too large',
};

export interface INotificationTransportOptions {
  /** Exact hostnames that may be reached although they are loopback or private; the owner names them. */
  readonly allowedHosts?: readonly string[];
  /** Owner or test carrier and resolver: every request is still judged against the policy first. */
  readonly fetch?: typeof globalThis.fetch;
  readonly lookup?: TEgressLookup;
}

/** A request whose body is bytes, such as an encrypted push message. */
export interface IBinaryRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  /** The whole exchange is given up after this long. */
  readonly timeoutMs: number;
}

export interface INotificationTransport extends IWebhookTransport {
  /**
   * One POST of bytes under the same policy, with no redirect followed. Only the status of the answer
   * is looked at: its body is never read, so nothing the service sends back is kept or held in memory,
   * and the connection is closed as soon as the status is known.
   */
  postBytes(request: IBinaryRequest): Promise<TWebhookAnswer>;
}

export function createNotificationTransport(
  options: INotificationTransportOptions = {},
): INotificationTransport {
  const policy: IEgressPolicy =
    options.allowedHosts === undefined ? {} : { allowedHosts: [...options.allowedHosts] };
  const deps: IEgressDeps = {
    ...(options.fetch !== undefined && { fetch: options.fetch }),
    ...(options.lookup !== undefined && { lookup: options.lookup }),
  };
  return {
    admit: async (url) => {
      const rejection = await rejectDestination(url, policy, options.lookup);
      return rejection === undefined ? undefined : REFUSALS[rejection.reason];
    },
    post: async (request) => {
      const result = await postWithEgressPolicy(
        request.url,
        {
          headers: { ...request.headers },
          body: request.body,
          timeoutMs: request.timeoutMs,
          maxResponseBytes: ANSWER_LIMIT_BYTES,
        },
        policy,
        deps,
      );
      return result.ok ? { status: result.status } : { refused: REFUSALS[result.rejection.reason] };
    },
    postBytes: async (request) => {
      // The shared POST helper takes text; the exchange it is built on takes any body, so the same
      // policy is applied here and a redirect is refused the same way.
      const signal = AbortSignal.timeout(request.timeoutMs);
      const exchange = await openEgressExchange(
        new URL(request.url),
        {
          method: 'POST',
          headers: { ...request.headers },
          // A copy that owns its memory, which is what a request body is typed to be.
          body: new Uint8Array(request.body),
          signal,
          redirect: 'manual',
        },
        policy,
        deps,
        signal,
      );
      if (!('response' in exchange)) return { refused: REFUSALS[exchange.reason] };
      try {
        const { status } = exchange.response;
        return status >= 300 && status < 400 ? { refused: REFUSALS.redirect_refused } : { status };
      } finally {
        await exchange.close();
      }
    },
  };
}
