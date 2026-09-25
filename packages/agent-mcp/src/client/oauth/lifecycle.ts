/**
 * What happens to a sign-in after it is made: its state as the user may see it, and signing out.
 *
 * - The state names only whether a credential is stored and usable — never a token, a scope, an
 *   expiry time or anything else derived from one.
 * - Signing out deletes the stored credential under the refresh lock, so a refresh in flight
 *   cannot store it again, and then asks the authorization server to revoke the tokens (RFC 7009)
 *   when it advertises a revocation endpoint. The local delete comes first and never depends on
 *   the revocation: a server that is down or refuses must not keep the user signed in.
 * - Revocation is a POST like a refresh: through the egress policy, byte-bounded, never following
 *   a redirect, authenticated as the client the tokens were issued to, and sent only to the
 *   endpoint the stored issuer advertises. Its outcome is reported by a fixed reason only.
 */

import { selectClientAuthMethod } from '@modelcontextprotocol/sdk/client/auth.js';

import { fetchIssuerMetadata } from './discovery.js';
import { MCPOAuthError, asOAuthError } from './errors.js';
import { createOAuthFetch } from './network.js';
import { oauthCredentialKey } from './store.js';

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { TMCPOAuthFailure } from './errors.js';
import type { IMCPOAuthNetwork } from './network.js';
import type { IMCPOAuthRefreshLock } from './refresh-lock.js';
import type { IMCPOAuthCredential, IMCPOAuthCredentialStore } from './store.js';

/**
 * - `signed-in`: a stored token that is still valid.
 * - `expired-refreshable`: the token expired, and a refresh token will replace it on next use.
 * - `sign-in-required`: something is stored but cannot be used — expired with nothing to refresh
 *   it, or unreadable.
 * - `signed-out`: nothing is stored.
 */
export type TMCPOAuthCredentialState =
  'signed-in' | 'expired-refreshable' | 'sign-in-required' | 'signed-out';

export interface IMCPOAuthCredentialStateInput {
  readonly securityIdentity: string;
  readonly serverUrl: string;
  readonly store: IMCPOAuthCredentialStore;
  readonly now?: () => number;
}

export async function readMCPOAuthCredentialState(
  input: IMCPOAuthCredentialStateInput,
): Promise<TMCPOAuthCredentialState> {
  let credential: IMCPOAuthCredential | undefined;
  try {
    credential = await input.store.get(oauthCredentialKey(input.securityIdentity, input.serverUrl));
  } catch {
    return 'sign-in-required';
  }
  if (credential === undefined) return 'signed-out';
  if (credential.expiresAt === undefined || (input.now ?? Date.now)() < credential.expiresAt) {
    return 'signed-in';
  }
  return credential.refreshToken === undefined ? 'sign-in-required' : 'expired-refreshable';
}

/**
 * - `revoked`: every stored token was revoked.
 * - `partial`: some were; `tokens` says which, and why each other one was not.
 * - `unsupported`: the authorization server advertises no revocation endpoint.
 * - `failed`: no token was revoked; `revocationFailure` names the first step that refused.
 * - `not-attempted`: there was no readable credential to revoke.
 */
export type TMCPOAuthRevocationOutcome =
  'revoked' | 'partial' | 'unsupported' | 'failed' | 'not-attempted';

/** One stored token's revocation, by its kind — never its value. */
export interface IMCPOAuthTokenRevocation {
  readonly token: 'refresh_token' | 'access_token';
  readonly revoked: boolean;
  readonly failure?: TMCPOAuthFailure;
}

export interface IMCPOAuthLogoutInput {
  readonly securityIdentity: string;
  readonly serverUrl: string;
  readonly store: IMCPOAuthCredentialStore;
  readonly lock: IMCPOAuthRefreshLock;
  readonly network: IMCPOAuthNetwork;
  readonly signal?: AbortSignal;
}

export interface IMCPOAuthLogoutResult {
  /** Whether a credential, readable or not, was stored before this sign-out. */
  readonly removed: boolean;
  readonly revocation: TMCPOAuthRevocationOutcome;
  readonly revocationFailure?: TMCPOAuthFailure;
  /** Each token a revocation was asked for, in the order asked. */
  readonly tokens?: readonly IMCPOAuthTokenRevocation[];
}

const HTTP_OK = 200;

function clientAuthentication(
  credential: IMCPOAuthCredential,
  revocationAuthMethods: readonly string[] | undefined,
  body: URLSearchParams,
): Record<string, string> {
  const client = {
    client_id: credential.clientId,
    ...(credential.clientSecret === undefined ? {} : { client_secret: credential.clientSecret }),
    ...(credential.tokenEndpointAuthMethod === undefined
      ? {}
      : { token_endpoint_auth_method: credential.tokenEndpointAuthMethod }),
  };
  // The methods the revocation endpoint advertises; without them, those of the token endpoint,
  // so the server sees the same client authentication as a refresh.
  const method = selectClientAuthMethod(client, [
    ...(revocationAuthMethods ?? credential.tokenEndpointAuthMethods ?? []),
  ]);
  if (method === 'client_secret_basic' && credential.clientSecret !== undefined) {
    const pair = `${credential.clientId}:${credential.clientSecret}`;
    return { Authorization: `Basic ${Buffer.from(pair, 'utf8').toString('base64')}` };
  }
  body.set('client_id', credential.clientId);
  if (method === 'client_secret_post' && credential.clientSecret !== undefined) {
    body.set('client_secret', credential.clientSecret);
  }
  return {};
}

interface IRevocationEndpoint {
  readonly url: string;
  readonly authMethods?: readonly string[];
}

/** RFC 7009 §2.2.1's `unsupported_token_type`, read as that fixed code and nothing else. */
async function refusedTokenType(response: Response): Promise<boolean> {
  try {
    const body: unknown = await response.json();
    return (
      typeof body === 'object' &&
      body !== null &&
      (body as Record<string, unknown>)['error'] === 'unsupported_token_type'
    );
  } catch {
    return false;
  }
}

async function revokeOne(
  endpoint: IRevocationEndpoint,
  credential: IMCPOAuthCredential,
  token: string,
  hint: 'refresh_token' | 'access_token',
  fetchFn: FetchLike,
): Promise<IMCPOAuthTokenRevocation> {
  const body = new URLSearchParams({ token, token_type_hint: hint });
  try {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...clientAuthentication(credential, endpoint.authMethods, body),
    };
    const response = await fetchFn(endpoint.url, { method: 'POST', headers, body });
    // RFC 7009 §2.2: 200 whether or not the token was still valid.
    if (response.status === HTTP_OK) return { token: hint, revoked: true };
    const failure = (await refusedTokenType(response))
      ? 'token-type-not-revocable'
      : 'revocation-failed';
    return { token: hint, revoked: false, failure };
  } catch (error) {
    return {
      token: hint,
      revoked: false,
      failure: asOAuthError(error, 'revocation-failed').reason,
    };
  }
}

function revocationEndpoint(metadata: Record<string, unknown>): IRevocationEndpoint | undefined {
  const url = metadata['revocation_endpoint'];
  if (url === undefined) return undefined;
  if (typeof url !== 'string' || !URL.canParse(url) || new URL(url).protocol !== 'https:') {
    throw new MCPOAuthError('insecure-endpoint');
  }
  const methods = metadata['revocation_endpoint_auth_methods_supported'];
  return Array.isArray(methods) && methods.every((method) => typeof method === 'string')
    ? { url, authMethods: methods as string[] }
    : { url };
}

/** Revoke the refresh token, then the access token, at the stored issuer's revocation endpoint. */
async function revoke(
  credential: IMCPOAuthCredential,
  network: IMCPOAuthNetwork,
  signal: AbortSignal | undefined,
): Promise<Omit<IMCPOAuthLogoutResult, 'removed'>> {
  const fetchFn = createOAuthFetch(network, signal);
  let endpoint: IRevocationEndpoint | undefined;
  try {
    // Either variant of the SDK's metadata type may carry the revocation fields.
    const metadata = await fetchIssuerMetadata(credential.issuer, fetchFn);
    endpoint = revocationEndpoint(metadata as Record<string, unknown>);
  } catch (error) {
    return {
      revocation: 'failed',
      revocationFailure: asOAuthError(error, 'revocation-failed').reason,
    };
  }
  if (endpoint === undefined) return { revocation: 'unsupported' };
  // Each token is revoked on its own: a refused refresh token still leaves the access token worth
  // revoking, and the other way round.
  const tokens: IMCPOAuthTokenRevocation[] = [];
  if (credential.refreshToken !== undefined) {
    tokens.push(
      await revokeOne(endpoint, credential, credential.refreshToken, 'refresh_token', fetchFn),
    );
  }
  tokens.push(
    await revokeOne(endpoint, credential, credential.accessToken, 'access_token', fetchFn),
  );
  const failure = tokens.find((token) => !token.revoked)?.failure;
  const revoked = tokens.filter((token) => token.revoked).length;
  return {
    revocation: failure === undefined ? 'revoked' : revoked === 0 ? 'failed' : 'partial',
    ...(failure === undefined ? {} : { revocationFailure: failure }),
    tokens,
  };
}

/**
 * Sign out of a server: delete its stored credential, then revoke its tokens where the
 * authorization server allows. Throws only when the credential could not be deleted.
 */
export async function runMCPOAuthLogout(
  input: IMCPOAuthLogoutInput,
): Promise<IMCPOAuthLogoutResult> {
  const key = oauthCredentialKey(input.securityIdentity, input.serverUrl);
  const { removed, credential } = await input.lock.withLock(
    key,
    async () => {
      let stored: IMCPOAuthCredential | undefined;
      let unreadable = false;
      try {
        stored = await input.store.get(key);
      } catch {
        // allow-fallback: an unreadable record is still deleted; there is just nothing to revoke.
        unreadable = true;
      }
      await input.store.delete(key);
      return { removed: unreadable || stored !== undefined, credential: stored };
    },
    input.signal,
  );
  if (credential === undefined) return { removed, revocation: 'not-attempted' };
  return { removed, ...(await revoke(credential, input.network, input.signal)) };
}
