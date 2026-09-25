/**
 * Finding a remote MCP server's authorization server — done here rather than by the SDK's
 * `discoverOAuthServerInfo`, which silently falls back to treating the server's root as its
 * authorization server and never checks that the metadata it fetched describes the issuer it asked.
 *
 * Every link in the chain is checked against the one before it:
 * - the protected-resource metadata must describe this server (its `resource` is the canonical
 *   server URL), and a `resource_metadata` link from a 401 is followed only on the server's origin;
 * - the authorization server metadata must name, as its `issuer`, the authorization server the
 *   resource pointed to (or that the definition configured);
 * - the server, the authorization server and its authorization, token and registration endpoints
 *   are all `https`, and the authorization server advertises PKCE with `S256`.
 * A server that publishes no protected-resource metadata has no authorization server this client
 * will guess at.
 */

import {
  buildDiscoveryUrls,
  discoverAuthorizationServerMetadata,
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

import { MCPOAuthError, asOAuthError } from './errors.js';

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type {
  AuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { IMCPOAuthConfig } from '../../definition/types.js';

/** What sign-in and refresh need to know about a server's authorization server. */
export interface IMCPOAuthServerInfo {
  /** The canonical server URL, sent as the RFC 8707 resource indicator. */
  readonly resource: string;
  readonly issuer: string;
  readonly metadata: AuthorizationServerMetadata;
  /** The scope to request, space-separated; absent when nothing names one. */
  readonly scope?: string;
}

export interface IMCPOAuthDiscoveryInput {
  readonly serverUrl: string;
  readonly config: IMCPOAuthConfig;
  readonly fetch: FetchLike;
  /** From a 401's `WWW-Authenticate`; followed only on the server's own origin. */
  readonly resourceMetadataUrl?: string;
  /** From a 401's `WWW-Authenticate`; used when the definition names no scopes. */
  readonly challengeScope?: string;
}

function parseHttps(value: string): URL {
  if (!URL.canParse(value)) throw new MCPOAuthError('response-invalid');
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new MCPOAuthError('insecure-endpoint');
  return url;
}

/**
 * The server URL as an OAuth resource: `https`, normalised by URL parsing (lower-case scheme and
 * host, default port dropped), without a fragment.
 */
export function canonicalServerUrl(serverUrl: string): string {
  const url = parseHttps(serverUrl);
  url.hash = '';
  return url.href;
}

/** Two URLs name the same thing once both are normalised. */
export function sameUrl(a: string, b: string): boolean {
  if (!URL.canParse(a) || !URL.canParse(b)) return false;
  return new URL(a).href === new URL(b).href;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MCPOAuthError('response-invalid');
  }
}

async function fetchResourceMetadata(
  url: URL,
  fetch: FetchLike,
): Promise<OAuthProtectedResourceMetadata | undefined> {
  const response = await fetch(url, {
    headers: { 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION, Accept: 'application/json' },
  });
  if (response.status >= 400 && response.status < 500) return undefined;
  if (!response.ok) throw new MCPOAuthError('discovery-failed');
  const parsed = OAuthProtectedResourceMetadataSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MCPOAuthError('response-invalid');
  return parsed.data;
}

/** RFC 9728 §3: the path-specific well-known location first, then the origin's. */
async function discoverResourceMetadata(
  resource: URL,
  input: IMCPOAuthDiscoveryInput,
): Promise<OAuthProtectedResourceMetadata> {
  if (input.resourceMetadataUrl !== undefined) {
    const linked = parseHttps(input.resourceMetadataUrl);
    if (linked.origin !== resource.origin) {
      throw new MCPOAuthError('resource-metadata-cross-origin');
    }
    const metadata = await fetchResourceMetadata(linked, input.fetch);
    if (metadata === undefined) throw new MCPOAuthError('discovery-failed');
    return metadata;
  }
  const path = resource.pathname.endsWith('/') ? resource.pathname.slice(0, -1) : resource.pathname;
  const candidates = [
    ...(path === '' ? [] : [new URL(`/.well-known/oauth-protected-resource${path}`, resource)]),
    new URL('/.well-known/oauth-protected-resource', resource),
  ];
  for (const candidate of candidates) {
    const metadata = await fetchResourceMetadata(candidate, input.fetch);
    if (metadata !== undefined) return metadata;
  }
  throw new MCPOAuthError('discovery-failed');
}

/**
 * A configured metadata URL. One naming a well-known document is fetched as that document, and
 * the issuer it declares must be one whose well-known locations include it (RFC 8414 §3.3);
 * otherwise it names the authorization server itself and is discovered like any other.
 */
async function configuredMetadata(
  configured: URL,
  fetch: FetchLike,
): Promise<{ issuer: string; metadata: AuthorizationServerMetadata }> {
  if (!configured.pathname.includes('/.well-known/')) {
    return {
      issuer: configured.href,
      metadata: await authorizationServerMetadata(configured, fetch),
    };
  }
  const response = await fetch(configured, {
    headers: { 'MCP-Protocol-Version': LATEST_PROTOCOL_VERSION, Accept: 'application/json' },
  });
  if (!response.ok) throw new MCPOAuthError('discovery-failed');
  const parsed = OAuthMetadataSchema.safeParse(await readJson(response));
  if (!parsed.success) throw new MCPOAuthError('response-invalid');
  const issuer = parseHttps(parsed.data.issuer);
  if (!buildDiscoveryUrls(issuer).some(({ url }) => url.href === configured.href)) {
    throw new MCPOAuthError('issuer-mismatch');
  }
  return { issuer: issuer.href, metadata: parsed.data };
}

async function authorizationServerMetadata(
  authorizationServer: URL,
  fetch: FetchLike,
): Promise<AuthorizationServerMetadata> {
  let metadata: AuthorizationServerMetadata | undefined;
  try {
    metadata = await discoverAuthorizationServerMetadata(authorizationServer, { fetchFn: fetch });
  } catch (error) {
    throw asOAuthError(error, 'discovery-failed');
  }
  if (metadata === undefined) throw new MCPOAuthError('discovery-failed');
  if (!sameUrl(metadata.issuer, authorizationServer.href)) {
    throw new MCPOAuthError('issuer-mismatch');
  }
  return metadata;
}

/**
 * The metadata of an authorization server already known by its issuer — one tokens were stored
 * from — checked to name that issuer. Every failure is an {@link MCPOAuthError}.
 */
export async function fetchIssuerMetadata(
  issuer: string,
  fetch: FetchLike,
): Promise<AuthorizationServerMetadata> {
  try {
    return await authorizationServerMetadata(parseHttps(issuer), fetch);
  } catch (error) {
    throw asOAuthError(error, 'discovery-failed');
  }
}

/** Discover and check a server's authorization server. Every failure is an {@link MCPOAuthError}. */
export async function discoverMCPOAuthServer(
  input: IMCPOAuthDiscoveryInput,
): Promise<IMCPOAuthServerInfo> {
  try {
    const resource = canonicalServerUrl(input.serverUrl);
    let issuer: string;
    let metadata: AuthorizationServerMetadata;
    let advertised: readonly string[] | undefined;
    if (input.config.authServerMetadataUrl !== undefined) {
      ({ issuer, metadata } = await configuredMetadata(
        parseHttps(input.config.authServerMetadataUrl),
        input.fetch,
      ));
    } else {
      const resourceMetadata = await discoverResourceMetadata(new URL(resource), input);
      if (!sameUrl(resourceMetadata.resource, resource)) {
        throw new MCPOAuthError('resource-mismatch');
      }
      const authorizationServer = resourceMetadata.authorization_servers?.[0];
      if (authorizationServer === undefined) throw new MCPOAuthError('discovery-failed');
      const server = parseHttps(authorizationServer);
      metadata = await authorizationServerMetadata(server, input.fetch);
      issuer = server.href;
      advertised = resourceMetadata.scopes_supported;
    }
    parseHttps(metadata.authorization_endpoint);
    parseHttps(metadata.token_endpoint);
    if (metadata.registration_endpoint !== undefined) parseHttps(metadata.registration_endpoint);
    // The MCP authorization spec: without advertised S256 there is no PKCE to rely on.
    if (metadata.code_challenge_methods_supported?.includes('S256') !== true) {
      throw new MCPOAuthError('pkce-unsupported');
    }
    const scope =
      input.config.scopes?.join(' ') ??
      input.challengeScope ??
      (advertised === undefined || advertised.length === 0 ? undefined : advertised.join(' '));
    return { resource, issuer, metadata, ...(scope === undefined ? {} : { scope }) };
  } catch (error) {
    throw asOAuthError(error, 'discovery-failed');
  }
}
