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
 */

import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { canonicalServerUrl } from './discovery.js';
import { MCPOAuthError } from './errors.js';

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

/** A stable, file-name-safe name for a key; both parts are length-prefixed so none collide. */
export function credentialKeyDigest(key: IMCPOAuthCredentialKey): string {
  const hash = createHash('sha256');
  for (const part of [key.securityIdentity, key.serverUrl]) {
    hash.update(`${part.length}:${part}`);
  }
  return hash.digest('hex');
}

const RECORD_VERSION = 1;
const OPTIONAL_STRINGS = [
  'clientSecret',
  'refreshToken',
  'scope',
  'tokenEndpointAuthMethod',
] as const;
const REQUIRED_STRINGS = [
  'issuer',
  'authorizationEndpoint',
  'tokenEndpoint',
  'resource',
  'clientId',
  'accessToken',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCredential(value: unknown): IMCPOAuthCredential | undefined {
  if (!isRecord(value)) return undefined;
  if (REQUIRED_STRINGS.some((field) => typeof value[field] !== 'string')) return undefined;
  if (OPTIONAL_STRINGS.some((f) => value[f] !== undefined && typeof value[f] !== 'string')) {
    return undefined;
  }
  for (const field of ['expiresAt', 'issuedAt'] as const) {
    const time = value[field];
    if (time !== undefined && (typeof time !== 'number' || !Number.isFinite(time)))
      return undefined;
  }
  const methods = value['tokenEndpointAuthMethods'];
  if (
    methods !== undefined &&
    (!Array.isArray(methods) || methods.some((method) => typeof method !== 'string'))
  ) {
    return undefined;
  }
  return value as unknown as IMCPOAuthCredential;
}

/**
 * Credentials as owner-only files (0600) in an owner-only directory (0700), one file per key. A
 * file that does not parse, or was written for another key, is refused as a store failure rather
 * than read as absent: an unreadable record is not proof that no sign-in happened.
 */
export function createFileOAuthCredentialStore(directory: string): IMCPOAuthCredentialStore {
  const pathOf = (key: IMCPOAuthCredentialKey): string =>
    join(directory, `${credentialKeyDigest(key)}.json`);
  return {
    get: async (key) => {
      const path = pathOf(key);
      let text: string;
      try {
        tightenExistingFile(path);
        text = readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new MCPOAuthError('store-failed');
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new MCPOAuthError('store-failed');
      }
      if (
        !isRecord(parsed) ||
        parsed['version'] !== RECORD_VERSION ||
        !isRecord(parsed['key']) ||
        parsed['key']['securityIdentity'] !== key.securityIdentity ||
        parsed['key']['serverUrl'] !== key.serverUrl
      ) {
        throw new MCPOAuthError('store-failed');
      }
      const credential = readCredential(parsed['credential']);
      if (credential === undefined) throw new MCPOAuthError('store-failed');
      return credential;
    },
    set: async (key, credential) => {
      try {
        ensureOwnerOnlyDirectory(directory);
        const record = {
          version: RECORD_VERSION,
          key: { securityIdentity: key.securityIdentity, serverUrl: key.serverUrl },
          credential,
        };
        writeOwnerOnlyFile(pathOf(key), `${JSON.stringify(record, null, 2)}\n`);
      } catch {
        throw new MCPOAuthError('store-failed');
      }
    },
    delete: async (key) => {
      try {
        rmSync(pathOf(key), { force: true });
      } catch {
        throw new MCPOAuthError('store-failed');
      }
    },
  };
}
