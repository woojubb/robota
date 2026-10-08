import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';

import { describe, expect, it, vi } from 'vitest';

import { acquireOpenRouterKey, OpenRouterOAuthError } from '../openrouter-oauth.js';

function callback(authorization: URL, code = 'synthetic-authorization-code'): URL {
  const url = new URL(authorization.searchParams.get('callback_url') ?? '');
  url.searchParams.set('code', code);
  url.searchParams.set('state', authorization.searchParams.get('state') ?? '');
  return url;
}

function visit(url: URL, method = 'GET'): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method, agent: false }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        text += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, text }));
    });
    request.on('error', reject);
    request.end();
  });
}

function browser() {
  let opened!: (url: URL) => void;
  const authorization = new Promise<URL>((resolve) => {
    opened = resolve;
  });
  return {
    authorization,
    openBrowser: vi.fn(async (url: URL) => {
      opened(url);
    }),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function expectClosed(authorization: URL): Promise<void> {
  await expect(visit(callback(authorization))).rejects.toMatchObject({ code: 'ECONNREFUSED' });
}

describe('OpenRouter browser key acquisition', () => {
  it('completes the documented S256 callback exchange and closes its loopback listener', async () => {
    let authorization!: URL;
    const progress: string[] = [];
    const exchange = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://openrouter.ai/api/v1/auth/keys');
      expect(init).toMatchObject({ method: 'POST', redirect: 'error' });
      expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      expect(body.code).toBe('synthetic-authorization-code');
      expect(body.code_challenge_method).toBe('S256');
      expect(body.code_verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
      expect(createHash('sha256').update(body.code_verifier!).digest('base64url')).toBe(
        authorization.searchParams.get('code_challenge'),
      );
      return json({ key: 'synthetic-openrouter-key' });
    });
    const result = acquireOpenRouterKey({
      fetch: exchange as typeof globalThis.fetch,
      keyLabel: 'Robota test connection',
      onProgress: (stage) => {
        progress.push(stage);
      },
      openBrowser: async (url) => {
        authorization = url;
        expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
        expect(url.searchParams.get('key_label')).toBe('Robota test connection');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        const redirect = callback(url);
        expect(redirect.hostname).toBe('localhost');
        expect(redirect.protocol).toBe('http:');
        expect(redirect.pathname).toMatch(/^\/openrouter\/[A-Za-z0-9_-]{43}$/);
        const response = await visit(redirect);
        expect(response.status).toBe(200);
        expect(response.text).not.toContain('synthetic-authorization-code');
      },
    });
    await expect(result).resolves.toBe('synthetic-openrouter-key');
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(progress).toEqual(['waiting-for-browser', 'exchanging-code']);
    await expectClosed(authorization);
  });

  it('ignores wrong path, method, state, and duplicate fields without consuming the attempt', async () => {
    const launched = browser();
    const exchange = vi.fn(async () => json({ key: 'synthetic-key' }));
    const result = acquireOpenRouterKey({
      ...launched,
      fetch: exchange as typeof globalThis.fetch,
    });
    const authorization = await launched.authorization;
    const wrongPath = callback(authorization);
    wrongPath.pathname = '/other-attempt';
    expect((await visit(wrongPath)).status).toBe(404);
    expect((await visit(callback(authorization), 'POST')).status).toBe(405);
    const wrongState = callback(authorization);
    wrongState.searchParams.set('state', 'wrong-state');
    expect((await visit(wrongState)).status).toBe(400);
    wrongState.searchParams.set('state', '한'.repeat(43));
    expect((await visit(wrongState)).status).toBe(400);
    const duplicates = callback(authorization);
    duplicates.searchParams.append('code', 'another-code');
    expect((await visit(duplicates)).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect((await visit(callback(authorization))).status).toBe(200);
    await expect(result).resolves.toBe('synthetic-key');
    await expectClosed(authorization);
  });

  it('rejects a replay while the first code exchange is still pending', async () => {
    const launched = browser();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exchange = vi.fn(async () => {
      await pending;
      return json({ key: 'synthetic-key' });
    });
    const result = acquireOpenRouterKey({
      ...launched,
      fetch: exchange as typeof globalThis.fetch,
    });
    const authorization = await launched.authorization;
    expect((await visit(callback(authorization))).status).toBe(200);
    expect((await visit(callback(authorization))).status).toBe(409);
    expect(exchange).toHaveBeenCalledTimes(1);
    release();
    await expect(result).resolves.toBe('synthetic-key');
    await expectClosed(authorization);
  });

  it('accepts documented denial without state only on its opaque attempt path', async () => {
    const launched = browser();
    const exchange = vi.fn(async () => json({ key: 'synthetic-key' }));
    const result = acquireOpenRouterKey({
      ...launched,
      fetch: exchange as typeof globalThis.fetch,
    });
    const rejected = expect(result).rejects.toMatchObject({ reason: 'denied' });
    const authorization = await launched.authorization;
    const denial = new URL(authorization.searchParams.get('callback_url') ?? '');
    denial.searchParams.set('error', 'access_denied');
    denial.searchParams.set('error_description', 'synthetic-sensitive-server-description');
    const wrongPath = new URL(denial);
    wrongPath.pathname = '/unknown';
    expect((await visit(wrongPath)).status).toBe(404);
    const wrongState = new URL(denial);
    wrongState.searchParams.set('state', 'wrong-state');
    expect((await visit(wrongState)).status).toBe(400);
    const response = await visit(denial);
    expect(response.status).toBe(200);
    expect(response.text).not.toContain('synthetic-sensitive-server-description');
    await rejected;
    expect(exchange).not.toHaveBeenCalled();
    await expectClosed(authorization);
  });

  it('times out and closes the callback even when a browser opener never settles', async () => {
    const launched = browser();
    const result = acquireOpenRouterKey({
      timeoutMs: 50,
      openBrowser: async (url) => {
        await launched.openBrowser(url);
        await new Promise<void>(() => undefined);
      },
    });
    const rejected = expect(result).rejects.toMatchObject({ reason: 'timeout' });
    const authorization = await launched.authorization;
    await rejected;
    await expectClosed(authorization);
  });

  it('cancels an active attempt and closes the callback while the browser stays open', async () => {
    const launched = browser();
    const controller = new AbortController();
    const result = acquireOpenRouterKey({ ...launched, signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ reason: 'cancelled' });
    const authorization = await launched.authorization;
    controller.abort(new Error('synthetic-sensitive-abort-reason'));
    await rejected;
    await expectClosed(authorization);
  });

  it('does not launch or fetch when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const openBrowser = vi.fn(async () => undefined);
    const exchange = vi.fn(async () => json({ key: 'synthetic-key' }));
    await expect(
      acquireOpenRouterKey({
        signal: controller.signal,
        openBrowser,
        fetch: exchange as typeof globalThis.fetch,
      }),
    ).rejects.toMatchObject({ reason: 'cancelled' });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('destroys partial callback connections on cancellation', async () => {
    const launched = browser();
    const controller = new AbortController();
    const result = acquireOpenRouterKey({ ...launched, signal: controller.signal });
    const rejected = expect(result).rejects.toMatchObject({ reason: 'cancelled' });
    const authorization = await launched.authorization;
    const redirect = callback(authorization);
    const socket = connect(Number(redirect.port), redirect.hostname);
    const closed = new Promise<void>((resolve) => {
      socket.once('close', () => {
        resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => {
        resolve();
      });
      socket.once('error', reject);
    });
    socket.write('GET /unfinished');
    controller.abort();
    await rejected;
    await closed;
    await expectClosed(authorization);
  });

  it('discards a late key after cancellation even when injected fetch ignores abort', async () => {
    const launched = browser();
    const controller = new AbortController();
    let release!: () => void;
    let exchanging!: () => void;
    let networkSignal: AbortSignal | null | undefined;
    const started = new Promise<void>((resolve) => {
      exchanging = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const exchange = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      networkSignal = init?.signal;
      exchanging();
      await pending;
      return json({ key: 'synthetic-late-key' });
    });
    const result = acquireOpenRouterKey({
      ...launched,
      signal: controller.signal,
      fetch: exchange as typeof globalThis.fetch,
    });
    const rejected = expect(result).rejects.toMatchObject({ reason: 'cancelled' });
    const authorization = await launched.authorization;
    await visit(callback(authorization));
    await started;
    controller.abort();
    await rejected;
    expect(networkSignal?.aborted).toBe(true);
    await expectClosed(authorization);
    release();
  });

  it('sanitizes browser-launch failures and releases its loopback callback', async () => {
    let authorization!: URL;
    const result = acquireOpenRouterKey({
      openBrowser: async (url) => {
        authorization = url;
        throw new Error('synthetic-code synthetic-key synthetic-verifier');
      },
    });
    await expect(result).rejects.toMatchObject({
      reason: 'browser-failed',
      message: 'The browser could not be opened. Choose API key to connect OpenRouter.',
    });
    await expectClosed(authorization);
  });

  it.each(['http-error', 'network-error', 'invalid-json', 'missing-key', 'unsafe-key'] as const)(
    'sanitizes %s exchange failure and does not retry key issuance',
    async (kind) => {
      const launched = browser();
      const exchange = vi.fn(async () => {
        if (kind === 'network-error')
          throw new Error('synthetic-key synthetic-code synthetic-verifier');
        if (kind === 'invalid-json') return new Response('synthetic-key synthetic-code');
        if (kind === 'missing-key') return json({ error_description: 'synthetic-key' });
        if (kind === 'unsafe-key') return json({ key: 'synthetic-key\nunsafe' });
        return json({ error: 'synthetic-key synthetic-code' }, 403);
      });
      const result = acquireOpenRouterKey({
        ...launched,
        fetch: exchange as typeof globalThis.fetch,
      });
      const rejected = expect(result).rejects.toMatchObject({
        reason: 'exchange-failed',
        message:
          'OpenRouter could not finish issuing the key. Start a new connection or choose API key.',
      });
      const authorization = await launched.authorization;
      await visit(callback(authorization));
      await rejected;
      expect(exchange).toHaveBeenCalledTimes(1);
      await expectClosed(authorization);
    },
  );

  it('keeps concurrent attempts isolated with fresh verifier, state, path, and listener', async () => {
    const firstBrowser = browser();
    const secondBrowser = browser();
    const exchange = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, string>;
      return json({ key: `synthetic-key-${body.code}` });
    });
    const first = acquireOpenRouterKey({
      ...firstBrowser,
      fetch: exchange as typeof globalThis.fetch,
    });
    const second = acquireOpenRouterKey({
      ...secondBrowser,
      fetch: exchange as typeof globalThis.fetch,
    });
    const [firstAuth, secondAuth] = await Promise.all([
      firstBrowser.authorization,
      secondBrowser.authorization,
    ]);
    expect(firstAuth.searchParams.get('state')).not.toBe(secondAuth.searchParams.get('state'));
    expect(firstAuth.searchParams.get('code_challenge')).not.toBe(
      secondAuth.searchParams.get('code_challenge'),
    );
    const firstCallback = callback(firstAuth, 'first');
    const secondCallback = callback(secondAuth, 'second');
    expect(firstCallback.pathname).not.toBe(secondCallback.pathname);
    expect(firstCallback.port).not.toBe(secondCallback.port);
    const crossed = new URL(firstCallback);
    crossed.searchParams.set('state', secondAuth.searchParams.get('state') ?? '');
    expect((await visit(crossed)).status).toBe(400);
    await Promise.all([visit(firstCallback), visit(secondCallback)]);
    await expect(first).resolves.toBe('synthetic-key-first');
    await expect(second).resolves.toBe('synthetic-key-second');
    expect(exchange).toHaveBeenCalledTimes(2);
    await Promise.all([expectClosed(firstAuth), expectClosed(secondAuth)]);
  });

  it('rejects unsafe authentication endpoint configuration without launching the browser', async () => {
    const openBrowser = vi.fn(async () => undefined);
    await expect(
      acquireOpenRouterKey({ openBrowser, authorizationUrl: 'http://example.test/auth' }),
    ).rejects.toBeInstanceOf(OpenRouterOAuthError);
    expect(openBrowser).not.toHaveBeenCalled();
  });
});
