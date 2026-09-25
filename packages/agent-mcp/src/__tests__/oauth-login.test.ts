/**
 * Signing in: dynamic registration or a pre-registered client, PKCE, `state`, the RFC 9207 `iss`
 * check, the resource indicator, a token POST that never follows a redirect — and a loopback
 * callback that accepts exactly one well-formed redirect.
 */

import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startOAuthCallbackServer } from '../client/oauth/callback.js';
import { MCPOAuthError } from '../client/oauth/errors.js';
import { runMCPOAuthLogin } from '../client/oauth/login.js';
import { createFileOAuthRefreshLock } from '../client/oauth/refresh-lock.js';
import { createFileOAuthCredentialStore, oauthCredentialKey } from '../client/oauth/store.js';
import {
  AS_URL,
  MCP_URL,
  SECRET_DESCRIPTION,
  createFakeOAuthServer,
} from './fixtures/fake-oauth-server.js';

import type { IMCPOAuthConfig } from '../definition/types.js';
import type { IFakeOAuthServer } from './fixtures/fake-oauth-server.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'robota-oauth-'));
  directories.push(directory);
  return join(directory, 'mcp-credentials');
}

/** A raw loopback request, so the Host header and method are exactly what the test says. */
function rawRequest(
  url: string,
  options: { method?: string; host?: string } = {},
): Promise<{ status: number; body: string }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? target.host },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

function login(
  server: IFakeOAuthServer,
  options: {
    config?: IMCPOAuthConfig;
    clientSecret?: string;
    browse?: (url: URL) => URL;
    directory?: string;
  } = {},
) {
  const directory = options.directory ?? temporaryDirectory();
  const store = createFileOAuthCredentialStore(directory);
  const opened: URL[] = [];
  const fileLock = createFileOAuthRefreshLock(directory);
  const locked: string[] = [];
  const result = runMCPOAuthLogin({
    lock: {
      withLock: (key, critical, signal) => {
        locked.push(key.serverUrl);
        return fileLock.withLock(key, critical, signal);
      },
    },
    securityIdentity: 'identity-1',
    serverUrl: MCP_URL,
    config: options.config ?? {},
    ...(options.clientSecret === undefined ? {} : { clientSecret: options.clientSecret }),
    store,
    network: { fetch: server.fetch, lookup: server.lookup },
    callbackTimeoutMs: 5_000,
    openBrowser: async (url) => {
      opened.push(url);
      const redirect = (options.browse ?? server.approve)(url);
      // The browser follows the redirect on its own; the sign-in does not wait on it.
      void rawRequest(redirect.href).catch(() => undefined);
    },
  });
  return { result, store, opened, directory, locked };
}

async function failure(promise: Promise<unknown>): Promise<MCPOAuthError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MCPOAuthError);
  return error as MCPOAuthError;
}

describe('OAuth sign-in', () => {
  it('registers, authorizes with PKCE, state and resource, and stores a bearer credential', async () => {
    const server = createFakeOAuthServer();
    const { result, store, opened, directory, locked } = login(server);
    await expect(result).resolves.toMatchObject({ issuer: AS_URL });
    // Stored under the refresh lock, so a refresh in flight cannot overwrite the new sign-in.
    expect(locked).toEqual([MCP_URL]);

    const authorization = opened[0]!;
    expect(authorization.protocol).toBe('https:');
    expect(authorization.searchParams.get('client_id')).toBe('dynamic-client');
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('resource')).toBe(MCP_URL);
    expect(authorization.searchParams.get('state')?.length).toBeGreaterThanOrEqual(43);
    expect(authorization.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
    );

    const token = server.requests.find((request) => request.url.endsWith('/token'))!;
    expect(new URLSearchParams(token.body).get('resource')).toBe(MCP_URL);
    const stored = await store.get(oauthCredentialKey('identity-1', MCP_URL));
    expect(stored).toMatchObject({
      issuer: AS_URL,
      tokenEndpoint: 'https://auth.example.test/token',
      clientId: 'dynamic-client',
      tokenEndpointAuthMethod: 'none',
      accessToken: expect.stringMatching(/^at-/),
      refreshToken: expect.stringMatching(/^rt-/),
      resource: MCP_URL,
    });
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
    }
  });

  it('a second sign-in state differs from the first', async () => {
    const server = createFakeOAuthServer();
    const first = login(server);
    await first.result;
    const second = login(server);
    await second.result;
    expect(first.opened[0]!.searchParams.get('state')).not.toBe(
      second.opened[0]!.searchParams.get('state'),
    );
  });

  it('uses a pre-registered client on its fixed port, and keeps its secret with the tokens', async () => {
    const server = createFakeOAuthServer();
    const port = 40_000 + Math.floor(Math.random() * 20_000);
    const { result, store, opened } = login(server, {
      config: { clientId: 'robota-cli', callbackPort: port },
      clientSecret: 'client-secret-value',
    });
    await result;
    expect(opened[0]!.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`);
    expect(server.requests.some((request) => request.url.endsWith('/register'))).toBe(false);
    const token = server.requests.find((request) => request.url.endsWith('/token'))!;
    expect(token.headers.get('authorization')).toMatch(/^Basic /);
    const stored = await store.get(oauthCredentialKey('identity-1', MCP_URL));
    expect(stored).toMatchObject({ clientId: 'robota-cli', clientSecret: 'client-secret-value' });
  });

  it('refuses a client secret for a dynamically registered client', async () => {
    const server = createFakeOAuthServer();
    const error = await failure(login(server, { clientSecret: 'client-secret-value' }).result);
    expect(error.reason).toBe('client-secret-without-client-id');
  });

  it('refuses a redirect whose iss names another issuer, or lacks a promised one', async () => {
    const server = createFakeOAuthServer();
    server.overrides.issParameter = 'other';
    expect((await failure(login(server).result)).reason).toBe('issuer-parameter-mismatch');
    server.overrides.issParameter = 'omit';
    expect((await failure(login(server).result)).reason).toBe('issuer-parameter-mismatch');
    expect(server.tokenCalls()).toBe(0);
    server.overrides.promisesIss = false;
    await expect(login(server).result).resolves.toMatchObject({ issuer: AS_URL });
  });

  it('counts the time limit from when the authorization page was handed over', async () => {
    const server = createFakeOAuthServer();
    const directory = temporaryDirectory();
    const result = runMCPOAuthLogin({
      securityIdentity: 'identity-1',
      serverUrl: MCP_URL,
      config: {},
      store: createFileOAuthCredentialStore(directory),
      lock: createFileOAuthRefreshLock(directory),
      network: { fetch: server.fetch, lookup: server.lookup },
      callbackTimeoutMs: 150,
      openBrowser: async (url) => {
        // The user took longer than the whole limit to answer before the browser opened.
        await new Promise((resolve) => setTimeout(resolve, 300));
        const redirect = server.approve(url);
        setTimeout(() => void rawRequest(redirect.href).catch(() => undefined), 50);
      },
    });
    await expect(result).resolves.toMatchObject({ issuer: AS_URL });
  });

  it('never follows a redirect from the token endpoint', async () => {
    const server = createFakeOAuthServer();
    server.overrides.tokenRedirect = 'https://evil.example.test/steal';
    const error = await failure(login(server).result);
    expect(error.reason).toBe('egress-refused');
    expect(server.requests.some((request) => request.url.includes('evil'))).toBe(false);
  });

  it('reports a denied sign-in without the server-supplied description', async () => {
    const server = createFakeOAuthServer();
    const error = await failure(login(server, { browse: server.deny }).result);
    expect(error.reason).toBe('authorization-denied');
    expect(error.message).not.toContain(SECRET_DESCRIPTION);
  });

  it('names failures without codes, tokens or secrets', async () => {
    const server = createFakeOAuthServer();
    const { result } = login(server, {
      browse: (url) => {
        const redirect = server.approve(url);
        redirect.searchParams.set('code', 'stolen-code-value');
        return redirect;
      },
    });
    const error = await failure(result);
    expect(error.reason).toBe('token-exchange-failed');
    expect(`${error.message} ${String(error.stack)}`).not.toMatch(
      /stolen-code-value|leaked-secret|verifier/,
    );
  });
});

describe('OAuth callback listener', () => {
  it('accepts only GET /callback with the right Host and state, once', async () => {
    const callback = await startOAuthCallbackServer({ expectedState: 'expected-state' });
    const base = callback.redirectUri;
    const port = new URL(base).port;
    try {
      expect(
        (await rawRequest(`${base}?code=c&state=expected-state`, { host: `localhost:${port}` }))
          .status,
      ).toBe(400);
      expect(
        (await rawRequest(`${base}?code=c&state=expected-state`, { host: `evil.test:${port}` }))
          .status,
      ).toBe(400);
      expect((await rawRequest(base.replace('/callback', '/other'))).status).toBe(404);
      expect(
        (await rawRequest(`${base}?code=c&state=expected-state`, { method: 'POST' })).status,
      ).toBe(405);
      expect((await rawRequest(`${base}?code=c&state=wrong-state`)).status).toBe(400);
      expect((await rawRequest(`${base}?code=c`)).status).toBe(400);

      const accepted = await rawRequest(`${base}?code=the-code&state=expected-state&iss=x`);
      expect(accepted.status).toBe(200);
      expect(accepted.body).not.toContain('the-code');
      await expect(callback.wait()).resolves.toEqual({ code: 'the-code', iss: 'x' });
      // Single use: the listener is gone once it has answered.
      await expect(rawRequest(`${base}?code=again&state=expected-state`)).rejects.toThrow();
    } finally {
      await callback.close();
    }
  });

  it('never echoes error_description into the page', async () => {
    const callback = await startOAuthCallbackServer({ expectedState: 's' });
    const waited = callback.wait().catch((error: unknown) => error);
    const page = await rawRequest(
      `${callback.redirectUri}?state=s&error=access_denied&error_description=${encodeURIComponent(`<b>${SECRET_DESCRIPTION}</b>`)}`,
    );
    expect(page.body).not.toContain(SECRET_DESCRIPTION);
    expect(page.body).not.toContain('access_denied');
    expect(await waited).toMatchObject({ reason: 'authorization-denied' });
    await callback.close();
  });

  it('gives up after its time limit', async () => {
    const callback = await startOAuthCallbackServer({ expectedState: 's', timeoutMs: 30 });
    const error = await callback.wait().catch((caught: unknown) => caught);
    expect(error).toMatchObject({ reason: 'callback-timeout' });
    await expect(rawRequest(`${callback.redirectUri}?state=s&code=c`)).rejects.toThrow();
  });

  it('refuses a port it cannot listen on', async () => {
    const first = await startOAuthCallbackServer({ expectedState: 's' });
    const port = Number(new URL(first.redirectUri).port);
    const error = await startOAuthCallbackServer({ expectedState: 's', port }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({ reason: 'callback-unavailable' });
    await first.close();
  });
});
