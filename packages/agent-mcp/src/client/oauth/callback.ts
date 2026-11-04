/**
 * Where an OAuth sign-in's redirect lands, and how a pasted one is accepted.
 *
 * The listener is the host's: it answers one thing — `GET /callback` on `127.0.0.1` with the right
 * `Host` and the sign-in's own `state` — once, within a time limit, and then closes. Anything else
 * is refused without being consumed, so a page that merely guesses the port can neither end the
 * sign-in nor inject a code: the `Host` check stops a rebound hostname, and the `state`, compared in
 * constant time, is known only to this sign-in and the authorization server. A Node host injects
 * `loopbackOAuthCallbackListener` from `@robota-sdk/agent-mcp/node`; nothing here listens.
 *
 * The page it serves is static. An authorization server's `error_description` is never echoed —
 * into the page, an error or a log — because it is attacker-influenced text.
 *
 * Without a browser on this machine the user pastes the redirect URL instead, and the same rules
 * hold: it must be this sign-in's redirect URI, carry its `state`, and is accepted once. That path
 * needs no listener and lives here.
 */

import { constantTimeEqual } from '@robota-sdk/agent-core';

import { MCPOAuthError } from './errors.js';

export interface IMCPOAuthCallbackResult {
  readonly code: string;
  /** RFC 9207 issuer identifier, when the authorization server sent one. */
  readonly iss?: string;
}

export interface IMCPOAuthCallbackServer {
  readonly redirectUri: string;
  /**
   * Resolves with the one accepted redirect; rejects on an error redirect, timeout or cancel. The
   * time limit runs from the first call — once the user has the authorization page — since time
   * spent before that (a prompt asking whether to open the browser) is not spent waiting for it.
   */
  wait(): Promise<IMCPOAuthCallbackResult>;
  close(): Promise<void>;
}

export interface IMCPOAuthCallbackOptions {
  readonly expectedState: string;
  /** A pre-registered client's fixed port; otherwise the system picks one. */
  readonly port?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** The host's loopback listener: a place on this machine a browser's redirect can land. */
export interface IMCPOAuthCallbackListener {
  /** Starts listening for the one redirect; rejects with `callback-unavailable` when it cannot. */
  listen(options: IMCPOAuthCallbackOptions): Promise<IMCPOAuthCallbackServer>;
  /** A loopback port free right now, for a redirect URI nothing on this machine listens on. */
  freePort(): Promise<number>;
}

export const LOOPBACK_HOST = '127.0.0.1';
export const CALLBACK_PATH = '/callback';
/** How long a sign-in waits for its redirect. */
export const DEFAULT_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/** Whether a redirect's `state` is the sign-in's own, compared in constant time. */
export function stateMatches(received: string | null, expected: string): boolean {
  return received !== null && constantTimeEqual(received, expected);
}

/** What a redirect that carried the right `state` says: a code, or a refusal named by reason. */
export function redirectOutcome(params: URLSearchParams): IMCPOAuthCallbackResult | MCPOAuthError {
  const code = params.get('code');
  const iss = params.get('iss');
  if (params.has('error')) return new MCPOAuthError('authorization-denied');
  if (code === null || code === '') return new MCPOAuthError('callback-invalid');
  return { code, ...(iss === null ? {} : { iss }) };
}

/** The loopback redirect URI for `port`. */
export function loopbackRedirectUri(port: number): string {
  return `http://${LOOPBACK_HOST}:${port}${CALLBACK_PATH}`;
}

export interface IMCPOAuthPastedRedirect {
  /**
   * The code a pasted redirect URL carries. Throws `callback-invalid` for anything that is not this
   * sign-in's redirect URI with its `state`, or once a redirect has been accepted;
   * `authorization-denied` for an error redirect.
   */
  accept(pasted: string): IMCPOAuthCallbackResult;
}

/** The pasted counterpart of the loopback listener, for a browser on another machine. */
export function createPastedRedirectAcceptor(options: {
  readonly expectedState: string;
  readonly redirectUri: string;
}): IMCPOAuthPastedRedirect {
  let consumed = false;
  return {
    accept: (pasted) => {
      const text = pasted.trim();
      if (consumed || !URL.canParse(text)) throw new MCPOAuthError('callback-invalid');
      const url = new URL(text);
      if (
        `${url.origin}${url.pathname}` !== options.redirectUri ||
        url.username !== '' ||
        url.password !== '' ||
        !stateMatches(url.searchParams.get('state'), options.expectedState)
      ) {
        throw new MCPOAuthError('callback-invalid');
      }
      consumed = true;
      const outcome = redirectOutcome(url.searchParams);
      if (outcome instanceof MCPOAuthError) throw outcome;
      return outcome;
    },
  };
}
