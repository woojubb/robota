/**
 * The OAuth authenticator: a signed-in server's stored token, sent as a bearer credential through
 * the client authentication port.
 *
 * - `authorize` returns the stored access token, refreshing it first when it has expired.
 * - A refresh runs once per identity at a time: in this process through the single-flight cache,
 *   across processes under the refresh lock, where the store is read again first — another process
 *   may already have refreshed, and a rotating refresh token spent twice is answered `invalid_grant`.
 * - A refresh goes only to the token endpoint stored with the tokens.
 * - A 401 refreshes once and retries. Before refreshing it rediscovers the authorization server;
 *   one that is no longer the stored issuer and token endpoint clears the tokens and asks for a new
 *   sign-in rather than sending the refresh token on.
 * - `invalid_grant`, or an expired token with nothing to refresh it, clears the tokens and asks for
 *   a new sign-in — unless the store, read again, now holds another refresh token: someone else
 *   rotated it, and theirs is kept. A 403 `insufficient_scope` fails and names the scope the
 *   server wants.
 * - A token is refreshed a little before it expires, but never earlier than half its lifetime, so
 *   a short-lived token is not refreshed on every request.
 *
 * Notices carry the server's name and, for a scope, the scope tokens — never a token, code or
 * secret, and never an authorization server's error text.
 */

import {
  extractWWWAuthenticateParams,
  refreshAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';

import { MCPSingleFlightCache } from '../single-flight.js';
import { discoverMCPOAuthServer, sameUrl } from './discovery.js';
import { MCPOAuthError, asOAuthError } from './errors.js';
import { credentialFromTokens } from './login.js';
import { createOAuthFetch } from './network.js';
import { oauthCredentialKey } from './store.js';

import type { OAuthClientInformation, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { IMCPOAuthConfig } from '../../definition/types.js';
import type {
  IMCPAuthorizationRejection,
  IMCPAuthorizationRequest,
  IMCPClientAuthenticator,
} from '../authentication.js';
import type { IMCPOAuthNetwork } from './network.js';
import type { IMCPOAuthRefreshLock } from './refresh-lock.js';
import type { IMCPOAuthCredential, IMCPOAuthCredentialStore } from './store.js';

/** Something the user must act on, named by the server it concerns. */
export type TMCPOAuthNotice =
  | { readonly kind: 'login-required'; readonly serverId: string }
  | { readonly kind: 'insufficient-scope'; readonly serverId: string; readonly scope?: string };

export interface IMCPOAuthAuthenticatorOptions {
  readonly serverId: string;
  readonly securityIdentity: string;
  readonly serverUrl: string;
  readonly config: IMCPOAuthConfig;
  readonly store: IMCPOAuthCredentialStore;
  readonly lock: IMCPOAuthRefreshLock;
  readonly network: IMCPOAuthNetwork;
  readonly notify: (notice: TMCPOAuthNotice) => void;
  readonly now?: () => number;
  /** A token this close to expiring is refreshed before it is sent; at most half its lifetime. */
  readonly expirySkewMs?: number;
}

export interface IMCPOAuthAuthenticator extends IMCPClientAuthenticator {
  /** Drop the token held in memory; the next request reads the store again (after a sign-out). */
  forget(): void;
  close(): void;
}

const DEFAULT_EXPIRY_SKEW_MS = 60_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
/** Scope tokens as RFC 6749 §3.3 allows them, space-separated; anything else is not shown. */
const SCOPE_LIST = /^[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*$/;
const MAX_SCOPE_NOTICE_LENGTH = 512;

interface IIssued {
  readonly generation: number;
  readonly accessToken: string;
}

function challengeOf(wwwAuthenticate: string | undefined): {
  resourceMetadataUrl?: string;
  scope?: string;
  error?: string;
} {
  if (wwwAuthenticate === undefined) return {};
  let parsed: ReturnType<typeof extractWWWAuthenticateParams>;
  try {
    parsed = extractWWWAuthenticateParams(
      new Response(null, { headers: { 'www-authenticate': wwwAuthenticate } }),
    );
  } catch {
    return {};
  }
  const scope =
    parsed.scope !== undefined &&
    parsed.scope.length <= MAX_SCOPE_NOTICE_LENGTH &&
    SCOPE_LIST.test(parsed.scope)
      ? parsed.scope
      : undefined;
  return {
    ...(parsed.resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: parsed.resourceMetadataUrl.href }),
    ...(scope === undefined ? {} : { scope }),
    ...(parsed.error === undefined ? {} : { error: parsed.error }),
  };
}

export function createOAuthAuthenticator(
  options: IMCPOAuthAuthenticatorOptions,
): IMCPOAuthAuthenticator {
  const key = oauthCredentialKey(options.securityIdentity, options.serverUrl);
  const now = options.now ?? Date.now;
  const skew = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
  /** The access token a server refused; the stored one is not usable while it is still that. */
  let refused: string | undefined;
  /** Set by a 401, consumed by the next load: rediscover before refreshing. */
  let rediscover: { resourceMetadataUrl?: string } | undefined;
  let loginNoticeShown = false;

  const loginRequired = async (clear: boolean): Promise<never> => {
    if (clear) await options.store.delete(key);
    if (!loginNoticeShown) {
      loginNoticeShown = true;
      options.notify({ kind: 'login-required', serverId: options.serverId });
    }
    throw new MCPOAuthError('login-required');
  };

  const expired = (credential: IMCPOAuthCredential): boolean => {
    if (credential.expiresAt === undefined) return false;
    const lifetime =
      credential.issuedAt === undefined ? undefined : credential.expiresAt - credential.issuedAt;
    const margin = lifetime === undefined ? skew : Math.min(skew, Math.max(0, lifetime / 2));
    return now() >= credential.expiresAt - margin;
  };
  const usable = (credential: IMCPOAuthCredential): boolean =>
    credential.accessToken !== refused && !expired(credential);

  const refresh = async (
    credential: IMCPOAuthCredential,
    signal: AbortSignal,
    afterRotation = false,
  ): Promise<IMCPOAuthCredential> => {
    const refreshToken = credential.refreshToken;
    if (refreshToken === undefined) return loginRequired(true);
    // The method registration settled on, when there was one; otherwise chosen from the metadata.
    const client: OAuthClientInformation & { token_endpoint_auth_method?: string } = {
      client_id: credential.clientId,
      ...(credential.clientSecret === undefined ? {} : { client_secret: credential.clientSecret }),
      ...(credential.tokenEndpointAuthMethod === undefined
        ? {}
        : { token_endpoint_auth_method: credential.tokenEndpointAuthMethod }),
    };
    let tokens: OAuthTokens;
    try {
      tokens = await refreshAuthorization(credential.issuer, {
        // Only the stored endpoint: what a later discovery says is not where this token goes.
        metadata: {
          issuer: credential.issuer,
          authorization_endpoint: credential.authorizationEndpoint,
          token_endpoint: credential.tokenEndpoint,
          response_types_supported: ['code'],
          ...(credential.tokenEndpointAuthMethods === undefined
            ? {}
            : { token_endpoint_auth_methods_supported: [...credential.tokenEndpointAuthMethods] }),
        },
        clientInformation: client,
        refreshToken,
        resource: new URL(credential.resource),
        fetchFn: createOAuthFetch(options.network, signal),
      });
    } catch (error) {
      if (!(error instanceof InvalidGrantError)) throw asOAuthError(error, 'refresh-failed');
      // Still under the lock. A holder that outlived its lock may have rotated the token meanwhile:
      // the refresh token refused is then not the stored one, and the stored one is not cleared.
      const current = await options.store.get(key);
      if (current === undefined) return loginRequired(false);
      if (current.refreshToken !== refreshToken) {
        if (usable(current)) return current;
        // Theirs is expired too: spend it once, never loop.
        return afterRotation ? loginRequired(false) : refresh(current, signal, true);
      }
      return loginRequired(true);
    }
    const {
      accessToken: _a,
      refreshToken: _r,
      expiresAt: _e,
      issuedAt: _i,
      scope: _s,
      ...base
    } = credential;
    const next = credentialFromTokens(tokens, base, now(), refreshToken);
    await options.store.set(key, next);
    return next;
  };

  const load = async (signal: AbortSignal): Promise<IMCPOAuthCredential> => {
    const challenge = rediscover;
    rediscover = undefined;
    const stored = await options.store.get(key);
    if (stored === undefined) return loginRequired(false);
    if (challenge === undefined && usable(stored)) return stored;
    // Rediscovery is network, so it runs before the lock; what it is compared with is read under it.
    const server =
      challenge === undefined
        ? undefined
        : await discoverMCPOAuthServer({
            serverUrl: options.serverUrl,
            config: options.config,
            fetch: createOAuthFetch(options.network, signal),
            ...(challenge.resourceMetadataUrl === undefined
              ? {}
              : { resourceMetadataUrl: challenge.resourceMetadataUrl }),
          });
    return options.lock.withLock(
      key,
      async () => {
        // Read again under the lock: another holder may have refreshed, or the user signed in
        // again, while this one waited. Only what is stored now is compared, refreshed or cleared.
        const current = await options.store.get(key);
        if (current === undefined) return loginRequired(false);
        if (
          server !== undefined &&
          (!sameUrl(server.issuer, current.issuer) ||
            !sameUrl(server.metadata.token_endpoint, current.tokenEndpoint))
        ) {
          return loginRequired(true);
        }
        if (usable(current)) return current;
        return refresh(current, signal);
      },
      signal,
    );
  };

  const cache = new MCPSingleFlightCache(async (signal) => {
    const credential = await load(signal);
    loginNoticeShown = false;
    return credential;
  });
  const issued = new WeakMap<object, IIssued>();
  let latestGeneration = 0;

  return {
    authorize: async (request: IMCPAuthorizationRequest) => {
      let { value, generation } = await cache.getEntry(request.signal);
      // A cached token that has since expired is replaced before it is sent, not after a 401.
      if (expired(value)) {
        cache.invalidate(generation);
        ({ value, generation } = await cache.getEntry(request.signal));
      }
      latestGeneration = Math.max(latestGeneration, generation);
      const headers = Object.freeze({ Authorization: `Bearer ${value.accessToken}` });
      issued.set(headers, { generation, accessToken: value.accessToken });
      return headers;
    },
    onRejected: async (rejection: IMCPAuthorizationRejection) => {
      const sent = issued.get(rejection.authorization);
      if (sent === undefined) return 'fail';
      const challenge = challengeOf(rejection.wwwAuthenticate);
      if (rejection.status === HTTP_FORBIDDEN) {
        if (challenge.error === 'insufficient_scope') {
          options.notify({
            kind: 'insufficient-scope',
            serverId: options.serverId,
            ...(challenge.scope === undefined ? {} : { scope: challenge.scope }),
          });
        }
        return 'fail';
      }
      if (rejection.status !== HTTP_UNAUTHORIZED) return 'fail';
      // A token already replaced: the retry joins its replacement.
      if (sent.generation < latestGeneration) return 'retry';
      if (refused !== sent.accessToken) {
        refused = sent.accessToken;
        rediscover = {
          ...(challenge.resourceMetadataUrl === undefined
            ? {}
            : { resourceMetadataUrl: challenge.resourceMetadataUrl }),
        };
      }
      cache.invalidate(sent.generation);
      return 'retry';
    },
    forget: () => cache.invalidate(latestGeneration),
    close: () => cache.close(),
  };
}
