/**
 * Discovery is ours, not the SDK's fallback: each link — resource metadata, authorization server,
 * issuer, endpoints — is checked against the one before it, and nothing is guessed.
 */

import { describe, expect, it } from 'vitest';

import { discoverMCPOAuthServer } from '../client/oauth/discovery.js';
import { MCPOAuthError } from '../client/oauth/errors.js';
import { createOAuthFetch } from '../client/oauth/network.js';
import { createNodeOAuthNetwork } from '../node/oauth-network.js';
import { AS_URL, MCP_URL, createFakeOAuthServer } from './fixtures/fake-oauth-server.js';

import type { IMCPOAuthConfig } from '../definition/types.js';
import type { IFakeOAuthServer } from './fixtures/fake-oauth-server.js';

function discover(
  server: IFakeOAuthServer,
  config: IMCPOAuthConfig = {},
  extra: { resourceMetadataUrl?: string; challengeScope?: string; serverUrl?: string } = {},
) {
  return discoverMCPOAuthServer({
    serverUrl: extra.serverUrl ?? MCP_URL,
    config,
    fetch: createOAuthFetch(createNodeOAuthNetwork({ fetch: server.fetch, lookup: server.lookup })),
    ...(extra.resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: extra.resourceMetadataUrl }),
    ...(extra.challengeScope === undefined ? {} : { challengeScope: extra.challengeScope }),
  });
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(MCPOAuthError);
  return (error as MCPOAuthError).reason;
}

describe('OAuth discovery', () => {
  it('follows resource metadata to a checked authorization server', async () => {
    const server = createFakeOAuthServer();
    const info = await discover(server);
    expect(info.resource).toBe(MCP_URL);
    expect(info.issuer).toBe(AS_URL);
    expect(info.metadata.token_endpoint).toBe('https://auth.example.test/token');
    expect(info.scope).toBe('files:read');
  });

  it('refuses resource metadata that describes another resource', async () => {
    const server = createFakeOAuthServer();
    server.overrides.resource = 'https://mcp.example.test/other';
    expect(await reasonOf(discover(server))).toBe('resource-mismatch');
  });

  it('accepts origin metadata discovered at the root for an endpoint below it', async () => {
    const server = createFakeOAuthServer();
    server.overrides.rootResourceMetadata = true;
    const info = await discover(server);
    expect(info.resource).toBe('https://mcp.example.test');
    expect(info.issuer).toBe(AS_URL);
  });

  it('also accepts root metadata that names the exact endpoint', async () => {
    const server = createFakeOAuthServer();
    server.overrides.rootResourceMetadata = true;
    server.overrides.resource = MCP_URL;
    expect((await discover(server)).resource).toBe(MCP_URL);
  });

  it.each([
    [
      `${MCP_URL}?tenant=alpha`,
      'https://mcp.example.test/.well-known/oauth-protected-resource/mcp?tenant=alpha',
    ],
    [`${MCP_URL}/`, 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp/'],
    [
      'https://mcp.example.test/?tenant=alpha',
      'https://mcp.example.test/.well-known/oauth-protected-resource?tenant=alpha',
    ],
  ])('uses the endpoint-specific metadata for %s', async (endpoint, metadataUrl) => {
    const server = createFakeOAuthServer();
    const requests: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(url.href);
      if (url.href === metadataUrl)
        return Response.json({ resource: endpoint, authorization_servers: [AS_URL] });
      if (url.pathname === '/.well-known/oauth-protected-resource' && url.search === '') {
        return Response.json({
          resource: url.origin,
          authorization_servers: ['https://other-auth.example.test/'],
        });
      }
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource'))
        return new Response(null, { status: 404 });
      return server.fetch(input, init);
    }) as typeof globalThis.fetch;
    const info = await discover({ ...server, fetch }, {}, { serverUrl: endpoint });
    expect(info.resource).toBe(endpoint);
    expect(info.issuer).toBe(AS_URL);
    expect(requests).toContain(metadataUrl);
    expect(requests).not.toContain('https://mcp.example.test/.well-known/oauth-protected-resource');
  });

  it('does not accept an origin or sibling from a path document or challenge link', async () => {
    const path = createFakeOAuthServer();
    path.overrides.resource = 'https://mcp.example.test';
    expect(await reasonOf(discover(path))).toBe('resource-mismatch');

    const linked = createFakeOAuthServer();
    linked.overrides.rootResourceMetadata = true;
    expect(
      await reasonOf(
        discover(
          linked,
          {},
          {
            resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource',
          },
        ),
      ),
    ).toBe('resource-mismatch');

    const root = createFakeOAuthServer();
    root.overrides.rootResourceMetadata = true;
    root.overrides.resource = 'https://mcp.example.test/other';
    expect(await reasonOf(discover(root))).toBe('resource-mismatch');
    root.overrides.resource = 'https://other.example.test';
    expect(await reasonOf(discover(root))).toBe('resource-mismatch');
  });

  it.each([401, 403, 429])(
    'does not fall back to root after a metadata HTTP %s',
    async (status) => {
      const server = createFakeOAuthServer();
      server.overrides.rootResourceMetadata = true;
      const requests: string[] = [];
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url.href);
        if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
          return new Response(null, { status });
        }
        return server.fetch(input, init);
      }) as typeof globalThis.fetch;
      expect(await reasonOf(discover({ ...server, fetch }))).toBe('discovery-failed');
      expect(requests).not.toContain(
        'https://mcp.example.test/.well-known/oauth-protected-resource',
      );
    },
  );

  describe('a challenge that links metadata for another resource', () => {
    const ENDPOINT = 'https://mcp.example.test/mcp/v1';
    const PATH_DOCUMENT = 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp/v1';
    const LINKED = 'https://mcp.example.test/.well-known/oauth-protected-resource/list_labels';
    const SET_ASIDE_SERVER = 'https://set-aside-auth.example.test/';

    /** A first-party service: the endpoint's own document is right, the linked one names its parent. */
    function publishedShape(options: { pathDocument?: 'absent' | { resource: string } } = {}): {
      server: IFakeOAuthServer;
      requests: string[];
    } {
      const server = createFakeOAuthServer();
      const requests: string[] = [];
      const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        requests.push(url.href);
        if (url.href === LINKED) {
          return Response.json({
            resource: 'https://mcp.example.test/mcp',
            authorization_servers: [SET_ASIDE_SERVER],
            scopes_supported: ['labels:read'],
          });
        }
        if (url.href === PATH_DOCUMENT) {
          if (options.pathDocument === 'absent') return new Response(null, { status: 404 });
          return Response.json({
            resource: options.pathDocument?.resource ?? ENDPOINT,
            authorization_servers: [AS_URL],
            scopes_supported: ['files:read', 'files:write'],
          });
        }
        if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
          return new Response(null, { status: 404 });
        }
        return server.fetch(input, init);
      }) as typeof globalThis.fetch;
      return { server: { ...server, fetch }, requests };
    }

    it("uses the endpoint's own document and never the origin's", async () => {
      const { server, requests } = publishedShape();
      const info = await discover(server, {}, { serverUrl: ENDPOINT, resourceMetadataUrl: LINKED });
      expect(info.resource).toBe(ENDPOINT);
      expect(info.issuer).toBe(AS_URL);
      expect(info.scope).toBe('files:read files:write');
      expect(requests.slice(0, 2)).toEqual([LINKED, PATH_DOCUMENT]);
      expect(requests).not.toContain(
        'https://mcp.example.test/.well-known/oauth-protected-resource',
      );
    });

    it('takes nothing from the set-aside document', async () => {
      const { server, requests } = publishedShape();
      const info = await discover(
        server,
        {},
        { serverUrl: ENDPOINT, resourceMetadataUrl: LINKED, challengeScope: 'from-header' },
      );
      expect(info.scope).toBe('from-header');
      expect(requests.some((url) => url.startsWith(SET_ASIDE_SERVER))).toBe(false);
      expect(requests.some((url) => url.includes('set-aside-auth'))).toBe(false);
    });

    it.each([
      ['is missing', { pathDocument: 'absent' }],
      ['names another resource', { pathDocument: { resource: 'https://mcp.example.test/mcp' } }],
    ] as const)('still refuses when the endpoint document %s', async (_label, options) => {
      const { server, requests } = publishedShape(options);
      expect(
        await reasonOf(discover(server, {}, { serverUrl: ENDPOINT, resourceMetadataUrl: LINKED })),
      ).toBe('resource-mismatch');
      expect(requests).not.toContain(
        'https://mcp.example.test/.well-known/oauth-protected-resource',
      );
    });

    it('does not fetch the endpoint document twice when the challenge links it', async () => {
      const { server, requests } = publishedShape();
      const info = await discover(
        server,
        {},
        { serverUrl: ENDPOINT, resourceMetadataUrl: PATH_DOCUMENT },
      );
      expect(info.resource).toBe(ENDPOINT);
      expect(requests.filter((url) => url === PATH_DOCUMENT)).toHaveLength(1);
    });

    it('refuses a linked document naming another resource when it is the endpoint document', async () => {
      const { server, requests } = publishedShape({
        pathDocument: { resource: 'https://mcp.example.test/mcp' },
      });
      expect(
        await reasonOf(
          discover(server, {}, { serverUrl: ENDPOINT, resourceMetadataUrl: PATH_DOCUMENT }),
        ),
      ).toBe('resource-mismatch');
      expect(requests.filter((url) => url === PATH_DOCUMENT)).toHaveLength(1);
    });
  });

  it('refuses authorization server metadata naming another issuer', async () => {
    const server = createFakeOAuthServer();
    server.overrides.issuer = 'https://evil.example.test/';
    expect(await reasonOf(discover(server))).toBe('issuer-mismatch');
  });

  it('refuses an http authorization server or token endpoint', async () => {
    const server = createFakeOAuthServer();
    server.overrides.tokenEndpoint = 'http://auth.example.test/token';
    expect(await reasonOf(discover(server))).toBe('insecure-endpoint');
    const plain = createFakeOAuthServer();
    plain.overrides.authorizationServers = ['http://auth.example.test/'];
    expect(await reasonOf(discover(plain))).toBe('insecure-endpoint');
    expect(await reasonOf(discover(plain, {}, { serverUrl: 'http://mcp.example.test/mcp' }))).toBe(
      'insecure-endpoint',
    );
  });

  it('refuses an authorization server that does not advertise PKCE S256', async () => {
    const server = createFakeOAuthServer();
    server.overrides.codeChallengeMethods = null;
    expect(await reasonOf(discover(server))).toBe('pkce-unsupported');
    server.overrides.codeChallengeMethods = ['plain'];
    expect(await reasonOf(discover(server))).toBe('pkce-unsupported');
  });

  it('never follows a resource_metadata link to another origin', async () => {
    const server = createFakeOAuthServer();
    const reason = await reasonOf(
      discover(server, {}, { resourceMetadataUrl: 'https://evil.example.test/prm' }),
    );
    expect(reason).toBe('resource-metadata-cross-origin');
    expect(server.requests.some((request) => request.url.includes('evil'))).toBe(false);
  });

  it('follows a same-origin resource_metadata link', async () => {
    const server = createFakeOAuthServer();
    const info = await discover(
      server,
      {},
      { resourceMetadataUrl: 'https://mcp.example.test/.well-known/oauth-protected-resource/mcp' },
    );
    expect(info.issuer).toBe(AS_URL);
  });

  it('does not fall back to the server root when there is no resource metadata', async () => {
    const server = createFakeOAuthServer();
    server.overrides.publishResourceMetadata = false;
    expect(await reasonOf(discover(server))).toBe('discovery-failed');
    expect(
      server.requests.some((request) =>
        request.url.startsWith('https://mcp.example.test/.well-known/oauth-authorization-server'),
      ),
    ).toBe(false);
  });

  it('prefers configured scopes over a challenge and over metadata', async () => {
    const server = createFakeOAuthServer();
    expect((await discover(server, {}, { challengeScope: 'files:admin' })).scope).toBe(
      'files:admin',
    );
    expect(
      (await discover(server, { scopes: ['a', 'b'] }, { challengeScope: 'files:admin' })).scope,
    ).toBe('a b');
  });

  it('takes a configured metadata URL straight to the authorization server', async () => {
    const server = createFakeOAuthServer();
    server.overrides.publishResourceMetadata = false;
    const info = await discover(server, { authServerMetadataUrl: AS_URL });
    expect(info.issuer).toBe(AS_URL);
    expect(server.requests.some((request) => request.url.startsWith('https://mcp.'))).toBe(false);
    const document = await discover(server, {
      authServerMetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server',
    });
    expect(document.issuer).toBe(AS_URL);
    server.overrides.issuer = 'https://evil.example.test/';
    expect(await reasonOf(discover(server, { authServerMetadataUrl: AS_URL }))).toBe(
      'issuer-mismatch',
    );
    expect(
      await reasonOf(
        discover(server, {
          authServerMetadataUrl: 'https://auth.example.test/.well-known/oauth-authorization-server',
        }),
      ),
    ).toBe('issuer-mismatch');
  });

  it('sends every request through the egress policy', async () => {
    const server = createFakeOAuthServer();
    const refused = discoverMCPOAuthServer({
      serverUrl: MCP_URL,
      config: {},
      fetch: createOAuthFetch(
        createNodeOAuthNetwork({ fetch: server.fetch, lookup: async () => ['10.0.0.8'] }),
      ),
    });
    expect(await reasonOf(refused)).toBe('egress-refused');
    expect(server.requests).toHaveLength(0);
  });
});
