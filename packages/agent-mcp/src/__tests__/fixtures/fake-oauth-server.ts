/**
 * An in-process authorization server and MCP resource for OAuth tests: a `fetch` that answers the
 * discovery, registration and token requests an OAuth client makes, and a "browser" that approves
 * an authorization request and returns the redirect it would follow. Nothing touches the network.
 */

import { createHash } from 'node:crypto';

import type { TEgressLookup } from '@robota-sdk/agent-core/node';

export const MCP_URL = 'https://mcp.example.test/mcp';
export const AS_URL = 'https://auth.example.test/';
export const SECRET_DESCRIPTION = 'leaked-secret-description';

export interface IFakeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

interface IPendingCode {
  readonly challenge: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly resource: string | null;
}

export interface IFakeOAuthServer {
  readonly fetch: typeof globalThis.fetch;
  readonly lookup: TEgressLookup;
  readonly requests: IFakeRequest[];
  /** Overrides applied to the next responses; tests mutate these. */
  readonly overrides: {
    resource?: string;
    issuer?: string;
    tokenEndpoint?: string;
    authorizationServers?: string[];
    publishResourceMetadata?: boolean;
    tokenRedirect?: string;
    issParameter?: 'match' | 'other' | 'omit';
    promisesIss?: boolean;
    expiresIn?: number;
  };
  readonly validRefreshTokens: Set<string>;
  tokenCalls(grant?: string): number;
  /** Approve an authorization request as a user would; returns the redirect the browser follows. */
  approve(authorizationUrl: URL): URL;
  /** Deny it, with an attacker-controlled description. */
  deny(authorizationUrl: URL): URL;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function createFakeOAuthServer(): IFakeOAuthServer {
  const requests: IFakeRequest[] = [];
  const overrides: IFakeOAuthServer['overrides'] = {};
  const codes = new Map<string, IPendingCode>();
  const validRefreshTokens = new Set<string>();
  let serial = 0;

  const metadata = (): Record<string, unknown> => ({
    issuer: overrides.issuer ?? AS_URL,
    authorization_endpoint: 'https://auth.example.test/authorize',
    token_endpoint: overrides.tokenEndpoint ?? 'https://auth.example.test/token',
    registration_endpoint: 'https://auth.example.test/register',
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
    authorization_response_iss_parameter_supported: overrides.promisesIss ?? true,
  });

  const issue = (): Response => {
    serial += 1;
    const refresh = `rt-${serial}`;
    validRefreshTokens.add(refresh);
    return json({
      access_token: `at-${serial}`,
      token_type: 'Bearer',
      expires_in: overrides.expiresIn ?? 3600,
      refresh_token: refresh,
      scope: 'files:read',
    });
  };

  const token = (form: URLSearchParams, headers: Headers): Response => {
    if (overrides.tokenRedirect !== undefined) {
      return new Response(null, { status: 307, headers: { location: overrides.tokenRedirect } });
    }
    const invalid = (): Response =>
      json({ error: 'invalid_grant', error_description: SECRET_DESCRIPTION }, 400);
    if (form.get('grant_type') === 'authorization_code') {
      const pending = codes.get(form.get('code') ?? '');
      codes.delete(form.get('code') ?? '');
      const basic = headers.get('authorization');
      const clientId =
        form.get('client_id') ??
        (basic === null ? null : Buffer.from(basic.slice(6), 'base64').toString().split(':')[0]);
      if (
        pending === undefined ||
        s256(form.get('code_verifier') ?? '') !== pending.challenge ||
        form.get('redirect_uri') !== pending.redirectUri ||
        clientId !== pending.clientId ||
        form.get('resource') !== pending.resource
      ) {
        return invalid();
      }
      return issue();
    }
    if (form.get('grant_type') === 'refresh_token') {
      const presented = form.get('refresh_token') ?? '';
      if (!validRefreshTokens.delete(presented)) return invalid();
      return issue();
    }
    return json({ error: 'unsupported_grant_type' }, 400);
  };

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = init?.body === undefined || init.body === null ? '' : String(init.body);
    requests.push({ method, url: url.href, headers, body });
    if (url.origin === 'https://mcp.example.test') {
      if (
        url.pathname === '/.well-known/oauth-protected-resource/mcp' &&
        overrides.publishResourceMetadata !== false
      ) {
        return json({
          resource: overrides.resource ?? MCP_URL,
          authorization_servers: overrides.authorizationServers ?? [AS_URL],
          scopes_supported: ['files:read'],
        });
      }
      return json({ error: 'not found' }, 404);
    }
    if (
      url.origin === 'https://other-auth.example.test' &&
      url.pathname === '/.well-known/oauth-authorization-server'
    ) {
      // A second, well-formed authorization server a resource may move to.
      return json({
        ...metadata(),
        issuer: 'https://other-auth.example.test/',
        authorization_endpoint: 'https://other-auth.example.test/authorize',
        token_endpoint: 'https://other-auth.example.test/token',
        registration_endpoint: 'https://other-auth.example.test/register',
      });
    }
    if (url.origin === 'https://auth.example.test') {
      if (url.pathname === '/.well-known/oauth-authorization-server') return json(metadata());
      if (url.pathname === '/register' && method === 'POST') {
        const registration = JSON.parse(body) as Record<string, unknown>;
        return json({ ...registration, client_id: 'dynamic-client' }, 201);
      }
      if (url.pathname === '/token' && method === 'POST') {
        return token(new URLSearchParams(body), headers);
      }
    }
    return json({ error: 'not found' }, 404);
  }) as typeof globalThis.fetch;

  const redirectFor = (authorizationUrl: URL, params: Record<string, string>): URL => {
    const redirect = new URL(authorizationUrl.searchParams.get('redirect_uri') ?? '');
    for (const [name, value] of Object.entries(params)) redirect.searchParams.set(name, value);
    const state = authorizationUrl.searchParams.get('state');
    if (state !== null) redirect.searchParams.set('state', state);
    const iss = overrides.issParameter ?? 'match';
    if (iss === 'match') redirect.searchParams.set('iss', overrides.issuer ?? AS_URL);
    if (iss === 'other') redirect.searchParams.set('iss', 'https://evil.example.test/');
    return redirect;
  };

  return {
    fetch,
    lookup: async () => ['203.0.113.10'],
    requests,
    overrides,
    validRefreshTokens,
    tokenCalls: (grant) =>
      requests.filter(
        (request) =>
          request.url === 'https://auth.example.test/token' &&
          (grant === undefined || new URLSearchParams(request.body).get('grant_type') === grant),
      ).length,
    approve: (authorizationUrl) => {
      if (authorizationUrl.searchParams.get('code_challenge_method') !== 'S256') {
        throw new Error('the fake server requires PKCE S256');
      }
      serial += 1;
      const code = `code-${serial}`;
      codes.set(code, {
        challenge: authorizationUrl.searchParams.get('code_challenge') ?? '',
        redirectUri: authorizationUrl.searchParams.get('redirect_uri') ?? '',
        clientId: authorizationUrl.searchParams.get('client_id') ?? '',
        resource: authorizationUrl.searchParams.get('resource'),
      });
      return redirectFor(authorizationUrl, { code });
    },
    deny: (authorizationUrl) =>
      redirectFor(authorizationUrl, {
        error: 'access_denied',
        error_description: `<script>${SECRET_DESCRIPTION}</script>`,
      }),
  };
}
