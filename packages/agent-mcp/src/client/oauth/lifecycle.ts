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
 * - `unsupported`: the authorization server advertises no revocation endpoint.
 * - `failed`: a revocation was not confirmed; `revocationFailure` names the step.
 * - `not-attempted`: there was no readable credential to revoke.
 */
export type TMCPOAuthRevocationOutcome = 'revoked' | 'unsupported' | 'failed' | 'not-attempted';

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
}

const HTTP_OK = 200;

function clientAuthentication(
  credential: IMCPOAuthCredential,
  body: URLSearchParams,
): Record<string, string> {
  const client = {
    client_id: credential.clientId,
    ...(credential.clientSecret === undefined ? {} : { client_secret: credential.clientSecret }),
    ...(credential.tokenEndpointAuthMethod === undefined
      ? {}
      : { token_endpoint_auth_method: credential.tokenEndpointAuthMethod }),
  };
  // The method the refresh uses for the same client, so the server sees one client either way.
  const method = selectClientAuthMethod(client, [...(credential.tokenEndpointAuthMethods ?? [])]);
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

async function revokeOne(
  endpoint: string,
  credential: IMCPOAuthCredential,
  token: string,
  hint: 'refresh_token' | 'access_token',
  fetchFn: FetchLike,
): Promise<void> {
  const body = new URLSearchParams({ token, token_type_hint: hint });
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    ...clientAuthentication(credential, body),
  };
  const response = await fetchFn(endpoint, { method: 'POST', headers, body });
  // RFC 7009 §2.2: 200 whether or not the token was still valid; the body says nothing we need.
  if (response.status !== HTTP_OK) throw new MCPOAuthError('revocation-failed');
}

/** Revoke the refresh token, then the access token, at the stored issuer's revocation endpoint. */
async function revoke(
  credential: IMCPOAuthCredential,
  network: IMCPOAuthNetwork,
  signal: AbortSignal | undefined,
): Promise<Pick<IMCPOAuthLogoutResult, 'revocation' | 'revocationFailure'>> {
  const fetchFn = createOAuthFetch(network, signal);
  try {
    const metadata = await fetchIssuerMetadata(credential.issuer, fetchFn);
    // Not in the OpenID Connect variant of the SDK's metadata type, though either may carry it.
    const endpoint = (metadata as Record<string, unknown>)['revocation_endpoint'];
    if (endpoint === undefined) return { revocation: 'unsupported' };
    if (
      typeof endpoint !== 'string' ||
      !URL.canParse(endpoint) ||
      new URL(endpoint).protocol !== 'https:'
    ) {
      throw new MCPOAuthError('insecure-endpoint');
    }
    // Each token is revoked on its own: a refused refresh token still leaves the access token worth
    // revoking. The first failure is the one reported.
    const tokens: [string, 'refresh_token' | 'access_token'][] = [
      ...(credential.refreshToken === undefined
        ? []
        : [[credential.refreshToken, 'refresh_token'] as [string, 'refresh_token']]),
      [credential.accessToken, 'access_token'],
    ];
    let failure: unknown;
    for (const [token, hint] of tokens) {
      try {
        await revokeOne(endpoint, credential, token, hint, fetchFn);
      } catch (error) {
        failure ??= error;
      }
    }
    if (failure !== undefined) throw failure;
    return { revocation: 'revoked' };
  } catch (error) {
    return {
      revocation: 'failed',
      revocationFailure: asOAuthError(error, 'revocation-failed').reason,
    };
  }
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
