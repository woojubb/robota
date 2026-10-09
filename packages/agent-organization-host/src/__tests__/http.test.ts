import { appendFileSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrganizationHttpHandler, organizationCanonical } from '../index.js';
import { fixture } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
const servers: Server[] = [];
type TSendOptions = { path?: string; method?: string; headers?: Record<string, string> };
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const f of fixtures.splice(0)) f.cleanup();
});

async function setup() {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('missing bound socket');
  const audience = `http://127.0.0.1:${address.port}`;
  const f = fixture({ audience });
  fixtures.push(f);
  const effectPath = join(f.directory, 'effect.txt');
  const broker = f.broker([
    {
      resource: 'asset',
      operation: 'read',
      roles: ['operator'],
      requiresApproval: false,
      reserve: () => ({ tokens: 10, timeMs: 1000, costMicros: 10 }),
      execute: async (operation) => {
        appendFileSync(effectPath, organizationCanonical(operation.parameters) + '\n');
        return { value: 'applied', usage: { tokens: 2, timeMs: 0, costMicros: 2 } };
      },
    },
  ]);
  server.on('request', createOrganizationHttpHandler({ broker, audience, bodyTimeoutMs: 30 }));
  return { ...f, broker, audience, effectPath };
}

function send(
  audience: string,
  bytes: Buffer,
  options: TSendOptions = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      audience + (options.path ?? '/v1/apply'),
      {
        method: options.method ?? 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () =>
          resolve({ status: response.statusCode!, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    request.on('error', reject);
    request.end(bytes);
  });
}

describe('real organization HTTP ingress', () => {
  it('applies a signed request through a real socket, durably caches its receipt and performs the file effect once', async () => {
    const f = await setup();
    const request = f.request();
    const first = await send(f.audience, Buffer.from(organizationCanonical(f.call(request))));
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body).receipt.value).toBe('applied');
    const retry = await send(
      f.audience,
      Buffer.from(organizationCanonical(f.call({ ...request, nonce: 'fresh-retry' }))),
    );
    expect(retry).toEqual(first);
    expect(readFileSync(f.effectPath, 'utf8')).toBe(
      organizationCanonical(request.operation.parameters) + '\n',
    );
    expect(f.ledger.budgetState('task', 'company', 'task').spent.tokens).toBe(2);
  });

  it.each<TSendOptions>([
    { method: 'GET' },
    { path: '/admin' },
    { path: '/v1/apply?mint=true' },
    { headers: { host: 'evil.example' } },
    { headers: { origin: 'https://evil.example' } },
    { headers: { 'content-type': 'text/plain' } },
    { headers: { 'content-encoding': 'gzip' } },
  ])(
    'denies foreign Host/Origin, methods, noncanonical routes and content types (%#)',
    async (options) => {
      const f = await setup();
      const response = await send(
        f.audience,
        Buffer.from(organizationCanonical(f.call(f.request()))),
        options,
      );
      expect(response.status).toBe(403);
      expect(f.ledger.budgetState('global').spent.tokens).toBe(0);
    },
  );

  it('rejects duplicate keys, noncanonical bytes, invalid UTF-8 and excessive bodies without logging raw content', async () => {
    const f = await setup();
    const wire = organizationCanonical(f.call(f.request()));
    for (const bytes of [
      Buffer.from(' {"sensitive-canary":true}'),
      Buffer.from('{"request":1,"request":2,"approval":null}'),
      Buffer.from([0xff, 0xfe]),
      Buffer.from('x'.repeat(65_537)),
      Buffer.from(wire + '\n'),
    ]) {
      const response = await send(f.audience, bytes);
      expect(response.status).toBe(403);
      expect(response.body).not.toContain('sensitive-canary');
    }
  });

  it('closes a body that never completes within its absolute read deadline', async () => {
    const f = await setup();
    await expect(
      new Promise((resolve, reject) => {
        const request = httpRequest(
          f.audience + '/v1/apply',
          { method: 'POST', headers: { 'content-type': 'application/json' } },
          resolve,
        );
        request.on('error', reject);
        request.write('{');
      }),
    ).rejects.toThrow();
    expect(f.ledger.budgetState('global').held.tokens).toBe(0);
  });

  it('refuses an HTTP public endpoint, credential URL and different ingress/ledger audiences', async () => {
    const f = await setup();
    for (const audience of [
      'http://example.com',
      'https://user:password@example.com',
      'https://example.com',
      `${f.audience}/other`,
    ]) {
      expect(() => createOrganizationHttpHandler({ broker: f.broker, audience })).toThrow(
        'invalid-schema',
      );
    }
  });
});
