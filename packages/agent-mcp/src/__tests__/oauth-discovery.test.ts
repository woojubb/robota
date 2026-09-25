/**
 * Discovery is ours, not the SDK's fallback: each link — resource metadata, authorization server,
 * issuer, endpoints — is checked against the one before it, and nothing is guessed.
 */

import { describe, expect, it } from 'vitest';

import { discoverMCPOAuthServer } from '../client/oauth/discovery.js';
import { MCPOAuthError } from '../client/oauth/errors.js';
import { createOAuthFetch } from '../client/oauth/network.js';
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
    fetch: createOAuthFetch({ fetch: server.fetch, lookup: server.lookup }),
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
      fetch: createOAuthFetch({ fetch: server.fetch, lookup: async () => ['10.0.0.8'] }),
    });
    expect(await reasonOf(refused)).toBe('egress-refused');
    expect(server.requests).toHaveLength(0);
  });
});
