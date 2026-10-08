import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { openInBrowser } from './browser-opener.js';

import type { Server, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

export type TOpenRouterOAuthProgress = 'waiting-for-browser' | 'exchanging-code';
export type TOpenRouterOAuthFailure =
  | 'cancelled'
  | 'timeout'
  | 'browser-failed'
  | 'callback-unavailable'
  | 'denied'
  | 'exchange-failed'
  | 'invalid-configuration';

const FAILURE_MESSAGES: Readonly<Record<TOpenRouterOAuthFailure, string>> = {
  cancelled: 'OpenRouter browser sign-in was cancelled.',
  timeout: 'OpenRouter browser sign-in timed out. Start a new connection or choose API key.',
  'browser-failed': 'The browser could not be opened. Choose API key to connect OpenRouter.',
  'callback-unavailable':
    'The local sign-in callback could not be started. Choose API key to connect OpenRouter.',
  denied: 'OpenRouter access was not approved. Start a new connection or choose API key.',
  'exchange-failed':
    'OpenRouter could not finish issuing the key. Start a new connection or choose API key.',
  'invalid-configuration':
    'OpenRouter browser sign-in is not configured correctly. Choose API key to connect OpenRouter.',
};

/** Only fixed host messages leave the OAuth engine; provider responses and secrets never do. */
export class OpenRouterOAuthError extends Error {
  constructor(readonly reason: TOpenRouterOAuthFailure) {
    super(FAILURE_MESSAGES[reason]);
    this.name = 'OpenRouterOAuthError';
  }
}

export interface IAcquireOpenRouterKeyOptions {
  readonly openBrowser?: (url: URL) => Promise<void>;
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly keyLabel?: string;
  readonly onProgress?: (stage: TOpenRouterOAuthProgress) => void;
  /** Host-owned injection points for synthetic authentication fixtures. */
  readonly authorizationUrl?: string;
  readonly exchangeUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const MAX_CALLBACK_LENGTH = 16_384;
const MAX_CODE_LENGTH = 8_192;

function authenticationEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OpenRouterOAuthError('invalid-configuration');
  }
  const localFixture =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if ((url.protocol !== 'https:' && !localFixture) || url.username || url.password || url.hash) {
    throw new OpenRouterOAuthError('invalid-configuration');
  }
  return url;
}

function stateMatches(actual: string | null, expected: string): boolean {
  if (actual === null) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function reply(response: ServerResponse, status: number, message: string): Promise<void> {
  response.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'",
    'Referrer-Policy': 'no-referrer',
    Connection: 'close',
  });
  return new Promise((resolve) => {
    const finished = (): void => {
      resolve();
    };
    response.once('close', finished);
    response.once('error', finished);
    response.end(message, finished);
  });
}

async function closeCallback(server: Server, sockets: ReadonlySet<Socket>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
    // close() stops acceptance first. Destroy partial requests as well as completed HTTP sockets.
    for (const socket of sockets) socket.destroy();
  });
}

/**
 * Acquire an ordinary OpenRouter key through a local PKCE callback. The caller owns key validation,
 * host storage and profile activation, and cancels this attempt when its session ends.
 */
export async function acquireOpenRouterKey(options: IAcquireOpenRouterKeyOptions): Promise<string> {
  if (options.signal?.aborted) throw new OpenRouterOAuthError('cancelled');
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new OpenRouterOAuthError('invalid-configuration');
  }
  const authorization = authenticationEndpoint(
    options.authorizationUrl ?? 'https://openrouter.ai/auth',
  );
  const exchangeUrl = authenticationEndpoint(
    options.exchangeUrl ?? 'https://openrouter.ai/api/v1/auth/keys',
  );
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const path = `/openrouter/${randomBytes(32).toString('base64url')}`;
  const controller = new AbortController();
  const fetchKey = options.fetch ?? globalThis.fetch;
  const sockets = new Set<Socket>();
  let callbackUrl: URL | undefined;
  let consumed = false;
  let settled = false;
  let resolveKey!: (key: string) => void;
  let rejectKey!: (error: OpenRouterOAuthError) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveKey = resolve;
    rejectKey = reject;
  });
  // A timeout can fire while the loopback socket is starting, before the main await is attached.
  void result.catch(() => undefined);
  const fail = (reason: TOpenRouterOAuthFailure): void => {
    if (settled) return;
    settled = true;
    controller.abort();
    rejectKey(new OpenRouterOAuthError(reason));
  };
  const abort = (): void => {
    fail('cancelled');
  };

  const exchange = async (code: string): Promise<void> => {
    try {
      if (controller.signal.aborted) return;
      options.onProgress?.('exchanging-code');
      const response = await fetchKey(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        fail('exchange-failed');
        return;
      }
      const payload: unknown = await response.json();
      if (settled || controller.signal.aborted) return;
      const key =
        typeof payload === 'object' && payload !== null && 'key' in payload
          ? payload.key
          : undefined;
      if (typeof key !== 'string' || key.length === 0 || /[\s\p{Cc}]/u.test(key)) {
        fail('exchange-failed');
        return;
      }
      settled = true;
      resolveKey(key);
    } catch {
      fail('exchange-failed');
    }
  };

  const server = createServer((request, response) => {
    const receive = async (): Promise<void> => {
      if (
        callbackUrl === undefined ||
        request.url === undefined ||
        request.url.length > MAX_CALLBACK_LENGTH
      ) {
        await reply(response, 400, 'Invalid sign-in callback.');
        return;
      }
      let url: URL;
      try {
        url = new URL(request.url, callbackUrl);
      } catch {
        await reply(response, 400, 'Invalid sign-in callback.');
        return;
      }
      if (
        url.origin !== callbackUrl.origin ||
        request.headers.host !== callbackUrl.host ||
        url.pathname !== path
      ) {
        await reply(response, 404, 'Sign-in callback not found.');
        return;
      }
      if (request.method !== 'GET') {
        await reply(response, 405, 'The sign-in callback requires GET.');
        return;
      }
      if (consumed || settled) {
        await reply(response, 409, 'This sign-in callback has already been used.');
        return;
      }
      const errors = url.searchParams.getAll('error');
      const codes = url.searchParams.getAll('code');
      const states = url.searchParams.getAll('state');
      if (
        errors.length === 1 &&
        errors[0] &&
        codes.length === 0 &&
        (states.length === 0 || (states.length === 1 && stateMatches(states[0] ?? null, state)))
      ) {
        // OpenRouter omits state on denial; the fresh, unguessable path still binds this attempt.
        consumed = true;
        await reply(
          response,
          200,
          'Access was not approved. Return to Robota to choose another connection method.',
        );
        fail('denied');
        return;
      }
      if (
        errors.length !== 0 ||
        codes.length !== 1 ||
        !codes[0] ||
        codes[0].length > MAX_CODE_LENGTH ||
        states.length !== 1 ||
        !stateMatches(states[0] ?? null, state)
      ) {
        await reply(response, 400, 'Invalid sign-in callback.');
        return;
      }
      consumed = true;
      await reply(
        response,
        200,
        'Sign-in response received. Return to Robota to finish connecting.',
      );
      await exchange(codes[0]);
    };
    void receive().catch(() => {
      fail('exchange-failed');
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });
  server.on('error', () => {
    fail('callback-unavailable');
  });
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    fail('timeout');
  }, timeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', () => {
        reject(new OpenRouterOAuthError('callback-unavailable'));
      });
      server.listen(0, 'localhost', () => {
        resolve();
      });
    });
    const address = server.address();
    if (
      address === null ||
      typeof address === 'string' ||
      (address.address !== '127.0.0.1' && address.address !== '::1')
    ) {
      throw new OpenRouterOAuthError('callback-unavailable');
    }
    callbackUrl = new URL(`http://localhost:${address.port}${path}`);
    if (!settled) {
      authorization.searchParams.set('callback_url', callbackUrl.href);
      authorization.searchParams.set(
        'code_challenge',
        createHash('sha256').update(verifier).digest('base64url'),
      );
      authorization.searchParams.set('code_challenge_method', 'S256');
      authorization.searchParams.set('state', state);
      authorization.searchParams.set('key_label', options.keyLabel ?? 'Robota');
      try {
        options.onProgress?.('waiting-for-browser');
        // Callback completion, timeout and cancellation must not wait for an opener process.
        const open = options.openBrowser ?? openInBrowser;
        void open(authorization).catch(() => {
          fail('browser-failed');
        });
      } catch {
        fail('browser-failed');
      }
    }
    const key = await result;
    if (options.signal?.aborted) throw new OpenRouterOAuthError('cancelled');
    return key;
  } catch (error) {
    if (error instanceof OpenRouterOAuthError) throw error;
    throw new OpenRouterOAuthError('callback-unavailable');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    controller.abort();
    await closeCallback(server, sockets);
  }
}
