import { request } from 'node:http';

import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createAccessTokenVerifier } from '@robota-sdk/agent-transport/node';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { openExternalEventGrants } from '../external-event-grant-host.js';
import {
  createExternalEventHttpHost,
  validateExternalEventEndpoint,
} from '../external-event-http-host.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type {
  IAccessTokenVerifierConfig,
  IExternalEventGrant,
  TExternalEventAuditRecord,
} from '@robota-sdk/agent-interface-transport';
import type { CryptoKey, JWK } from 'jose';

const ISSUER = 'https://auth.example.com';
const PUBLIC = 'https://robota.example/hooks';
const HOST = 'robota.example';
const SCOPE = 'robota.events.submit';

let signing: { privateKey: CryptoKey; jwk: JWK };
let stranger: { privateKey: CryptoKey };

beforeAll(async () => {
  const pair = await generateKeyPair('ES256', { extractable: true });
  signing = {
    privateKey: pair.privateKey,
    jwk: { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' },
  };
  stranger = { privateKey: (await generateKeyPair('ES256')).privateKey };
});

function grant(
  grantId: string,
  client: string,
  rate?: IExternalEventGrant['rate'],
): IExternalEventGrant {
  return {
    grantId,
    verifier: {
      issuer: ISSUER,
      resource: `${PUBLIC}/events/${grantId}`,
      algorithms: ['ES256'],
      requiredScopes: [SCOPE],
      allowedClients: [client],
    },
    kinds: ['message'],
    ...(rate !== undefined ? { rate } : {}),
  };
}

function verifierFactory(config: IAccessTokenVerifierConfig) {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  return createAccessTokenVerifier(config, {
    fetch: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
        return json({ issuer: ISSUER, jwks_uri: `${ISSUER}/jwks.json` });
      }
      if (url === `${ISSUER}/jwks.json`) return json({ keys: [signing.jwk] });
      return new Response('', { status: 404 });
    }) as typeof fetch,
    lookup: async () => ['93.184.216.34'],
  });
}

async function mint(
  options: {
    grantId?: string;
    client?: string;
    scope?: string;
    typ?: string;
    exp?: number;
    key?: CryptoKey;
    audience?: string;
  } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: options.scope ?? SCOPE, client_id: options.client ?? 'ci-bot' })
    .setProtectedHeader({ alg: 'ES256', typ: options.typ ?? 'at+jwt', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(options.audience ?? `${PUBLIC}/events/${options.grantId ?? 'ci'}`)
    .setSubject('bot')
    .setJti(`jti-${Math.random().toString(36).slice(2)}`)
    .setIssuedAt(now)
    .setExpirationTime(now + (options.exp ?? 300))
    .sign(options.key ?? signing.privateKey);
}

interface IReply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

function send(
  port: number,
  options: {
    path?: string;
    method?: string;
    token?: string;
    body?: string;
    host?: string;
    origin?: string;
  } = {},
): Promise<IReply> {
  return new Promise((resolve, reject) => {
    const body =
      options.body ??
      JSON.stringify({ kind: 'message', conversationId: 'build-1', content: 'status' });
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/hooks/events/ci',
        method: options.method ?? 'POST',
        headers: {
          host: options.host ?? HOST,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(options.token !== undefined ? { authorization: `Bearer ${options.token}` } : {}),
          ...(options.origin !== undefined ? { origin: options.origin } : {}),
        },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        );
      },
    );
    req.on('error', reject);
    req.end(options.method === 'GET' ? undefined : body);
  });
}

function sendForwarded(port: number, forwardedFor: string): Promise<IReply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/hooks/events/ci',
        headers: {
          host: HOST,
          'content-length': 0,
          ...(forwardedFor !== '' ? { 'x-forwarded-for': forwardedFor } : {}),
        },
      },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: '' }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function start(
  grants: IExternalEventGrant[] = [grant('ci', 'ci-bot'), grant('chat', 'chat-bot')],
) {
  const chat = vi.fn(async (_messages: unknown, _options?: { toolChoice?: string }) => ({
    role: 'assistant',
    content: 'MODEL-OUTPUT',
    timestamp: new Date(),
  }));
  const session = new InteractiveSession({
    cwd: process.cwd(),
    provider: {
      name: 'mock',
      version: '1',
      chat,
      generateResponse: vi.fn(),
    } as unknown as IAIProvider,
    bare: true,
    externalEventVerifierFactory: verifierFactory,
  });
  const grantHost = await openExternalEventGrants(session, grants);
  const audit: TExternalEventAuditRecord[] = [];
  const http = createExternalEventHttpHost({
    grants,
    receive: (grantId, delivery) => grantHost.receive(grantId, delivery),
    countRefusal: (grantId, refusal) => grantHost.countRefusal(grantId, refusal),
    port: 0,
    audit: (record) => audit.push(record),
  });
  const { port } = await http.start();
  cleanups.push(async () => {
    await http.stop();
    grantHost.close();
    await session.shutdown();
  });
  return { port, audit, grantHost, chat };
}

describe('external event HTTPS endpoint', () => {
  it('admits a verified event with a 202 receipt that holds only the turn id', async () => {
    const { port, chat } = await start();
    const reply = await send(port, { token: await mint() });
    expect(reply.status).toBe(202);
    expect(Object.keys(JSON.parse(reply.body))).toEqual(['turnId']);
    expect(reply.body).not.toContain('MODEL-OUTPUT');
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(chat.mock.calls[0]?.[1]?.toolChoice).toBe('none');
  });

  it('answers a missing or invalid token with an empty 401 and only the challenge', async () => {
    const { port } = await start();
    const metadata = `https://robota.example/.well-known/oauth-protected-resource/hooks/events/ci`;
    const missing = await send(port);
    expect(missing).toMatchObject({ status: 401, body: '' });
    expect(missing.headers['www-authenticate']).toBe(`Bearer resource_metadata="${metadata}"`);
    for (const token of [
      await mint({ key: stranger.privateKey }),
      await mint({ exp: -120 }),
      await mint({ typ: 'JWT' }),
      await mint({ client: 'someone-else' }),
      await mint({ grantId: 'chat', client: 'ci-bot' }),
      'not-a-token',
    ]) {
      const reply = await send(port, { token });
      expect(reply).toMatchObject({ status: 401, body: '' });
      expect(reply.headers['www-authenticate']).toBe(
        `Bearer error="invalid_token", resource_metadata="${metadata}"`,
      );
    }
  });

  it('binds a token to its grant: a token for one grant is refused at another', async () => {
    const { port } = await start();
    const reply = await send(port, {
      path: '/hooks/events/chat',
      token: await mint({ grantId: 'ci', client: 'chat-bot' }),
    });
    expect(reply).toMatchObject({ status: 401, body: '' });
    expect(reply.headers['www-authenticate']).toContain('/hooks/events/chat"');
  });

  it('answers a token without the scope with 403 insufficient_scope', async () => {
    const { port } = await start();
    const reply = await send(port, { token: await mint({ scope: 'other' }) });
    expect(reply).toMatchObject({ status: 403, body: '' });
    expect(reply.headers['www-authenticate']).toContain(
      `error="insufficient_scope", scope="${SCOPE}"`,
    );
  });

  it('refuses an unknown grant, a revoked grant, an oversize body and a malformed event', async () => {
    const { port, grantHost } = await start();
    expect(await send(port, { path: '/hooks/events/nope', token: await mint() })).toMatchObject({
      status: 404,
      body: '',
    });
    expect(
      await send(port, { token: await mint(), body: 'x'.repeat(16 * 1024 + 1) }),
    ).toMatchObject({
      status: 413,
      body: '',
    });
    expect(await send(port, { token: await mint(), body: '{not json' })).toMatchObject({
      status: 400,
      body: '',
    });
    expect(
      await send(port, {
        token: await mint(),
        body: JSON.stringify({ kind: 'command', conversationId: 'a', content: 'b' }),
      }),
    ).toMatchObject({ status: 400, body: '' });
    grantHost.revoke('ci');
    expect(await send(port, { token: await mint() })).toMatchObject({ status: 403, body: '' });
  });

  it('tells a revoked grant apart only to a caller holding a valid token for it', async () => {
    const { port, grantHost, audit } = await start();
    const answers = async () => {
      const missing = await send(port);
      const invalid = await send(port, { token: await mint({ key: stranger.privateKey }) });
      const otherGrant = await send(port, {
        token: await mint({ grantId: 'chat', client: 'chat-bot' }),
      });
      return [missing, invalid, otherGrant].map(({ status, body, headers }) => ({
        status,
        body,
        challenge: headers['www-authenticate'],
      }));
    };
    const live = await answers();
    grantHost.revoke('ci');
    expect(await answers()).toEqual(live);
    expect(live.map((answer) => answer.status)).toEqual([401, 401, 401]);
    expect(await send(port, { token: await mint() })).toMatchObject({ status: 403, body: '' });
    // The owner's trail still names what happened.
    expect(audit.at(-1)).toMatchObject({ grantId: 'ci', refusal: 'grant-revoked' });
    expect(audit.slice(3, 6).map((record) => 'refusal' in record && record.refusal)).toEqual([
      'missing-token',
      'bad-signature',
      'wrong-audience',
    ]);
  });

  it('counts the refusals the endpoint decides against the grant it addressed', async () => {
    const { port, grantHost } = await start();
    await send(port);
    await send(port, { token: await mint(), body: 'x'.repeat(16 * 1024 + 1) });
    await send(port, { path: '/hooks/events/nope', token: await mint() });
    expect(grantHost.list().find((row) => row.grantId === 'ci')?.counters.refused).toEqual({
      'missing-token': 1,
      oversize: 1,
    });
    expect(grantHost.list().find((row) => row.grantId === 'chat')?.counters.refused).toEqual({});
  });

  it('holds the grant rate: over the limit is 429 before the queue', async () => {
    const { port, chat } = await start([
      grant('ci', 'ci-bot', [{ windowMs: 60_000, maxTurns: 1 }]),
    ]);
    expect((await send(port, { token: await mint() })).status).toBe(202);
    expect(await send(port, { token: await mint() })).toMatchObject({ status: 429, body: '' });
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
  });

  it('throttles an address after repeated failures, but never a valid token', async () => {
    const { port } = await start();
    const statuses: number[] = [];
    for (let index = 0; index < 22; index += 1) statuses.push((await send(port)).status);
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    const throttled = await send(port);
    expect(throttled.status).toBe(429);
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    expect((await send(port, { token: await mint() })).status).toBe(202);
  });

  it('checks Host, Origin, method and path against the public URL', async () => {
    const { port } = await start();
    const token = await mint();
    expect(await send(port, { token, host: '127.0.0.1' })).toMatchObject({ status: 403, body: '' });
    expect(await send(port, { token, origin: 'https://evil.example' })).toMatchObject({
      status: 403,
      body: '',
    });
    expect(await send(port, { token, method: 'PUT' })).toMatchObject({ status: 405, body: '' });
    expect(await send(port, { token, path: '/hooks/events/ci?x=1' })).toMatchObject({
      status: 404,
      body: '',
    });
    expect(await send(port, { token, path: '/elsewhere' })).toMatchObject({
      status: 404,
      body: '',
    });
  });

  it('serves each grant its own RFC 9728 metadata', async () => {
    const { port } = await start();
    const reply = await send(port, {
      method: 'GET',
      path: '/.well-known/oauth-protected-resource/hooks/events/chat',
    });
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({
      resource: `${PUBLIC}/events/chat`,
      authorization_servers: [ISSUER],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    });
  });

  it('audits each refusal without token, content, conversation or address', async () => {
    const { port, audit } = await start();
    const token = await mint({ key: stranger.privateKey });
    await send(port, {
      token,
      body: JSON.stringify({
        kind: 'message',
        conversationId: 'SECRET-CONV',
        content: 'SECRET-TEXT',
      }),
    });
    await send(port, { path: '/hooks/events/nope', token });
    await send(port, { body: 'x'.repeat(20_000), token });
    expect(audit).toEqual([
      {
        at: expect.any(String),
        grantId: 'ci',
        refusal: 'bad-signature',
        remote: 'loopback',
        throttled: false,
      },
      { at: expect.any(String), refusal: 'unknown-grant', remote: 'loopback', throttled: false },
      {
        at: expect.any(String),
        grantId: 'ci',
        refusal: 'oversize',
        remote: 'loopback',
        throttled: false,
      },
    ]);
    const serialized = JSON.stringify(audit);
    for (const secret of [token, 'SECRET-CONV', 'SECRET-TEXT', '127.0.0.1', 'ci-bot']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('counts failures per client behind a trusted proxy, and ignores the header from anyone else', async () => {
    const grants = [grant('ci', 'ci-bot')];
    const session = {
      receive: vi.fn(async () => ({ admitted: false as const, refusal: 'expired' as const })),
    };
    const statuses = async (trustedProxies: string[], forwardedFor: string) => {
      const http = createExternalEventHttpHost({
        grants,
        receive: session.receive,
        port: 0,
        trustedProxies,
      });
      const { port } = await http.start();
      try {
        const run = async (client: string) => {
          const results: number[] = [];
          for (let index = 0; index < 21; index += 1) {
            results.push((await sendForwarded(port, `${forwardedFor}${client}`)).status);
          }
          return [results[0], results.at(-1)];
        };
        return [await run('198.51.100.1'), await run('198.51.100.2')];
      } finally {
        await http.stop();
      }
    };
    // Behind a trusted proxy each client has its own budget: 401 until its own 21st failure.
    expect(await statuses(['127.0.0.1'], '')).toEqual([
      [401, 429],
      [401, 429],
    ]);
    // Hops the client wrote further left are not believed: the budget is still per real client.
    expect(await statuses(['127.0.0.1'], '203.0.113.7, ')).toEqual([
      [401, 429],
      [401, 429],
    ]);
    // Untrusted peer: the header is ignored, so the second client shares the peer's spent budget.
    expect(await statuses([], '')).toEqual([
      [401, 429],
      [429, 429],
    ]);
  });

  it('refuses a streamed body over the bound without reading it all', async () => {
    const { port } = await start();
    const token = await mint();
    const reply = await new Promise<IReply>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/hooks/events/ci',
          headers: { host: HOST, authorization: `Bearer ${token}`, 'transfer-encoding': 'chunked' },
        },
        (res) => {
          let text = '';
          res.on('data', (chunk: Buffer) => {
            text += chunk.toString('utf8');
          });
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
          );
        },
      );
      req.on('error', () => undefined);
      for (let index = 0; index < 5; index += 1) req.write('x'.repeat(8 * 1024));
      req.end();
      req.on('error', reject);
    });
    expect(reply).toMatchObject({ status: 413, body: '' });
  });

  it('treats two spellings of one public URL as one, and validates without listening', () => {
    const upper = {
      ...grant('chat', 'chat-bot'),
      verifier: {
        ...grant('chat', 'chat-bot').verifier,
        resource: 'https://ROBOTA.example/hooks/events/chat',
      },
    };
    expect(() =>
      validateExternalEventEndpoint({ grants: [grant('ci', 'ci-bot'), upper] }),
    ).not.toThrow();
    const badScope = {
      ...grant('ci', 'ci-bot'),
      verifier: { ...grant('ci', 'ci-bot').verifier, requiredScopes: ['a b'] },
    };
    expect(() => validateExternalEventEndpoint({ grants: [badScope] })).toThrow(/^grant ci: /);
    expect(() =>
      validateExternalEventEndpoint({
        grants: [grant('ci', 'ci-bot')],
        trustedProxies: ['proxy.example'],
      }),
    ).toThrow(/literal IP/);
  });

  it('refuses a configuration it cannot serve safely', () => {
    const base = {
      receive: async () => ({ admitted: false as const, refusal: 'expired' as const }),
      port: 0,
    };
    expect(() => createExternalEventHttpHost({ ...base, grants: [] })).toThrow(
      /at least one grant/,
    );
    const other = {
      ...grant('chat', 'chat-bot'),
      verifier: {
        ...grant('chat', 'chat-bot').verifier,
        resource: 'https://other.example/events/chat',
      },
    };
    expect(() =>
      createExternalEventHttpHost({ ...base, grants: [grant('ci', 'ci-bot'), other] }),
    ).toThrow(/one public URL/);
    const http = {
      ...grant('ci', 'ci-bot'),
      verifier: { ...grant('ci', 'ci-bot').verifier, resource: 'http://robota.example/events/ci' },
    };
    expect(() => createExternalEventHttpHost({ ...base, grants: [http] })).toThrow(/https/);
    expect(() =>
      createExternalEventHttpHost({
        ...base,
        grants: [grant('ci', 'ci-bot')],
        bindAddress: '0.0.0.0' as '127.0.0.1',
      }),
    ).toThrow(/loopback/);
  });
});
