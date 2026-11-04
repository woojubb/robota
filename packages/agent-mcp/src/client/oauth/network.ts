/**
 * The only way OAuth code reaches the network: every request goes through the host's egress, and
 * every response is byte-bounded by it before anything parses it.
 *
 * A GET (metadata discovery) may follow redirects, each hop judged again by the host. A POST
 * (registration, token exchange, refresh) never follows one: its body carries an authorization code,
 * a refresh token or a client secret, and a redirect would hand that to a destination nobody
 * checked.
 *
 * What the host's network does — resolving names, refusing private addresses, pinning the
 * connection — is the host's, not this package's: a Node host injects
 * `createNodeOAuthNetwork` from `@robota-sdk/agent-mcp/node`. Nothing here has a default, so a host
 * that gives none cannot sign in, refresh or sign out.
 */

import { MCPOAuthError } from './errors.js';

import type { FetchLike } from '@modelcontextprotocol/client';

/** What an OAuth request is held to; the host enforces each, and the caller never relaxes them. */
export interface IMCPOAuthRequestOptions {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  /** Deadline for the whole exchange, redirects and body included. */
  readonly timeoutMs: number;
  /** Byte cap on the response, enforced while it streams. */
  readonly maxResponseBytes: number;
}

/**
 * The answer, or a refusal: the host's egress refused a destination, a redirect or an oversized
 * response. A refusal carries no detail, because a URL or a message can name a credential.
 * Transport failures (DNS at connect, a refused connection, TLS, an abort) throw, as `fetch` throws.
 */
export type TMCPOAuthResponse =
  | {
      readonly ok: true;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Headers;
      readonly body: Uint8Array;
    }
  | { readonly ok: false };

/** The host's network for OAuth. */
export interface IMCPOAuthNetwork {
  /** One GET. Redirects are followed only as far as the host's egress allows, each hop judged again. */
  get(url: string, options: IMCPOAuthRequestOptions): Promise<TMCPOAuthResponse>;
  /** One POST. A redirect is refused, never followed. */
  post(
    url: string,
    options: IMCPOAuthRequestOptions & { readonly body: string | URLSearchParams },
  ): Promise<TMCPOAuthResponse>;
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

function toResponse(result: TMCPOAuthResponse): Response {
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
  return async (url, init) => {
    const signals = [init?.signal, signal].filter(
      (s): s is AbortSignal => s instanceof AbortSignal,
    );
    const options: IMCPOAuthRequestOptions = {
      headers: headerRecord(init),
      timeoutMs: OAUTH_REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_OAUTH_RESPONSE_BYTES,
      ...(signals.length === 0 ? {} : { signal: AbortSignal.any(signals) }),
    };
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') return toResponse(await network.get(String(url), options));
    if (method !== 'POST') throw new MCPOAuthError('response-invalid');
    return toResponse(await network.post(String(url), { ...options, body: requestBody(init) }));
  };
}
