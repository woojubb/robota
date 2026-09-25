import { request as httpRequest } from 'node:http';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';
import { describe, expect, it, vi } from 'vitest';

import { createMcpHttpHost, createMcpRemoteHttpHost } from '../mcp-http-host.js';

import type { IMcpRemoteAuditRecord } from '../mcp-remote-authorization.js';
import type {
  IAccessTokenVerifier,
  TAccessTokenAdmission,
} from '@robota-sdk/agent-interface-transport';
import type { IncomingHttpHeaders } from 'node:http';

const PUBLIC_URL = 'https://mcp.example.test/team/robota/mcp';
const PUBLIC_HOST = 'mcp.example.test';
const ISSUER = 'https://auth.example.test';
const METADATA_PATH = '/.well-known/oauth-protected-resource/team/robota/mcp';
const METADATA_URL = `https://${PUBLIC_HOST}${METADATA_PATH}`;
const GOOD = 'good-token-text';
const SCOPELESS = 'scopeless-token-text';
const KEYS_DOWN = 'keys-down-token-text';

const schema = {
  name: 'robota_command_help',
  description: 'Canonical command',
  parameters: { type: 'object' as const, properties: {} },
};

function fixture() {
  return Object.assign(createTestInteractiveSession(), {
    listRuntimeTools: vi.fn().mockResolvedValue([schema]),
    invokeRuntimeTool: vi.fn().mockResolvedValue({ success: true, result: 'ran' }),
  });
}

function fakeVerifier() {
  return {
    verify: vi.fn(async (token: string): Promise<TAccessTokenAdmission> => {
      if (token === GOOD) return { admitted: true };
      if (token === SCOPELESS) return { admitted: false, refusal: 'missing-scope' };
      if (token === KEYS_DOWN) return { admitted: false, refusal: 'keys-unavailable' };
      return { admitted: false, refusal: 'bad-signature' };
    }),
  } satisfies IAccessTokenVerifier;
}

interface IRawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const LIST_TOOLS = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

async function raw(
  port: number,
  options: { path?: string; method?: string; headers?: Record<string, string>; body?: string },
): Promise<IRawResponse> {
  return new Promise<IRawResponse>((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/team/robota/mcp',
        method: options.method ?? 'POST',
        headers: {
          Host: PUBLIC_HOST,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...options.headers,
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(options.body ?? (options.method === 'GET' ? undefined : LIST_TOOLS));
  });
}

async function startHost(overrides: { trustedProxies?: string[] } = {}): Promise<{
  port: number;
  session: ReturnType<typeof fixture>;
  verifier: ReturnType<typeof fakeVerifier>;
  audit: IMcpRemoteAuditRecord[];
  stop: () => Promise<void>;
}> {
  const session = fixture();
  const verifier = fakeVerifier();
  const audit: IMcpRemoteAuditRecord[] = [];
  const host = createMcpRemoteHttpHost({
    name: 'robota',
    version: '1',
    session,
    authorization: {
      publicUrl: PUBLIC_URL,
      issuer: ISSUER,
      scopes: ['mcp:use'],
      verifier,
      audit: (record) => audit.push(record),
      ...overrides,
    },
  });
  const started = await host.start();
  const port = Number(started.listening.split(':').pop());
  expect(started.url).toBe(PUBLIC_URL);
  return { port, session, verifier, audit, stop: () => host.stop() };
}

describe('remote MCP HTTP host', () => {
  it('refuses a public URL that is not https, and a non-literal bind address', () => {
    const base = { name: 'robota', version: '1', session: fixture() };
    const authorization = {
      publicUrl: 'http://mcp.example.test/mcp',
      issuer: ISSUER,
      scopes: ['mcp:use'],
      verifier: fakeVerifier(),
    };
    expect(() => createMcpRemoteHttpHost({ ...base, authorization })).toThrow(/https/);
    expect(() =>
      createMcpRemoteHttpHost({
        ...base,
        authorization: { ...authorization, publicUrl: 'https://u:p@mcp.example.test/mcp' },
      }),
    ).toThrow(/credentials/);
    expect(() =>
      createMcpRemoteHttpHost({
        ...base,
        host: 'example.test',
        authorization: { ...authorization, publicUrl: PUBLIC_URL },
      }),
    ).toThrow(/literal IP/);
  });

  it('serves the endpoint and RFC 9728 metadata at paths derived from a prefixed public URL', async () => {
    const host = await startHost();
    try {
      const metadata = await raw(host.port, { path: METADATA_PATH, method: 'GET' });
      expect(metadata.status).toBe(200);
      expect(JSON.parse(metadata.body)).toEqual({
        resource: PUBLIC_URL,
        authorization_servers: [ISSUER],
        scopes_supported: ['mcp:use'],
        bearer_methods_supported: ['header'],
      });
      const listed = await raw(host.port, { headers: { Authorization: `Bearer ${GOOD}` } });
      expect(listed.status).toBe(200);
      expect(listed.body).toContain(schema.name);
      expect(
        (await raw(host.port, { path: '/mcp', headers: { Authorization: `Bearer ${GOOD}` } }))
          .status,
      ).toBe(404);
      expect(
        (await raw(host.port, { path: '/.well-known/oauth-protected-resource', method: 'GET' }))
          .status,
      ).toBe(404);
    } finally {
      await host.stop();
    }
  });

  it('checks Host and Origin against the public origin, not the listener', async () => {
    const host = await startHost();
    const auth = { Authorization: `Bearer ${GOOD}` };
    try {
      expect(
        (await raw(host.port, { headers: { ...auth, Host: `127.0.0.1:${host.port}` } })).status,
      ).toBe(403);
      expect((await raw(host.port, { headers: { ...auth, Host: 'attacker.test' } })).status).toBe(
        403,
      );
      expect(
        (await raw(host.port, { headers: { ...auth, Origin: `http://127.0.0.1:${host.port}` } }))
          .status,
      ).toBe(403);
      expect(
        (await raw(host.port, { headers: { ...auth, Origin: 'https://attacker.test' } })).status,
      ).toBe(403);
      expect(
        (await raw(host.port, { headers: { ...auth, Origin: `https://${PUBLIC_HOST}` } })).status,
      ).toBe(200);
      expect(
        (await raw(host.port, { headers: { ...auth, Host: `${PUBLIC_HOST}:443` } })).status,
      ).toBe(200);
      expect(host.verifier.verify).toHaveBeenCalledTimes(2);
    } finally {
      await host.stop();
    }
  });

  it('answers a missing or invalid token with a bare 401 challenge and an empty body', async () => {
    const host = await startHost();
    try {
      const missing = await raw(host.port, {});
      expect(missing.status).toBe(401);
      expect(missing.headers['www-authenticate']).toBe(
        `Bearer resource_metadata="${METADATA_URL}"`,
      );
      expect(missing.body).toBe('');
      const invalid = await raw(host.port, { headers: { Authorization: 'Bearer forged' } });
      expect(invalid.status).toBe(401);
      expect(invalid.headers['www-authenticate']).toBe(
        `Bearer error="invalid_token", resource_metadata="${METADATA_URL}"`,
      );
      expect(invalid.body).toBe('');
      expect(host.session.invokeRuntimeTool).not.toHaveBeenCalled();
    } finally {
      await host.stop();
    }
  });

  it('answers a token without the required scope with 403 insufficient_scope', async () => {
    const host = await startHost();
    try {
      const response = await raw(host.port, { headers: { Authorization: `Bearer ${SCOPELESS}` } });
      expect(response.status).toBe(403);
      expect(response.headers['www-authenticate']).toBe(
        `Bearer error="insufficient_scope", scope="mcp:use", resource_metadata="${METADATA_URL}"`,
      );
      expect(response.body).toBe('');
    } finally {
      await host.stop();
    }
  });

  it('never throttles a valid token, however many failures share its address', async () => {
    const host = await startHost();
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 22; attempt += 1) {
        statuses.push(
          (await raw(host.port, { headers: { Authorization: 'Bearer forged' } })).status,
        );
      }
      expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
      expect(statuses.slice(20)).toEqual([429, 429]);
      expect((await raw(host.port, { headers: { Authorization: `Bearer ${GOOD}` } })).status).toBe(
        200,
      );
      // Every token was verified before anything was counted.
      expect(host.verifier.verify).toHaveBeenCalledTimes(23);
    } finally {
      await host.stop();
    }
  });

  it('counts failures per forwarded address only when the peer is a trusted proxy', async () => {
    const trusted = await startHost({ trustedProxies: ['127.0.0.1'] });
    const untrusted = await startHost();
    const forged = { Authorization: 'Bearer forged' };
    try {
      for (let attempt = 0; attempt < 21; attempt += 1) {
        await raw(trusted.port, { headers: { ...forged, 'X-Forwarded-For': '203.0.113.5' } });
      }
      expect(
        (await raw(trusted.port, { headers: { ...forged, 'X-Forwarded-For': '203.0.113.5' } }))
          .status,
      ).toBe(429);
      // A different client behind the same proxy has its own budget; a client-written hop to the
      // left of the proxy's own entry is not believed.
      expect(
        (
          await raw(trusted.port, {
            headers: { ...forged, 'X-Forwarded-For': '203.0.113.5, 198.51.100.7' },
          })
        ).status,
      ).toBe(401);

      for (let attempt = 0; attempt < 20; attempt += 1) {
        await raw(untrusted.port, {
          headers: { ...forged, 'X-Forwarded-For': `203.0.113.${attempt}` },
        });
      }
      // Without a trusted proxy the header is ignored: all of those were one address.
      expect(
        (await raw(untrusted.port, { headers: { ...forged, 'X-Forwarded-For': '198.51.100.9' } }))
          .status,
      ).toBe(429);
      expect(untrusted.audit.every((record) => record.remote === 'loopback')).toBe(true);
      expect(trusted.audit.every((record) => record.remote === 'public')).toBe(true);
    } finally {
      await trusted.stop();
      await untrusted.stop();
    }
  });

  it('hands each refusal to the audit sink as a content-free record', async () => {
    const host = await startHost();
    try {
      await raw(host.port, {});
      await raw(host.port, { headers: { Authorization: 'Bearer forged-secret-value' } });
      await raw(host.port, { headers: { Authorization: `Bearer ${SCOPELESS}` } });
      const outage = await raw(host.port, { headers: { Authorization: `Bearer ${KEYS_DOWN}` } });
      expect(outage.status).toBe(503);
      expect(outage.body).toBe('');
      await raw(host.port, { headers: { Authorization: `Bearer ${GOOD}` } });
      expect(host.audit).toEqual([
        { refusal: 'missing-token', remote: 'loopback', throttled: false },
        { refusal: 'bad-signature', remote: 'loopback', throttled: false },
        { refusal: 'missing-scope', remote: 'loopback', throttled: false },
        { refusal: 'keys-unavailable', remote: 'loopback', throttled: false },
      ]);
      const serialized = JSON.stringify(host.audit);
      for (const secret of ['forged-secret-value', SCOPELESS, KEYS_DOWN, '127.0.0.1']) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      await host.stop();
    }
  });

  it('stays stateless: an admitted exchange issues no Mcp-Session-Id', async () => {
    const host = await startHost();
    try {
      const initialized = await raw(host.port, {
        headers: { Authorization: `Bearer ${GOOD}` },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'remote-test', version: '1' },
          },
        }),
      });
      expect(initialized.status).toBe(200);
      expect(initialized.headers['mcp-session-id']).toBeUndefined();
    } finally {
      await host.stop();
    }
  });

  it('leaves the loopback host on its minted bearer, blind to access tokens', async () => {
    const session = fixture();
    const host = createMcpHttpHost({ name: 'robota', version: '1', session });
    const endpoint = await host.start();
    const port = Number(new URL(endpoint.url).port);
    try {
      const refused = await raw(port, {
        path: '/mcp',
        headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${GOOD}` },
      });
      expect(refused.status).toBe(401);
      expect(refused.headers['www-authenticate']).toBeUndefined();
      const admitted = await raw(port, {
        path: '/mcp',
        headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${endpoint.token}` },
      });
      expect(admitted.status).toBe(200);
    } finally {
      await host.stop();
    }
  });
});
