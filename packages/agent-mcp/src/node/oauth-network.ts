/**
 * The Node host's network for OAuth: every request goes through the shared egress policy of
 * `@robota-sdk/agent-core/node` — destinations judged by resolved address, redirects of a GET
 * re-judged hop by hop, a POST never redirected — and every response is capped while it streams.
 */

import { fetchWithEgressPolicy, postWithEgressPolicy } from '@robota-sdk/agent-core/node';

import type { IMCPOAuthNetwork, TMCPOAuthResponse } from '../client/oauth/network.js';
import type { IEgressPolicy, TEgressFetchResult, TEgressLookup } from '@robota-sdk/agent-core/node';

/** Where OAuth requests may go, and the seams tests use instead of the network. */
export interface INodeOAuthNetworkOptions {
  readonly policy?: IEgressPolicy;
  readonly lookup?: TEgressLookup;
  readonly fetch?: typeof globalThis.fetch;
}

function answer(result: TEgressFetchResult): TMCPOAuthResponse {
  return result.ok
    ? {
        ok: true,
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
        body: result.body,
      }
    : { ok: false };
}

export function createNodeOAuthNetwork(options: INodeOAuthNetworkOptions = {}): IMCPOAuthNetwork {
  const deps = {
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
  };
  return {
    get: async (url, request) => answer(await fetchWithEgressPolicy(url, request, options.policy, deps)),
    post: async (url, request) =>
      answer(await postWithEgressPolicy(url, request, options.policy, deps)),
  };
}
