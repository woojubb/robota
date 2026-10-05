/**
 * `--serve --http-port` as an OAuth resource server, end to end: the source CLI (`scripts/dev/agent`)
 * serves the agent HTTP API behind the shared resource-server gate, with disposable HOME and product
 * state, a loopback OpenAI-compatible provider, and a loopback `https` test issuer whose certificate
 * the CLI trusts through `NODE_EXTRA_CA_CERTS`. Tokens are minted here with `jose` and checked by the
 * CLI against the issuer's published key set.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { respond, type WireRequest } from './helpers/provider-wire-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const PUBLIC_HOST = 'agents.example.test';
const PUBLIC_URL = `https://${PUBLIC_HOST}/agent`;
const SCOPE = 'agent.run';
const SUBJECT = 'client-a';
const KID = 'test-key';

const root = mkdtempSync(path.join(tmpdir(), 'test-product-serve-http-oauth-'));
const userHome = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
const state = path.join(userHome, '.robota');
let provider: Server;
let issuerServer: HttpsServer;
let issuer = '';
let signingKey: CryptoKey;
let serve: ChildProcess;
let apiPort = 0;
let serveExit: Promise<number | null>;
let serveStderr = '';
const minted: string[] = [];

function baseEnvironment(): Record<string, string> {
  const environment = Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    ),
  );
  return { ...environment, HOME: userHome };
}

function listen(server: Server | HttpsServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') reject(new Error('no port'));
      else resolve(address.port);
    });
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function mint(
  claims: { aud?: string; scope?: string; sub?: string; exp?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ scope: claims.scope ?? SCOPE, client_id: 'test-client' })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: KID })
    .setIssuer(issuer)
    .setAudience(claims.aud ?? PUBLIC_URL)
    .setSubject(claims.sub ?? SUBJECT)
    .setIssuedAt(now)
    .setExpirationTime(claims.exp ?? now + 300)
    .sign(signingKey);
  minted.push(token);
  return token;
}

interface IReply {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
}

/** A request as a proxy preserving Host would forward it; `fetch` cannot set Host. */
function call(
  route: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<IReply> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port: apiPort,
        path: route,
        method: options.method ?? 'GET',
        headers: {
          host: PUBLIC_HOST,
          'content-type': 'application/json',
          ...(options.token !== undefined ? { authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

beforeAll(async () => {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(state, { recursive: true });
  const environment = baseEnvironment();
  expect(spawnSync('git', ['init', '--quiet'], { cwd: workspace, env: environment }).status).toBe(
    0,
  );

  // A self-signed certificate for the loopback issuer; the CLI trusts it as an extra CA.
  const cert = path.join(root, 'issuer.crt');
  const key = path.join(root, 'issuer.key');
  const openssl = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { encoding: 'utf8' },
  );
  expect(openssl.status, openssl.stderr).toBe(0);

  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };
  issuerServer = createHttpsServer(
    { cert: readFileSync(cert), key: readFileSync(key) },
    (req, res) => {
      if (req.url === '/.well-known/oauth-authorization-server') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ issuer, jwks_uri: `${issuer}/jwks` }));
      } else if (req.url === '/jwks') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.writeHead(404).end();
      }
    },
  );
  issuer = `https://127.0.0.1:${await listen(issuerServer)}`;

  provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const wire = JSON.parse(raw) as WireRequest;
    respond('openai', res, wire.stream === true, 1, undefined, 'SERVE_HTTP_OAUTH_OK');
  });
  const providerPort = await listen(provider);
  writeFileSync(
    path.join(state, 'settings.json'),
    JSON.stringify({
      currentProvider: 'openai',
      providers: {
        openai: {
          type: 'openai',
          model: 'fixture-model',
          apiKey: 'unused-fixture-key',
          baseURL: `http://127.0.0.1:${providerPort}/v1`,
          options: { apiSurface: 'chat-completions' },
        },
      },
    }),
  );
  const trust = spawnSync(launcher, ['trust', '--yes'], {
    cwd: workspace,
    env: environment,
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(trust.status, trust.stderr).toBe(0);

  apiPort = await freePort();
  serve = spawn(
    launcher,
    [
      '--serve',
      '--http-port',
      String(apiPort),
      '--http-public-url',
      PUBLIC_URL,
      '--oauth-issuer',
      issuer,
      '--oauth-scopes',
      SCOPE,
      '--oauth-allowed-subjects',
      SUBJECT,
      '--permission-mode',
      'bypassPermissions',
    ],
    {
      cwd: workspace,
      env: { ...environment, NODE_EXTRA_CA_CERTS: cert },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  serveExit = new Promise((resolve) => serve.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`serve did not start:\n${serveStderr}`)),
      90_000,
    );
    serve.stderr!.on('data', (chunk: Buffer) => {
      serveStderr += chunk.toString();
      if (/HTTP API listening on 127\.0\.0\.1:\d+ for https:/.test(serveStderr)) {
        clearTimeout(timer);
        resolve();
      }
    });
    serve.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited ${code} before serving:\n${serveStderr}`));
    });
  });
}, 180_000);

afterAll(async () => {
  if (serve && serve.exitCode === null) serve.kill('SIGKILL');
  for (const server of [provider, issuerServer]) {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }
  rmSync(root, { recursive: true, force: true });
});

describe('--serve --http-port as an OAuth resource server', () => {
  it('serves its RFC 9728 metadata', async () => {
    const reply = await call('/.well-known/oauth-protected-resource/agent');
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual({
      resource: PUBLIC_URL,
      authorization_servers: [issuer],
      scopes_supported: [SCOPE],
      bearer_methods_supported: ['header'],
    });
  });

  it('streams a prompt for a valid access token', async () => {
    const reply = await call('/agent/submit', {
      method: 'POST',
      token: await mint(),
      body: { prompt: 'Verify the OAuth HTTP API prompt.' },
    });
    expect(reply.status, `${reply.body}\n${serveStderr}`).toBe(200);
    expect(reply.headers['content-type']).toContain('text/event-stream');
    expect(reply.body).toContain('event: complete');
    expect(reply.body).toContain('SERVE_HTTP_OAUTH_OK');
    expect(reply.body).toContain('"surface":"remote"');
  }, 90_000);

  it('challenges a request without a token', async () => {
    const reply = await call('/agent/executing');
    expect(reply.status).toBe(401);
    expect(reply.headers['www-authenticate']).toBe(
      `Bearer resource_metadata="https://${PUBLIC_HOST}/.well-known/oauth-protected-resource/agent"`,
    );
    expect(reply.body).toBe('');
  });

  it('refuses a token for another audience, an unlisted subject or an expired one', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const token of [
      await mint({ aud: 'https://other.example.test/agent' }),
      await mint({ sub: 'client-b' }),
      await mint({ exp: now - 600 }),
    ]) {
      const reply = await call('/agent/executing', { token });
      expect(reply.status).toBe(401);
      expect(reply.headers['www-authenticate']).toContain('error="invalid_token"');
      expect(reply.body).toBe('');
    }
  });

  it('answers a token without the scope with insufficient_scope', async () => {
    const reply = await call('/agent/executing', { token: await mint({ scope: 'other' }) });
    expect(reply.status).toBe(403);
    expect(reply.headers['www-authenticate']).toContain('error="insufficient_scope"');
  });

  it('refuses a request that does not name the public host, or lies outside the base path', async () => {
    const token = await mint();
    const outside = await call('/submit', { token });
    expect(outside.status).toBe(404);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      request(
        {
          host: '127.0.0.1',
          port: apiPort,
          path: '/agent/executing',
          headers: { host: 'evil.test' },
        },
        (res) => resolve(res.statusCode ?? 0),
      )
        .on('error', reject)
        .end();
    });
    expect(wrongHost).toBe(403);
  });

  it('reports refusals by reason and never prints token text', () => {
    expect(serveStderr).toMatch(/HTTP API refused: missing-token \(loopback\)/);
    expect(serveStderr).toMatch(/HTTP API refused: missing-scope/);
    for (const token of minted) expect(serveStderr).not.toContain(token);
  });

  it('stops serving and exits cleanly on SIGTERM', async () => {
    serve.kill('SIGTERM');
    expect(await serveExit).toBe(0);
  }, 60_000);
});
