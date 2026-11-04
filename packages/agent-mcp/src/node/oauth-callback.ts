/**
 * The loopback listener an OAuth sign-in redirects back to: the Node implementation of the
 * listener port (`client/oauth/callback.ts`, which says what it answers and why).
 */

import { createServer } from 'node:http';

import {
  CALLBACK_PATH,
  DEFAULT_CALLBACK_TIMEOUT_MS,
  LOOPBACK_HOST,
  loopbackRedirectUri,
  redirectOutcome,
  stateMatches,
} from '../client/oauth/callback.js';
import { MCPOAuthError } from '../client/oauth/errors.js';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type {
  IMCPOAuthCallbackListener,
  IMCPOAuthCallbackOptions,
  IMCPOAuthCallbackResult,
  IMCPOAuthCallbackServer,
} from '../client/oauth/callback.js';

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  Connection: 'close',
};
const SIGNED_IN_PAGE =
  '<!doctype html><title>Signed in</title><p>Signed in. You can close this tab and return to the application.</p>';
const FAILED_PAGE =
  '<!doctype html><title>Sign-in failed</title><p>Sign-in did not complete. Return to the application for details.</p>';

function refuse(response: ServerResponse, status: number): void {
  response.writeHead(status, { ...PAGE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(status === 404 ? 'Not found' : 'Bad request');
}

/** A loopback port free right now, for a redirect URI nothing on this machine listens on. */
export async function freeLoopbackPort(): Promise<number> {
  const probe = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(0, LOOPBACK_HOST, () => resolve());
    });
  } catch {
    throw new MCPOAuthError('callback-unavailable');
  }
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
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
    if (request.headers.host !== `${LOOPBACK_HOST}:${port}`) return refuse(response, 400);
    const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}:${port}`);
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
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
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
    wait: () => {
      if (timer === undefined && closed === undefined) {
        timer = setTimeout(
          () => fail('callback-timeout'),
          options.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS,
        );
      }
      return outcome;
    },
    close,
  };
}

/** The listener a Node host injects into the sign-in: `127.0.0.1`, a port the system picks. */
export const loopbackOAuthCallbackListener: IMCPOAuthCallbackListener = {
  listen: startOAuthCallbackServer,
  freePort: freeLoopbackPort,
};
