/**
 * The loopback listener an OAuth sign-in redirects back to.
 *
 * It answers one thing — `GET /callback` on `127.0.0.1` with the right `Host` and the sign-in's own
 * `state` — once, within a time limit, and then closes. Anything else is refused without being
 * consumed, so a page that merely guesses the port can neither end the sign-in nor inject a code:
 * the `Host` check stops a rebound hostname, and the `state`, compared in constant time, is known
 * only to this sign-in and the authorization server.
 *
 * The page it serves is static. An authorization server's `error_description` is never echoed —
 * into the page, an error or a log — because it is attacker-influenced text.
 *
 * Without a browser on this machine the user pastes the redirect URL instead, and the same rules
 * hold: it must be this sign-in's redirect URI, carry its `state`, and is accepted once.
 */

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { MCPOAuthError } from './errors.js';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IMCPOAuthCallbackResult {
  readonly code: string;
  /** RFC 9207 issuer identifier, when the authorization server sent one. */
  readonly iss?: string;
}

export interface IMCPOAuthCallbackServer {
  readonly redirectUri: string;
  /** Resolves with the one accepted redirect; rejects on an error redirect, timeout or cancel. */
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

const LOOPBACK = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  Connection: 'close',
};
const SIGNED_IN_PAGE =
  '<!doctype html><title>Signed in</title><p>Signed in. You can close this tab and return to Robota.</p>';
const FAILED_PAGE =
  '<!doctype html><title>Sign-in failed</title><p>Sign-in did not complete. Return to Robota for details.</p>';

function refuse(response: ServerResponse, status: number): void {
  response.writeHead(status, { ...PAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(status === 404 ? 'Not found' : 'Bad request');
}

function stateMatches(received: string | null, expected: string): boolean {
  if (received === null) return false;
  const a = Buffer.from(received, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What a redirect that carried the right `state` says: a code, or a refusal named by reason. */
function redirectOutcome(params: URLSearchParams): IMCPOAuthCallbackResult | MCPOAuthError {
  const code = params.get('code');
  const iss = params.get('iss');
  if (params.has('error')) return new MCPOAuthError('authorization-denied');
  if (code === null || code === '') return new MCPOAuthError('callback-invalid');
  return { code, ...(iss === null ? {} : { iss }) };
}

/** The loopback redirect URI for `port`. */
export function loopbackRedirectUri(port: number): string {
  return `http://${LOOPBACK}:${port}${CALLBACK_PATH}`;
}

/** A loopback port free right now, for a redirect URI nothing on this machine listens on. */
export async function freeLoopbackPort(): Promise<number> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, LOOPBACK, () => resolve());
    });
  } catch {
    throw new MCPOAuthError('callback-unavailable');
  }
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
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

export async function startOAuthCallbackServer(
  options: IMCPOAuthCallbackOptions,
): Promise<IMCPOAuthCallbackServer> {
  let settle: {
    resolve: (result: IMCPOAuthCallbackResult) => void;
    reject: (error: MCPOAuthError) => void;
  };
  const outcome = new Promise<IMCPOAuthCallbackResult>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Observed by `wait`; this keeps an outcome nobody waited for from going unhandled.
  outcome.catch(() => undefined);
  let consumed = false;
  let port = 0;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.headers.host !== `${LOOPBACK}:${port}`) return refuse(response, 400);
    const url = new URL(request.url ?? '/', `http://${LOOPBACK}:${port}`);
    if (url.pathname !== CALLBACK_PATH || consumed) return refuse(response, 404);
    if (request.method !== 'GET') return refuse(response, 405);
    if (!stateMatches(url.searchParams.get('state'), options.expectedState)) {
      return refuse(response, 400);
    }
    consumed = true;
    const result = redirectOutcome(url.searchParams);
    response.writeHead(result instanceof MCPOAuthError ? 400 : 200, PAGE_HEADERS);
    response.end(result instanceof MCPOAuthError ? FAILED_PAGE : SIGNED_IN_PAGE);
    response.once('finish', () => void close());
    if (result instanceof MCPOAuthError) settle.reject(result);
    else settle.resolve(result);
  });

  let closed: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closed ??= new Promise<void>((resolve) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      server.close(() => resolve());
      server.closeAllConnections();
    });
    return closed;
  };
  const fail = (reason: 'callback-timeout' | 'cancelled'): void => {
    settle.reject(new MCPOAuthError(reason));
    void close();
  };
  const onAbort = (): void => fail('cancelled');
  const timer = setTimeout(() => fail('callback-timeout'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, LOOPBACK, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch {
    clearTimeout(timer);
    throw new MCPOAuthError('callback-unavailable');
  }
  port = (server.address() as AddressInfo).port;
  if (options.signal?.aborted === true) fail('cancelled');
  else options.signal?.addEventListener('abort', onAbort, { once: true });

  return {
    redirectUri: loopbackRedirectUri(port),
    wait: () => outcome,
    close,
  };
}
