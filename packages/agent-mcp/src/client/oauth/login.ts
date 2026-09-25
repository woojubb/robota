/**
 * Signing in to a remote MCP server: the authorization-code flow with PKCE, run once by the user
 * and ending with a credential in the store.
 *
 * - The authorization server is discovered and checked (`discovery.ts`).
 * - Without a pre-registered `clientId`, the client registers itself dynamically for the loopback
 *   redirect of this sign-in.
 * - The authorization request carries PKCE, a random `state` and the canonical server URL as the
 *   RFC 8707 resource indicator; the redirect is accepted only with that `state`
 *   (`callback.ts`) and, when it carries an RFC 9207 `iss`, only from the discovered issuer.
 * - With `readRedirect`, nothing listens: the user pastes the redirect URL their browser was sent
 *   to, and it is held to the same rules. The code alone is worthless without this process's PKCE
 *   verifier, so a redirect URI nothing listens on leaks nothing usable. With
 *   `readRedirectWhenBrowserFails`, the listener is used unless the browser cannot be opened; the
 *   listener then stops and the pasted redirect is read instead, under the same rules.
 * - The code is exchanged by a POST that never follows a redirect (`network.ts`).
 *
 * The host opens the browser. Nothing here prints, logs or throws a code, verifier, token or
 * secret.
 */

import { randomBytes } from 'node:crypto';

import {
  exchangeAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';

import {
  DEFAULT_CALLBACK_TIMEOUT_MS,
  createPastedRedirectAcceptor,
  freeLoopbackPort,
  loopbackRedirectUri,
  startOAuthCallbackServer,
} from './callback.js';
import { discoverMCPOAuthServer } from './discovery.js';
import { MCPOAuthError, asOAuthError } from './errors.js';
import { createOAuthFetch } from './network.js';

import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { IMCPOAuthConfig } from '../../definition/types.js';
import type { IMCPOAuthCallbackServer } from './callback.js';
import type { IMCPOAuthServerInfo } from './discovery.js';
import type { IMCPOAuthNetwork } from './network.js';
import type { IMCPOAuthRefreshLock } from './refresh-lock.js';
import type { IMCPOAuthCredential, IMCPOAuthCredentialStore } from './store.js';

export interface IMCPOAuthLoginInput {
  /** The server's security identity; with its canonical URL, the key its credential is kept by. */
  readonly securityIdentity: string;
  readonly serverUrl: string;
  readonly config: IMCPOAuthConfig;
  /** Only with a pre-registered `clientId`; asked for by the host, never read from a definition. */
  readonly clientSecret?: string;
  readonly store: IMCPOAuthCredentialStore;
  /** The refresh lock a session uses, so a refresh in flight cannot overwrite this sign-in. */
  readonly lock: IMCPOAuthRefreshLock;
  readonly network: IMCPOAuthNetwork;
  /**
   * Shows the user the authorization page, and — with `readRedirect` — the redirect URI it will
   * send the browser to. Always given an `https:` URL.
   */
  readonly openBrowser: (url: URL, redirectUri: string) => Promise<void>;
  /**
   * For a browser on another machine: reads the redirect URL the user pastes. `signal` aborts when
   * the sign-in is cancelled or `callbackTimeoutMs` passes; the read should stop then.
   */
  readonly readRedirect?: (signal: AbortSignal) => Promise<string>;
  /**
   * Without `readRedirect`: when `openBrowser` rejects, the redirect URL is read from this instead
   * of failing with `browser-failed` — unless it rejected with `cancelled`, which ends the sign-in.
   * The browser showed the user nothing then, so this is where the authorization URL is shown.
   */
  readonly readRedirectWhenBrowserFails?: (signal: AbortSignal) => Promise<string>;
  readonly clientName?: string;
  readonly callbackTimeoutMs?: number;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
}

export interface IMCPOAuthLoginResult {
  readonly issuer: string;
  readonly scope?: string;
}

const MS_PER_SECOND = 1000;

/** Only bearer tokens are sent; anything else would be sent as something it is not. */
export function credentialFromTokens(
  tokens: OAuthTokens,
  base: Omit<
    IMCPOAuthCredential,
    'accessToken' | 'refreshToken' | 'expiresAt' | 'issuedAt' | 'scope'
  >,
  now: number,
  previousRefreshToken?: string,
): IMCPOAuthCredential {
  if (tokens.token_type.toLowerCase() !== 'bearer') {
    throw new MCPOAuthError('token-type-unsupported');
  }
  const refreshToken = tokens.refresh_token ?? previousRefreshToken;
  const expiresIn = tokens.expires_in;
  return {
    ...base,
    accessToken: tokens.access_token,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresIn === undefined || !Number.isFinite(expiresIn)
      ? {}
      : { expiresAt: now + expiresIn * MS_PER_SECOND, issuedAt: now }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
  };
}

async function clientFor(
  input: IMCPOAuthLoginInput,
  server: IMCPOAuthServerInfo,
  redirectUri: string,
  fetchFn: ReturnType<typeof createOAuthFetch>,
): Promise<OAuthClientInformationMixed> {
  if (input.config.clientId !== undefined) {
    return {
      client_id: input.config.clientId,
      ...(input.clientSecret === undefined ? {} : { client_secret: input.clientSecret }),
    };
  }
  if (input.clientSecret !== undefined) throw new MCPOAuthError('client-secret-without-client-id');
  if (server.metadata.registration_endpoint === undefined) {
    throw new MCPOAuthError('registration-unavailable');
  }
  try {
    return await registerClient(server.issuer, {
      metadata: server.metadata,
      clientMetadata: {
        client_name: input.clientName ?? 'Robota',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
      ...(server.scope === undefined ? {} : { scope: server.scope }),
      fetchFn,
    });
  } catch (error) {
    throw asOAuthError(error, 'registration-failed');
  }
}

async function redirectReceiver(
  input: IMCPOAuthLoginInput,
  state: string,
): Promise<IMCPOAuthCallbackServer> {
  const read = input.readRedirect;
  if (read === undefined) {
    return startOAuthCallbackServer({
      expectedState: state,
      ...(input.config.callbackPort === undefined ? {} : { port: input.config.callbackPort }),
      ...(input.callbackTimeoutMs === undefined ? {} : { timeoutMs: input.callbackTimeoutMs }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
  const redirectUri = loopbackRedirectUri(input.config.callbackPort ?? (await freeLoopbackPort()));
  return pastedRedirectReceiver(input, read, state, redirectUri);
}

/** Reads the redirect URL the user pastes, held to the loopback listener's rules. */
function pastedRedirectReceiver(
  input: IMCPOAuthLoginInput,
  read: (signal: AbortSignal) => Promise<string>,
  state: string,
  redirectUri: string,
): IMCPOAuthCallbackServer {
  const acceptor = createPastedRedirectAcceptor({ expectedState: state, redirectUri });
  return {
    redirectUri,
    wait: async () => {
      // The same limit the loopback listener keeps, so a forgotten prompt does not wait forever.
      const timeout = AbortSignal.timeout(input.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS);
      const signal =
        input.signal === undefined ? timeout : AbortSignal.any([input.signal, timeout]);
      const aborted = new Promise<never>((_resolve, reject) => {
        const fail = (): void =>
          reject(new MCPOAuthError(timeout.aborted ? 'callback-timeout' : 'cancelled'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      });
      aborted.catch(() => undefined);
      let pasted: string;
      try {
        pasted = await Promise.race([read(signal), aborted]);
      } catch (error) {
        throw asOAuthError(error, 'cancelled');
      }
      return acceptor.accept(pasted);
    },
    close: async () => undefined,
  };
}

/** Run the whole sign-in and store its credential. Every failure is an {@link MCPOAuthError}. */
export async function runMCPOAuthLogin(input: IMCPOAuthLoginInput): Promise<IMCPOAuthLoginResult> {
  const fetchFn = createOAuthFetch(input.network, input.signal);
  const server = await discoverMCPOAuthServer({
    serverUrl: input.serverUrl,
    config: input.config,
    fetch: fetchFn,
  });
  const state = randomBytes(32).toString('base64url');
  let callback = await redirectReceiver(input, state);
  try {
    const client = await clientFor(input, server, callback.redirectUri, fetchFn);
    const resource = new URL(server.resource);
    let authorization: { authorizationUrl: URL; codeVerifier: string };
    try {
      authorization = await startAuthorization(server.issuer, {
        metadata: server.metadata,
        clientInformation: client,
        redirectUrl: callback.redirectUri,
        state,
        resource,
        ...(server.scope === undefined ? {} : { scope: server.scope }),
      });
    } catch (error) {
      throw asOAuthError(error, 'discovery-failed');
    }
    if (authorization.authorizationUrl.protocol !== 'https:') {
      throw new MCPOAuthError('insecure-endpoint');
    }
    try {
      await input.openBrowser(authorization.authorizationUrl, callback.redirectUri);
    } catch (error) {
      const fallback = input.readRedirectWhenBrowserFails;
      const cancelled = error instanceof MCPOAuthError && error.reason === 'cancelled';
      if (fallback === undefined || input.readRedirect !== undefined || cancelled) {
        throw asOAuthError(error, 'browser-failed');
      }
      // The redirect URI stays the one registered and authorized; only who receives it changes.
      const listener = callback;
      callback = pastedRedirectReceiver(input, fallback, state, listener.redirectUri);
      await listener.close();
    }
    const redirect = await callback.wait();
    // RFC 9207: an `iss` must be this issuer's, and one the server promised must be present.
    const promised =
      (server.metadata as Record<string, unknown>)[
        'authorization_response_iss_parameter_supported'
      ] === true;
    if (
      (redirect.iss !== undefined && redirect.iss !== server.metadata.issuer) ||
      (redirect.iss === undefined && promised)
    ) {
      throw new MCPOAuthError('issuer-parameter-mismatch');
    }
    let tokens: OAuthTokens;
    try {
      tokens = await exchangeAuthorization(server.issuer, {
        metadata: server.metadata,
        clientInformation: client,
        authorizationCode: redirect.code,
        codeVerifier: authorization.codeVerifier,
        redirectUri: callback.redirectUri,
        resource,
        fetchFn,
      });
    } catch (error) {
      throw asOAuthError(error, 'token-exchange-failed');
    }
    const credential = credentialFromTokens(
      tokens,
      {
        issuer: server.issuer,
        authorizationEndpoint: server.metadata.authorization_endpoint,
        tokenEndpoint: server.metadata.token_endpoint,
        ...(server.metadata.token_endpoint_auth_methods_supported === undefined
          ? {}
          : { tokenEndpointAuthMethods: server.metadata.token_endpoint_auth_methods_supported }),
        resource: server.resource,
        clientId: client.client_id,
        ...(client.client_secret === undefined ? {} : { clientSecret: client.client_secret }),
        ...('token_endpoint_auth_method' in client &&
        client.token_endpoint_auth_method !== undefined
          ? { tokenEndpointAuthMethod: client.token_endpoint_auth_method }
          : {}),
      },
      (input.now ?? Date.now)(),
    );
    const key = { securityIdentity: input.securityIdentity, serverUrl: server.resource };
    await input.lock.withLock(key, () => input.store.set(key, credential), input.signal);
    return {
      issuer: server.issuer,
      ...(credential.scope === undefined ? {} : { scope: credential.scope }),
    };
  } finally {
    await callback.close();
  }
}
