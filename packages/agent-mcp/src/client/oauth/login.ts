/**
 * Signing in to a remote MCP server: the authorization-code flow with PKCE, run once by the user
 * and ending with a credential in the store.
 *
 * - The authorization server is discovered and checked (`discovery.ts`).
 * - The client is, in this order: the pre-registered `clientId`; the host's client metadata document
 *   (its address is the client id) when the authorization server accepts those and the document lists
 *   this sign-in's redirect address; a dynamic registration for that redirect address, which says
 *   whether it is a native or a web application; else the sign-in is refused and the person is told to
 *   register a client.
 * - The authorization request carries PKCE, a random `state` and the validated RFC 8707 resource
 *   indicator, and any extra parameters the config names (never one of these); the redirect is accepted only with that `state`
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

import {
  exchangeAuthorization,
  registerClient,
  resolveClientMetadata,
  startAuthorization,
  validateClientMetadataUrl,
} from '@modelcontextprotocol/client';
import { randomHex } from '@robota-sdk/agent-core';

import {
  DEFAULT_CALLBACK_TIMEOUT_MS,
  createPastedRedirectAcceptor,
  loopbackRedirectUri,
} from './callback.js';
import { checkAuthorizationParams } from '../../definition/oauth-params.js';
import { canonicalServerUrl, discoverMCPOAuthServer } from './discovery.js';
import { MCPOAuthError, asOAuthError } from './errors.js';
import { createOAuthFetch } from './network.js';

import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/client';
import type { IMCPOAuthConfig } from '../../definition/types.js';
import type { IMCPOAuthCallbackListener, IMCPOAuthCallbackServer } from './callback.js';
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
  /**
   * The `https` address of a client metadata document the host publishes (a JSON file naming this
   * client, with its own address as `client_id` and its redirect addresses). It stands in for a
   * registration at an authorization server that advertises support for such documents, so nothing is
   * registered there and nothing is kept about this client at the server.
   */
  readonly clientMetadataUrl?: string;
  readonly store: IMCPOAuthCredentialStore;
  /** The refresh lock a session uses, so a refresh in flight cannot overwrite this sign-in. */
  readonly lock: IMCPOAuthRefreshLock;
  readonly network: IMCPOAuthNetwork;
  /**
   * Where a browser's redirect lands on this machine. Absent, the sign-in cannot listen: it fails
   * with `callback-unavailable` unless `readRedirect` is given with the definition's `callbackPort`,
   * since that is the one redirect that needs neither a listener nor a free port to pick.
   */
  readonly callbackListener?: IMCPOAuthCallbackListener;
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
  readonly clientName: string;
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

/**
 * Whether an address can name this client: `https` with a path, and no user name, password or
 * fragment, since the address is sent to the authorization server as the client id.
 */
export function isClientMetadataUrl(value: string): boolean {
  try {
    validateClientMetadataUrl(value);
  } catch {
    // allow-fallback: the SDK's reason adds nothing to the answer, which is only whether the address can be used.
    return false;
  }
  const url = new URL(value);
  return url.username === '' && url.password === '' && url.hash === '';
}

/** The redirect addresses a client metadata document lists, when it is the document of its own address. */
async function listedRedirects(
  url: string,
  fetchFn: ReturnType<typeof createOAuthFetch>,
  signal: AbortSignal | undefined,
): Promise<readonly string[] | undefined> {
  let document: unknown;
  try {
    const response = await fetchFn(url, { headers: { accept: 'application/json' } });
    if (!response.ok) return undefined;
    document = await response.json();
  } catch {
    // allow-fallback: a document that cannot be read is one this sign-in cannot rely on; the caller registers or refuses.
    if (signal?.aborted === true) throw new MCPOAuthError('cancelled');
    return undefined;
  }
  if (typeof document !== 'object' || document === null) return undefined;
  const record = document as Record<string, unknown>;
  const redirects = record['redirect_uris'];
  if (record['client_id'] !== url) return undefined;
  return Array.isArray(redirects) && redirects.every((entry) => typeof entry === 'string')
    ? (redirects as string[])
    : undefined;
}

/**
 * The host's client metadata document as this sign-in's client: only when the authorization server
 * accepts such documents and the document is this client's and lists the redirect address this sign-in
 * uses, since the server would otherwise refuse the sign-in after the person has been sent to it.
 * `undefined` when there is no document or the server does not take one; `unusable` when there is a
 * document the server would take but this sign-in cannot rely on it.
 */
async function documentClient(
  input: IMCPOAuthLoginInput,
  server: IMCPOAuthServerInfo,
  redirectUri: string,
  fetchFn: ReturnType<typeof createOAuthFetch>,
): Promise<OAuthClientInformationMixed | 'unusable' | undefined> {
  const url = input.clientMetadataUrl;
  if (url === undefined) return undefined;
  if (
    (server.metadata as Record<string, unknown>)['client_id_metadata_document_supported'] !== true
  ) {
    return undefined;
  }
  const listed = await listedRedirects(url, fetchFn, input.signal);
  return listed?.includes(redirectUri) === true ? { client_id: url } : 'unusable';
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
  const viaDocument = await documentClient(input, server, redirectUri, fetchFn);
  if (viaDocument !== undefined && viaDocument !== 'unusable') return viaDocument;
  if (server.metadata.registration_endpoint === undefined) {
    throw new MCPOAuthError(
      viaDocument === 'unusable' ? 'client-metadata-unusable' : 'registration-unavailable',
    );
  }
  try {
    return await registerClient(server.issuer, {
      metadata: server.metadata,
      // The SDK says whether this is a native application (a loopback or custom-scheme redirect) or a
      // web one, as the registration standard requires.
      clientMetadata: resolveClientMetadata({
        clientMetadata: {
          client_name: input.clientName,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        },
        redirectUrl: redirectUri,
      }),
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
  const listener = input.callbackListener;
  if (read === undefined) {
    if (listener === undefined) throw new MCPOAuthError('callback-unavailable');
    return listener.listen({
      expectedState: state,
      ...(input.config.callbackPort === undefined ? {} : { port: input.config.callbackPort }),
      ...(input.callbackTimeoutMs === undefined ? {} : { timeoutMs: input.callbackTimeoutMs }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }
  let port = input.config.callbackPort;
  if (port === undefined) {
    if (listener === undefined) throw new MCPOAuthError('callback-unavailable');
    port = await listener.freePort();
  }
  return pastedRedirectReceiver(input, read, state, loopbackRedirectUri(port));
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
  // Refused before anything is discovered or registered: a bad configuration changes nothing at the service.
  const extraParams =
    input.config.authorizationParams === undefined
      ? {}
      : checkAuthorizationParams(input.config.authorizationParams);
  if (typeof extraParams === 'string') throw new MCPOAuthError('authorization-params-invalid');
  if (input.clientMetadataUrl !== undefined && !isClientMetadataUrl(input.clientMetadataUrl)) {
    throw new MCPOAuthError('client-metadata-url-invalid');
  }
  const fetchFn = createOAuthFetch(input.network, input.signal);
  const server = await discoverMCPOAuthServer({
    serverUrl: input.serverUrl,
    config: input.config,
    fetch: fetchFn,
  });
  const state = randomHex(32);
  let callback = await redirectReceiver(input, state);
  try {
    const client = await clientFor(input, server, callback.redirectUri, fetchFn);
    const resource = server.resource;
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
    for (const [name, value] of Object.entries(extraParams)) {
      authorization.authorizationUrl.searchParams.set(name, value);
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
        ...(redirect.iss === undefined ? {} : { iss: redirect.iss }),
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
        signInId: randomHex(32),
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
    const key = {
      securityIdentity: input.securityIdentity,
      serverUrl: canonicalServerUrl(input.serverUrl),
    };
    await input.lock.withLock(key, () => input.store.set(key, credential), input.signal);
    return {
      issuer: server.issuer,
      ...(credential.scope === undefined ? {} : { scope: credential.scope }),
    };
  } finally {
    await callback.close();
  }
}
