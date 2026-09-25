/**
 * The rest of a sign-in's life: a redirect pasted from a browser on another machine, the state
 * `/mcp` shows, signing out with RFC 7009 revocation, and the refresh edge cases — a refresh token
 * rotated by someone else, and a short-lived token that must not refresh on every request.
 */

import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createOAuthAuthenticator } from '../client/oauth/authenticator.js';
import { createPastedRedirectAcceptor } from '../client/oauth/callback.js';
import { MCPOAuthError } from '../client/oauth/errors.js';
import { readMCPOAuthCredentialState, runMCPOAuthLogout } from '../client/oauth/lifecycle.js';
import { runMCPOAuthLogin } from '../client/oauth/login.js';
import { createFileOAuthRefreshLock } from '../client/oauth/refresh-lock.js';
import {
  createFileOAuthCredentialStore,
  credentialKeyDigest,
  oauthCredentialKey,
} from '../client/oauth/store.js';
import {
  AS_URL,
  MCP_URL,
  SECRET_DESCRIPTION,
  createFakeOAuthServer,
} from './fixtures/fake-oauth-server.js';

import type { TMCPOAuthNotice } from '../client/oauth/authenticator.js';
import type { IMCPOAuthCredential } from '../client/oauth/store.js';
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

const KEY = oauthCredentialKey('identity-1', MCP_URL);
const NOW = 1_000_000;

function credential(overrides: Partial<IMCPOAuthCredential> = {}): IMCPOAuthCredential {
  return {
    issuer: AS_URL,
    authorizationEndpoint: 'https://auth.example.test/authorize',
    tokenEndpoint: 'https://auth.example.test/token',
    resource: MCP_URL,
    clientId: 'dynamic-client',
    accessToken: 'at-initial',
    refreshToken: 'rt-initial',
    expiresAt: NOW + 3_600_000,
    ...overrides,
  };
}

async function failure(promise: Promise<unknown>): Promise<MCPOAuthError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MCPOAuthError);
  return error as MCPOAuthError;
}

function reachable(url: string): Promise<boolean> {
  const target = new URL(url);
  return new Promise((resolve) => {
    const request = httpRequest(
      { host: target.hostname, port: target.port, path: target.pathname },
      (response) => {
        response.resume();
        resolve(true);
      },
    );
    request.on('error', () => resolve(false));
    request.end();
  });
}

describe('a pasted redirect URL', () => {
  const REDIRECT_URI = 'http://127.0.0.1:45123/callback';
  const accept = (pasted: string) =>
    createPastedRedirectAcceptor({ expectedState: 'the-state', redirectUri: REDIRECT_URI }).accept(
      pasted,
    );
  const refusal = (pasted: string): unknown => {
    try {
      accept(pasted);
    } catch (error) {
      return error;
    }
    return undefined;
  };

  it('accepts the registered redirect URI with its state, surrounding whitespace aside', () => {
    expect(accept(`  ${REDIRECT_URI}?code=the-code&state=the-state&iss=x\n`)).toEqual({
      code: 'the-code',
      iss: 'x',
    });
  });

  it.each([
    ['another state', `${REDIRECT_URI}?code=c&state=other-state`],
    ['no state', `${REDIRECT_URI}?code=c`],
    ['another port', 'http://127.0.0.1:45124/callback?code=c&state=the-state'],
    ['another host', 'http://localhost:45123/callback?code=c&state=the-state'],
    ['another scheme', 'https://127.0.0.1:45123/callback?code=c&state=the-state'],
    ['another path', 'http://127.0.0.1:45123/other?code=c&state=the-state'],
    ['user info', 'http://user:pw@127.0.0.1:45123/callback?code=c&state=the-state'],
    ['no code', `${REDIRECT_URI}?state=the-state`],
    ['not a URL', 'the-code'],
  ])('refuses %s', (_name, pasted) => {
    expect(refusal(pasted)).toMatchObject({ reason: 'callback-invalid' });
  });

  it('reports an error redirect without its description', () => {
    const error = refusal(
      `${REDIRECT_URI}?state=the-state&error=access_denied&error_description=${encodeURIComponent(SECRET_DESCRIPTION)}`,
    );
    expect(error).toMatchObject({ reason: 'authorization-denied' });
    expect(String((error as Error).message)).not.toContain(SECRET_DESCRIPTION);
  });

  it('is accepted once', () => {
    const acceptor = createPastedRedirectAcceptor({
      expectedState: 'the-state',
      redirectUri: REDIRECT_URI,
    });
    const pasted = `${REDIRECT_URI}?code=c&state=the-state`;
    expect(acceptor.accept(pasted)).toEqual({ code: 'c' });
    expect(() => acceptor.accept(pasted)).toThrow(MCPOAuthError);
  });
});

describe('signing in with a pasted redirect', () => {
  function pastedLogin(server: IFakeOAuthServer, edit: (redirect: URL) => URL = (r) => r) {
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    const shown: { url: URL; redirectUri: string }[] = [];
    const result = runMCPOAuthLogin({
      securityIdentity: 'identity-1',
      serverUrl: MCP_URL,
      config: {},
      store,
      lock: createFileOAuthRefreshLock(directory),
      network: { fetch: server.fetch, lookup: server.lookup },
      openBrowser: async (url, redirectUri) => {
        shown.push({ url, redirectUri });
      },
      readRedirect: async () => {
        // Nothing listens on the redirect URI: the browser's page fails to load, and the user
        // copies its address instead.
        expect(await reachable(shown[0]!.redirectUri)).toBe(false);
        return edit(server.approve(shown[0]!.url)).href;
      },
    });
    return { result, store, shown };
  }

  it('exchanges the pasted code and stores the credential', async () => {
    const server = createFakeOAuthServer();
    const { result, store, shown } = pastedLogin(server);
    await expect(result).resolves.toMatchObject({ issuer: AS_URL });
    expect(shown[0]!.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(shown[0]!.url.searchParams.get('redirect_uri')).toBe(shown[0]!.redirectUri);
    await expect(store.get(KEY)).resolves.toMatchObject({ accessToken: expect.any(String) });
  });

  it('holds a pasted redirect to the issuer check', async () => {
    const server = createFakeOAuthServer();
    server.overrides.issParameter = 'other';
    const error = await failure(pastedLogin(server).result);
    expect(error.reason).toBe('issuer-parameter-mismatch');
    expect(server.tokenCalls()).toBe(0);
  });

  it('refuses a pasted redirect for another sign-in', async () => {
    const server = createFakeOAuthServer();
    const { result, store } = pastedLogin(server, (redirect) => {
      redirect.searchParams.set('state', 'forged-state');
      return redirect;
    });
    expect((await failure(result)).reason).toBe('callback-invalid');
    expect(server.tokenCalls()).toBe(0);
    await expect(store.get(KEY)).resolves.toBeUndefined();
  });
});

describe('sign-in state', () => {
  const state = (store: ReturnType<typeof createFileOAuthCredentialStore>) =>
    readMCPOAuthCredentialState({
      securityIdentity: 'identity-1',
      serverUrl: MCP_URL,
      store,
      now: () => NOW,
    });

  it('names each state and never a token', async () => {
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await expect(state(store)).resolves.toBe('signed-out');
    await store.set(KEY, credential());
    await expect(state(store)).resolves.toBe('signed-in');
    await store.set(KEY, credential({ expiresAt: NOW - 1 }));
    await expect(state(store)).resolves.toBe('expired-refreshable');
    await store.set(KEY, credential({ expiresAt: NOW - 1, refreshToken: undefined }));
    await expect(state(store)).resolves.toBe('sign-in-required');
    writeFileSync(join(directory, `${credentialKeyDigest(KEY)}.json`), 'not json');
    await expect(state(store)).resolves.toBe('sign-in-required');
  });
});

describe('signing out', () => {
  function logout(server: IFakeOAuthServer, directory: string) {
    const locked: string[] = [];
    const fileLock = createFileOAuthRefreshLock(directory);
    return {
      locked,
      result: runMCPOAuthLogout({
        securityIdentity: 'identity-1',
        serverUrl: MCP_URL,
        store: createFileOAuthCredentialStore(directory),
        lock: {
          withLock: (key, critical, signal) => {
            locked.push(key.serverUrl);
            return fileLock.withLock(key, critical, signal);
          },
        },
        network: { fetch: server.fetch, lookup: server.lookup },
      }),
    };
  }

  const revocations = (server: IFakeOAuthServer) =>
    server.requests.filter((request) => request.url === 'https://auth.example.test/revoke');

  it('deletes under the lock, then revokes the refresh token and the access token', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    const { result, locked } = logout(server, directory);
    await expect(result).resolves.toEqual({ removed: true, revocation: 'revoked' });
    expect(locked).toEqual([MCP_URL]);
    await expect(store.get(KEY)).resolves.toBeUndefined();

    const sent = revocations(server);
    expect(sent.map((request) => request.method)).toEqual(['POST', 'POST']);
    expect(sent.map((request) => Object.fromEntries(new URLSearchParams(request.body)))).toEqual([
      { token: 'rt-initial', token_type_hint: 'refresh_token', client_id: 'dynamic-client' },
      { token: 'at-initial', token_type_hint: 'access_token', client_id: 'dynamic-client' },
    ]);
    expect(sent[0]!.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(server.validRefreshTokens.has('rt-initial')).toBe(false);
  });

  it('authenticates a confidential client the way its refresh does', async () => {
    const server = createFakeOAuthServer();
    const directory = temporaryDirectory();
    await createFileOAuthCredentialStore(directory).set(
      KEY,
      credential({
        clientId: 'robota-cli',
        clientSecret: 'cs-value',
        tokenEndpointAuthMethods: ['none', 'client_secret_basic'],
      }),
    );
    await logout(server, directory).result;
    for (const request of revocations(server)) {
      expect(request.headers.get('authorization')).toBe(
        `Basic ${Buffer.from('robota-cli:cs-value').toString('base64')}`,
      );
      expect(new URLSearchParams(request.body).has('client_secret')).toBe(false);
    }
  });

  it('signs out locally even when revocation fails, and says so without its text', async () => {
    const server = createFakeOAuthServer();
    server.overrides.revocation = 'error';
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    const outcome = await logout(server, directory).result;
    expect(outcome).toEqual({
      removed: true,
      revocation: 'failed',
      revocationFailure: 'revocation-failed',
    });
    expect(JSON.stringify(outcome)).not.toMatch(/rt-initial|at-initial|leaked-secret/);
    await expect(store.get(KEY)).resolves.toBeUndefined();
  });

  it('never follows a redirect from the revocation endpoint', async () => {
    const server = createFakeOAuthServer();
    server.overrides.revocation = 'redirect';
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    await expect(logout(server, directory).result).resolves.toEqual({
      removed: true,
      revocation: 'failed',
      revocationFailure: 'egress-refused',
    });
    expect(server.requests.some((request) => request.url.includes('evil'))).toBe(false);
    await expect(store.get(KEY)).resolves.toBeUndefined();
  });

  it('signs out without revoking when the server offers no revocation', async () => {
    const server = createFakeOAuthServer();
    server.overrides.revocation = 'absent';
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    await expect(logout(server, directory).result).resolves.toEqual({
      removed: true,
      revocation: 'unsupported',
    });
    expect(revocations(server)).toEqual([]);
    await expect(store.get(KEY)).resolves.toBeUndefined();
  });

  it('removes an unreadable record, and reports when nothing was stored', async () => {
    const server = createFakeOAuthServer();
    const directory = temporaryDirectory();
    await expect(logout(server, directory).result).resolves.toEqual({
      removed: false,
      revocation: 'not-attempted',
    });
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    writeFileSync(join(directory, `${credentialKeyDigest(KEY)}.json`), 'not json');
    await expect(logout(server, directory).result).resolves.toEqual({
      removed: true,
      revocation: 'not-attempted',
    });
    await expect(store.get(KEY)).resolves.toBeUndefined();
    expect(server.requests).toEqual([]);
  });
});

describe('the authenticator across a sign-in lifetime', () => {
  function setup(
    server: IFakeOAuthServer,
    directory = temporaryDirectory(),
    now: () => number = () => NOW,
  ) {
    const store = createFileOAuthCredentialStore(directory);
    const notices: TMCPOAuthNotice[] = [];
    const authenticator = createOAuthAuthenticator({
      serverId: 'files',
      securityIdentity: 'identity-1',
      serverUrl: MCP_URL,
      config: {},
      store,
      lock: createFileOAuthRefreshLock(directory, { pollMs: 5 }),
      network: { fetch: server.fetch, lookup: server.lookup },
      notify: (notice) => notices.push(notice),
      now,
    });
    const authorize = () =>
      authenticator.authorize({
        serverId: 'files',
        securityIdentity: 'identity-1',
        url: new URL(MCP_URL),
      });
    return { store, notices, authenticator, authorize, directory };
  }

  it('keeps a refresh token another holder rotated in while its own was refused', async () => {
    const server = createFakeOAuthServer();
    const directory = temporaryDirectory();
    const rotated = credential({ accessToken: 'at-rotated', refreshToken: 'rt-rotated' });
    const other = createFileOAuthCredentialStore(directory);
    // A holder whose lock was taken over as stale rotates the token while this refresh is on the
    // network; the refresh token this one spent is then refused.
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).endsWith('/token')) await other.set(KEY, rotated);
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { store, notices, authorize } = setup({ ...server, fetch }, directory);
    await store.set(KEY, credential({ expiresAt: NOW - 1 }));
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-rotated' });
    await expect(store.get(KEY)).resolves.toMatchObject({ refreshToken: 'rt-rotated' });
    expect(notices).toEqual([]);
  });

  it('refreshes once with a rotated-in refresh token whose access token already expired', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-rotated');
    const directory = temporaryDirectory();
    const other = createFileOAuthCredentialStore(directory);
    let rotated = false;
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      if (!rotated && String(input).endsWith('/token')) {
        rotated = true;
        await other.set(
          KEY,
          credential({ accessToken: 'at-rotated', refreshToken: 'rt-rotated', expiresAt: NOW - 1 }),
        );
      }
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { store, notices, authorize } = setup({ ...server, fetch }, directory);
    await store.set(KEY, credential({ expiresAt: NOW - 1 }));
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-1' });
    expect(server.tokenCalls('refresh_token')).toBe(2);
    expect(notices).toEqual([]);
  });

  it('does not refresh a short-lived token before half its lifetime', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    let clock = NOW;
    const { store, authorize } = setup(server, temporaryDirectory(), () => clock);
    // A 60-second token and the default 60-second skew: without a cap, always "expired".
    await store.set(KEY, credential({ issuedAt: NOW, expiresAt: NOW + 60_000 }));
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-initial' });
    clock = NOW + 29_999;
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-initial' });
    expect(server.requests).toEqual([]);
    clock = NOW + 30_000;
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-1' });
    // The refreshed token records when it was issued, so its own lifetime caps its skew.
    await expect(store.get(KEY)).resolves.toMatchObject({ issuedAt: clock });
  });

  it('stops sending a cached token once told the user signed out', async () => {
    const server = createFakeOAuthServer();
    server.overrides.revocation = 'absent';
    const { store, authenticator, authorize, directory } = setup(server);
    await store.set(KEY, credential());
    await expect(authorize()).resolves.toEqual({ Authorization: 'Bearer at-initial' });
    await runMCPOAuthLogout({
      securityIdentity: 'identity-1',
      serverUrl: MCP_URL,
      store,
      lock: createFileOAuthRefreshLock(directory),
      network: { fetch: server.fetch, lookup: server.lookup },
    });
    authenticator.forget();
    expect((await failure(authorize())).reason).toBe('login-required');
  });
});
