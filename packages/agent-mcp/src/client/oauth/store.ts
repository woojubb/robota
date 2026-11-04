/**
 * Where OAuth credentials are kept, behind the narrowest interface that can hold them: `get`,
 * `set` and `delete` by key. Nothing outside a store knows how it keeps them, so a file store and
 * an operating-system keychain are interchangeable; coordination between readers — one refresh at
 * a time, across processes — belongs to the caller, not to the store.
 *
 * A credential is keyed by the server's security identity AND its canonical URL. The identity
 * alone would let an edited definition send a stored token to a new URL; the URL alone would let
 * a second definition that names the same URL — a shadowing project entry — use tokens another
 * definition signed in for.
 *
 * The issuer, token endpoint and client travel with the tokens, so a refresh goes to the endpoint
 * the tokens came from and nowhere a later discovery points.
 *
 * This entry holds the port. A store that needs a host — the owner-only files of
 * `createFileOAuthCredentialStore` on `@robota-sdk/agent-mcp/node` — is injected by the caller.
 */

import { canonicalServerUrl } from './discovery.js';

export interface IMCPOAuthCredentialKey {
  readonly securityIdentity: string;
  /** The canonical server URL. */
  readonly serverUrl: string;
}

export interface IMCPOAuthCredential {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly tokenEndpointAuthMethods?: readonly string[];
  /** The client authentication method dynamic registration returned, if any. */
  readonly tokenEndpointAuthMethod?: string;
  /** The RFC 8707 resource the tokens were issued for. */
  readonly resource: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** Epoch milliseconds; absent when the server did not say. */
  readonly expiresAt?: number;
  /** Epoch milliseconds the access token was issued at; with `expiresAt`, its lifetime. */
  readonly issuedAt?: number;
  readonly scope?: string;
}

export interface IMCPOAuthCredentialStore {
  get(key: IMCPOAuthCredentialKey): Promise<IMCPOAuthCredential | undefined>;
  set(key: IMCPOAuthCredentialKey, credential: IMCPOAuthCredential): Promise<void>;
  delete(key: IMCPOAuthCredentialKey): Promise<void>;
}

/** The key a server's credential is kept by. Throws for a server URL that is not `https`. */
export function oauthCredentialKey(
  securityIdentity: string,
  serverUrl: string,
): IMCPOAuthCredentialKey {
  return { securityIdentity, serverUrl: canonicalServerUrl(serverUrl) };
}
