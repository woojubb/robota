/**
 * The only way OAuth code reaches the network: every request goes through the shared egress
 * policy and every response is byte-bounded before anything parses it.
 *
 * A GET (metadata discovery) follows redirects the way the egress policy does, each hop
 * re-validated. A POST (registration, token exchange, refresh) never follows one: its body carries
 * an authorization code, a refresh token or a client secret, and a redirect would hand that to a
 * destination nobody checked.
 */

import { fetchWithEgressPolicy, postWithEgressPolicy } from '@robota-sdk/agent-core/node';

import { MCPOAuthError } from './errors.js';

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { IEgressPolicy, TEgressFetchResult, TEgressLookup } from '@robota-sdk/agent-core/node';

/** Where OAuth requests may go, and the seams tests use instead of the network. */
export interface IMCPOAuthNetwork {
  readonly policy?: IEgressPolicy;
  readonly lookup?: TEgressLookup;
  readonly fetch?: typeof globalThis.fetch;
}

/** Metadata and token documents are small; anything larger is not one. */
const MAX_OAUTH_RESPONSE_BYTES = 256 * 1024;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
/** Statuses a `Response` may not be constructed with a body for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function headerRecord(init: RequestInit | undefined): Record<string, string> {
  return Object.fromEntries(new Headers(init?.headers).entries());
}

function requestBody(init: RequestInit | undefined): string | URLSearchParams {
  const body = init?.body;
  if (body === undefined || body === null) return '';
  if (typeof body === 'string' || body instanceof URLSearchParams) return body;
  // The SDK sends a form or a JSON string; anything else is not an OAuth request of ours.
  throw new MCPOAuthError('response-invalid');
}

function toResponse(result: TEgressFetchResult): Response {
  if (!result.ok) throw new MCPOAuthError('egress-refused');
  const body = NULL_BODY_STATUSES.has(result.status) ? null : new TextDecoder().decode(result.body);
  return new Response(body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

/** A fetch for the SDK's OAuth helpers that enforces all of the above. */
export function createOAuthFetch(network: IMCPOAuthNetwork, signal?: AbortSignal): FetchLike {
  const deps = {
    ...(network.fetch === undefined ? {} : { fetch: network.fetch }),
    ...(network.lookup === undefined ? {} : { lookup: network.lookup }),
  };
  return async (url, init) => {
    const signals = [init?.signal, signal].filter(
      (s): s is AbortSignal => s instanceof AbortSignal,
    );
    const options = {
      headers: headerRecord(init),
      timeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_OAUTH_RESPONSE_BYTES,
      ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
    };
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') {
      return toResponse(await fetchWithEgressPolicy(String(url), options, network.policy, deps));
    }
    if (method !== 'POST') throw new MCPOAuthError('response-invalid');
    return toResponse(
      await postWithEgressPolicy(
        String(url),
        { ...options, body: requestBody(init) },
        network.policy,
        deps,
      ),
    );
  };
}
