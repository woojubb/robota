/**
 * The OAuth authenticator and what it stands on: an identity-and-URL-keyed owner-only store, one
 * refresh at a time in a process and across processes, a 401 that refreshes once, and failures
 * that ask for a new sign-in or name a missing scope — never a token.
 */

import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createOAuthAuthenticator } from '../client/oauth/authenticator.js';
import { MCPOAuthError } from '../client/oauth/errors.js';
import { createFileOAuthRefreshLock } from '../client/oauth/refresh-lock.js';
import {
  createFileOAuthCredentialStore,
  credentialKeyDigest,
  oauthCredentialKey,
} from '../client/oauth/store.js';
import { createStreamableHttpAdapter } from '../client/transport.js';
import { AS_URL, MCP_URL, createFakeOAuthServer } from './fixtures/fake-oauth-server.js';

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
  return { store, notices, authenticator, directory };
}

const request = { serverId: 'files', securityIdentity: 'identity-1', url: new URL(MCP_URL) };

async function failure(promise: Promise<unknown>): Promise<MCPOAuthError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MCPOAuthError);
  return error as MCPOAuthError;
}

describe('OAuth credential store', () => {
  it('keys a credential by security identity and canonical URL together', async () => {
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    await expect(store.get(KEY)).resolves.toMatchObject({ accessToken: 'at-initial' });
    // Same URL, another definition (a shadowing entry): nothing.
    await expect(store.get(oauthCredentialKey('identity-2', MCP_URL))).resolves.toBeUndefined();
    // Same definition, edited to another URL: nothing.
    await expect(
      store.get(oauthCredentialKey('identity-1', 'https://mcp.example.test/other')),
    ).resolves.toBeUndefined();
    // Spelling differences of one URL are one key.
    expect(oauthCredentialKey('identity-1', 'https://MCP.example.test:443/mcp#x')).toEqual(KEY);
    await store.delete(KEY);
    await expect(store.get(KEY)).resolves.toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('writes 0600 files in a 0700 directory', async () => {
    const directory = temporaryDirectory();
    await createFileOAuthCredentialStore(directory).set(KEY, credential());
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    for (const name of readdirSync(directory)) {
      expect(statSync(join(directory, name)).mode & 0o777).toBe(0o600);
    }
  });

  it('refuses a record written for another key instead of reading it', async () => {
    const directory = temporaryDirectory();
    const store = createFileOAuthCredentialStore(directory);
    await store.set(KEY, credential());
    const other = oauthCredentialKey('identity-2', MCP_URL);
    const path = join(directory, `${credentialKeyDigest(other)}.json`);
    const copied = JSON.stringify({ version: 1, key: KEY, credential: credential() });
    writeFileSync(path, copied, { mode: 0o600 });
    const error = await failure(store.get(other));
    expect(error.reason).toBe('store-failed');
  });
});

describe('OAuth authenticator', () => {
  it('sends the stored token as a bearer credential without contacting anyone', async () => {
    const server = createFakeOAuthServer();
    const { store, authenticator } = setup(server);
    await store.set(KEY, credential());
    await expect(authorize(authenticator)).resolves.toEqual({ Authorization: 'Bearer at-initial' });
    expect(server.requests).toHaveLength(0);
  });

  it('refreshes an expired token once for many concurrent requests', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const { store, authenticator } = setup(server);
    await store.set(KEY, credential({ expiresAt: NOW - 1 }));
    const all = await Promise.all(Array.from({ length: 8 }, () => authorize(authenticator)));
    expect(new Set(all.map((headers) => headers['Authorization']))).toEqual(
      new Set(['Bearer at-1']),
    );
    expect(server.tokenCalls('refresh_token')).toBe(1);
    const token = server.requests.find((r) => r.url.endsWith('/token'))!;
    expect(new URLSearchParams(token.body).get('resource')).toBe(MCP_URL);
    await expect(store.get(KEY)).resolves.toMatchObject({ refreshToken: 'rt-1' });
  });

  it('refreshes once across two store readers sharing the lock', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const directory = temporaryDirectory();
    const first = setup(server, directory);
    const second = setup(server, directory);
    await first.store.set(KEY, credential({ expiresAt: NOW - 1 }));
    const [a, b] = await Promise.all([
      authorize(first.authenticator),
      authorize(second.authenticator),
    ]);
    expect(a).toEqual({ Authorization: 'Bearer at-1' });
    expect(b).toEqual({ Authorization: 'Bearer at-1' });
    // A rotating refresh token spent twice would have signed the user out.
    expect(server.tokenCalls('refresh_token')).toBe(1);
    expect(first.notices).toEqual([]);
    expect(second.notices).toEqual([]);
  });

  it('replaces a cached token once it expires, without waiting for a 401', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    let clock = NOW;
    const { store, authenticator } = setup(server, temporaryDirectory(), () => clock);
    await store.set(KEY, credential({ expiresAt: NOW + 120_000 }));
    expect(await authorize(authenticator)).toEqual({ Authorization: 'Bearer at-initial' });
    clock = NOW + 120_000;
    expect(await authorize(authenticator)).toEqual({ Authorization: 'Bearer at-1' });
    expect(server.tokenCalls('refresh_token')).toBe(1);
  });

  it('refreshes with the client authentication registration settled on', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const { store, authenticator } = setup(server);
    await store.set(
      KEY,
      credential({
        expiresAt: NOW - 1,
        clientSecret: 'cs-value',
        tokenEndpointAuthMethod: 'client_secret_post',
      }),
    );
    await authorize(authenticator);
    const refresh = server.requests.find((r) => r.url.endsWith('/token'))!;
    // Without the stored method a secret would go as HTTP Basic.
    expect(refresh.headers.get('authorization')).toBeNull();
    expect(new URLSearchParams(refresh.body).get('client_secret')).toBe('cs-value');
  });

  it('refreshes only at the endpoint stored with the tokens', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    server.overrides.tokenEndpoint = 'https://auth.example.test/elsewhere';
    const { store, authenticator } = setup(server);
    await store.set(KEY, credential({ expiresAt: NOW - 1 }));
    await authorize(authenticator);
    expect(server.requests.map((r) => r.url)).toEqual(['https://auth.example.test/token']);
  });

  it('answers a 401 with one refresh, then retries with the new token', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const { store, authenticator } = setup(server);
    await store.set(KEY, credential());
    const sent: string[] = [];
    let status = 401;
    const mcpFetch = (async (_input: unknown, init?: RequestInit) => {
      sent.push(new Headers(init?.headers).get('authorization') ?? '');
      const answer = status;
      status = 202;
      return new Response(null, {
        status: answer,
        ...(answer === 401
          ? { headers: { 'www-authenticate': 'Bearer error="invalid_token"' } }
          : {}),
      });
    }) as typeof globalThis.fetch;
    const adapter = createStreamableHttpAdapter({ lookup: server.lookup, fetch: mcpFetch });
    const admitted = await adapter.admit({
      url: MCP_URL,
      authenticationRequired: true,
      authentication: { serverId: 'files', securityIdentity: 'identity-1', authenticator },
    });
    if (!admitted.ok) throw new Error(admitted.reason);
    const transport = adapter.construct(admitted.admitted);
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(sent).toEqual(['Bearer at-initial', 'Bearer at-1']);
    expect(server.tokenCalls('refresh_token')).toBe(1);
    await transport.close();
  });

  it('many 401s for one token cost one refresh', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const { store, authenticator } = setup(server);
    await store.set(KEY, credential());
    const sent = await Promise.all(Array.from({ length: 5 }, () => authorize(authenticator)));
    const answers = await Promise.all(
      sent.map((authorization) => authenticator.onRejected({ status: 401, authorization })),
    );
    expect(answers).toEqual(Array(5).fill('retry'));
    const again = await Promise.all(Array.from({ length: 5 }, () => authorize(authenticator)));
    expect(new Set(again.map((headers) => headers['Authorization']))).toEqual(
      new Set(['Bearer at-1']),
    );
    expect(server.tokenCalls('refresh_token')).toBe(1);
  });

  it('clears the tokens and asks for a sign-in on invalid_grant', async () => {
    const server = createFakeOAuthServer();
    const { store, authenticator, notices } = setup(server);
    await store.set(KEY, credential({ expiresAt: NOW - 1, refreshToken: 'rt-revoked' }));
    const error = await failure(authorize(authenticator));
    expect(error.reason).toBe('login-required');
    await expect(store.get(KEY)).resolves.toBeUndefined();
    expect(notices).toEqual([{ kind: 'login-required', serverId: 'files' }]);
    // Asked once, not on every request.
    await failure(authorize(authenticator));
    expect(notices).toHaveLength(1);
  });

  it('asks for a sign-in when nothing is stored', async () => {
    const server = createFakeOAuthServer();
    const { authenticator, notices } = setup(server);
    expect((await failure(authorize(authenticator))).reason).toBe('login-required');
    expect(notices).toEqual([{ kind: 'login-required', serverId: 'files' }]);
    expect(server.requests).toHaveLength(0);
  });

  it('fails a 403 insufficient_scope and names the scope', async () => {
    const server = createFakeOAuthServer();
    const { store, authenticator, notices } = setup(server);
    await store.set(KEY, credential());
    const authorization = await authorize(authenticator);
    const answer = await authenticator.onRejected({
      status: 403,
      wwwAuthenticate: 'Bearer error="insufficient_scope", scope="files:write files:admin"',
      authorization,
    });
    expect(answer).toBe('fail');
    expect(notices).toEqual([
      { kind: 'insufficient-scope', serverId: 'files', scope: 'files:write files:admin' },
    ]);
    expect(server.tokenCalls()).toBe(0);
  });

  it('forces a new sign-in when rediscovery finds another authorization server', async () => {
    const server = createFakeOAuthServer();
    server.validRefreshTokens.add('rt-initial');
    const { store, authenticator, notices } = setup(server);
    await store.set(KEY, credential());
    const authorization = await authorize(authenticator);
    server.overrides.authorizationServers = ['https://other-auth.example.test/'];
    expect(await authenticator.onRejected({ status: 401, authorization })).toBe('retry');
    expect((await failure(authorize(authenticator))).reason).toBe('login-required');
    expect(server.tokenCalls()).toBe(0);
    await expect(store.get(KEY)).resolves.toBeUndefined();
    expect(notices).toEqual([{ kind: 'login-required', serverId: 'files' }]);
  });

  it('keeps a sign-in made after the 401 when the authorization server moved to it', async () => {
    const server = createFakeOAuthServer();
    const directory = temporaryDirectory();
    const fresh = credential({
      issuer: 'https://other-auth.example.test/',
      tokenEndpoint: 'https://other-auth.example.test/token',
      accessToken: 'at-fresh-login',
    });
    // The user signs in again, against the new server, while rediscovery is on the network —
    // after the authenticator's first read of the store, before the one under the lock.
    const signIn = createFileOAuthCredentialStore(directory);
    const fetch = (async (input: string | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://other-auth.example.test/.well-known/')) {
        await signIn.set(KEY, fresh);
      }
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    const { store, authenticator, notices } = setup({ ...server, fetch }, directory);
    await store.set(KEY, credential());
    const authorization = await authorize(authenticator);
    server.overrides.authorizationServers = ['https://other-auth.example.test/'];
    expect(await authenticator.onRejected({ status: 401, authorization })).toBe('retry');
    expect(await authorize(authenticator)).toEqual({ Authorization: 'Bearer at-fresh-login' });
    await expect(store.get(KEY)).resolves.toMatchObject({ accessToken: 'at-fresh-login' });
    expect(notices).toEqual([]);
  });

  it('keeps tokens and secrets out of every error and notice', async () => {
    const server = createFakeOAuthServer();
    const { store, authenticator, notices } = setup(server);
    await store.set(
      KEY,
      credential({ expiresAt: NOW - 1, refreshToken: 'rt-secret', clientSecret: 'cs-secret' }),
    );
    const error = await failure(authorize(authenticator));
    const text = `${error.message} ${String(error.stack)} ${JSON.stringify(notices)}`;
    expect(text).not.toMatch(/rt-secret|cs-secret|at-initial|leaked-secret/);
  });
});

function authorize(
  authenticator: ReturnType<typeof createOAuthAuthenticator>,
): Promise<Readonly<Record<string, string>>> {
  return authenticator.authorize(request);
}

describe('OAuth refresh lock', () => {
  const lockPath = (directory: string): string =>
    join(directory, `${credentialKeyDigest(KEY)}.lock`);

  it('takes over a stale lock, but never a fresh one that replaced it meanwhile', async () => {
    const directory = temporaryDirectory();
    const path = lockPath(directory);
    await createFileOAuthRefreshLock(directory).withLock(KEY, async () => undefined);
    writeFileSync(path, 'dead-holder');
    const old = new Date(Date.now() - 600_000);
    utimesSync(path, old, old);

    // Exactly between judging the lock stale and moving it, another process takes it over and
    // holds a fresh lock of its own under the same name.
    let interleaved = false;
    const lock = createFileOAuthRefreshLock(directory, {
      staleMs: 60_000,
      timeoutMs: 150,
      pollMs: 5,
      fs: {
        rename: (from, to) => {
          if (!interleaved && from === path) {
            interleaved = true;
            unlinkSync(path);
            writeFileSync(path, 'live-holder');
          }
          renameSync(from, to);
        },
      },
    });
    let ran = false;
    const error = await lock
      .withLock(KEY, async () => {
        ran = true;
      })
      .catch((caught: unknown) => caught);
    expect(interleaved).toBe(true);
    expect(error).toMatchObject({ reason: 'lock-timeout' });
    expect(ran).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('live-holder');
    expect(readdirSync(directory).filter((name) => name.includes('.aside'))).toEqual([]);

    // Without interference, the same stale lock is taken over.
    writeFileSync(path, 'dead-holder');
    utimesSync(path, old, old);
    await expect(
      createFileOAuthRefreshLock(directory, { pollMs: 5 }).withLock(KEY, async () => 'ran'),
    ).resolves.toBe('ran');
  });

  it('releases only its own lock', async () => {
    const directory = temporaryDirectory();
    const path = lockPath(directory);
    await createFileOAuthRefreshLock(directory).withLock(KEY, async () => {
      // Taken over while running (it was judged stale) and now held by another process.
      writeFileSync(path, 'other-holder');
    });
    expect(readFileSync(path, 'utf8')).toBe('other-holder');

    // The same, exactly between the holder confirming the lock is its own and removing it.
    let releasing = false;
    let interleaved = false;
    await createFileOAuthRefreshLock(directory, {
      staleMs: 0,
      fs: {
        rename: (from, to) => {
          if (releasing && !interleaved && from === path) {
            interleaved = true;
            unlinkSync(path);
            writeFileSync(path, 'next-holder');
          }
          renameSync(from, to);
        },
      },
    }).withLock(KEY, async () => {
      releasing = true;
    });
    expect(interleaved).toBe(true);
    expect(readFileSync(path, 'utf8')).toBe('next-holder');
  });
});
