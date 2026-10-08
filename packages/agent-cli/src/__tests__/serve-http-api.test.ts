/**
 * `--serve --http-port` end to end: the source CLI (`scripts/dev/agent`) serves the agent HTTP API on
 * loopback, with disposable HOME and product state and a loopback OpenAI-compatible provider, and a
 * plain HTTP client drives it the way another application or service would.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { respond, wireReceipts, type WireRequest } from './helpers/provider-wire-fixture.js';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const launcher = path.join(repoRoot, 'scripts', 'dev', 'agent');
const TOKEN = 'serve-http-api-test-bearer-0123456789abcdef';
const ENV_PROBE = 'RUN_ENV_PROBE';

const root = mkdtempSync(path.join(tmpdir(), 'test-product-serve-http-'));
const userHome = path.join(root, 'home');
const workspace = path.join(root, 'workspace');
const state = path.join(userHome, '.robota');
const requests: WireRequest[] = [];
let providerFailure: unknown;
let provider: Server;
let serve: ChildProcess;
let apiUrl = '';
let serveExit: Promise<number | null>;
let serveStderr = '';

function baseEnvironment(): Record<string, string> {
  const environment = Object.fromEntries(
    ['PATH', 'SystemRoot', 'SYSTEMROOT', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'].flatMap(
      (key) => (process.env[key] === undefined ? [] : [[key, process.env[key]!]]),
    ),
  );
  return { ...environment, HOME: userHome, PRODUCT_ID: 'robota' };
}

function listen(server: Server): Promise<number> {
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

function api(route: string, init: RequestInit = {}, token: string | null = TOKEN) {
  return fetch(`${apiUrl}${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
}

beforeAll(async () => {
  mkdirSync(workspace, { recursive: true });
  mkdirSync(state, { recursive: true });
  const environment = baseEnvironment();
  const git = spawnSync('git', ['init', '--quiet'], {
    cwd: workspace,
    env: environment,
    encoding: 'utf8',
  });
  expect(git.status, git.stderr).toBe(0);

  provider = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        throw new Error(`Unexpected provider request: ${request.method} ${request.url}`);
      }
      let raw = '';
      for await (const chunk of request) raw += String(chunk);
      const wire = JSON.parse(raw) as WireRequest;
      requests.push(wire);
      const probing = wire.messages.some(
        (message) => message.role === 'user' && String(message.content).includes(ENV_PROBE),
      );
      if (probing && wireReceipts('openai', wire).length === 0) {
        respond('openai', response, wire.stream === true, requests.length, {
          id: 'env-probe',
          name: 'Bash',
          args: { command: 'printf "token=[%s]" "${PRODUCT_HTTP_TOKEN:-}"' },
        });
        return;
      }
      respond(
        'openai',
        response,
        wire.stream === true,
        requests.length,
        undefined,
        probing ? 'PROBE_DONE' : 'SERVE_HTTP_OK',
      );
    } catch (error) {
      providerFailure = error;
      response.writeHead(500).end('Provider fixture failed');
    }
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

  const port = await freePort();
  serve = spawn(
    launcher,
    ['--serve', '--http-port', String(port), '--permission-mode', 'bypassPermissions'],
    {
      cwd: workspace,
      env: { ...environment, PRODUCT_HTTP_TOKEN: TOKEN },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  serveExit = new Promise((resolve) => serve.once('close', (code) => resolve(code)));
  apiUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`serve did not start:\n${serveStderr}`)),
      90_000,
    );
    serve.stderr!.on('data', (chunk: Buffer) => {
      serveStderr += chunk.toString();
      const served = /HTTP API served at (http:\/\/127\.0\.0\.1:\d+)/.exec(serveStderr);
      if (served) {
        clearTimeout(timer);
        resolve(served[1]!);
      }
    });
    serve.once('close', (code) => {
      clearTimeout(timer);
      reject(new Error(`serve exited ${code} before serving:\n${serveStderr}`));
    });
  });
  expect(apiUrl).toBe(`http://127.0.0.1:${port}`);
}, 180_000);

afterAll(async () => {
  if (serve && serve.exitCode === null) serve.kill('SIGKILL');
  provider?.closeAllConnections();
  await new Promise<void>((resolve) => (provider ? provider.close(() => resolve()) : resolve()));
  rmSync(root, { recursive: true, force: true });
});

describe('--serve --http-port', () => {
  it('never prints the bearer', () => {
    expect(serveStderr).not.toContain(TOKEN);
  });

  it('refuses a request without the bearer, or with a wrong one', async () => {
    expect((await api('/executing', {}, null)).status).toBe(401);
    expect((await api('/executing', {}, `${TOKEN}x`)).status).toBe(401);
  });

  it('streams a submitted prompt to a completed result over SSE', async () => {
    const response = await api('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Verify the HTTP API prompt.' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const stream = await response.text();
    expect(stream, `${stream}\n${serveStderr}`).toContain('event: complete');
    expect(stream).toContain('SERVE_HTTP_OK');
    // The turn's usage record names the HTTP surface the host assigned, not the session default.
    expect(stream).toContain('"surface":"remote"');
    expect(stream).not.toContain('"surface":"cli"');
    expect(providerFailure).toBeUndefined();

    const messages = (await (await api('/messages')).json()) as {
      role: string;
      content: unknown;
    }[];
    expect(
      messages.some(
        (message) =>
          message.role === 'user' &&
          String(message.content).includes('Verify the HTTP API prompt.'),
      ),
    ).toBe(true);
  }, 90_000);

  it('runs a slash command without calling the model', async () => {
    const count = requests.length;
    const response = await api('/command', {
      method: 'POST',
      body: JSON.stringify({ name: 'help' }),
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('help');
    expect(requests).toHaveLength(count);
  }, 60_000);

  it('keeps the bearer out of the environment of the commands a turn runs', async () => {
    const response = await api('/submit', {
      method: 'POST',
      body: JSON.stringify({ prompt: ENV_PROBE }),
    });
    const stream = await response.text();
    expect(stream, `${stream}\n${serveStderr}`).toContain('PROBE_DONE');
    const receipts = requests.flatMap((request) => wireReceipts('openai', request));
    expect(receipts.map((receipt) => String(receipt.content)).join('\n')).toContain('token=[]');
    expect(JSON.stringify(receipts)).not.toContain(TOKEN);
  }, 90_000);

  it('answers abort and execution state once the turn is over', async () => {
    expect(await (await api('/abort', { method: 'POST' })).json()).toEqual({ ok: true });
    expect(await (await api('/executing')).json()).toEqual({ executing: false });
  });

  it('stops serving and exits cleanly on SIGTERM', async () => {
    serve.kill('SIGTERM');
    expect(await serveExit).toBe(0);
    await expect(api('/executing')).rejects.toThrow();
  }, 60_000);
});
