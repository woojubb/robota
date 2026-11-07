/**
 * The owner-only file store for OAuth credentials: one file (0600) per key in an owner-only
 * directory (0700), one implementation of the credential store port of
 * `@robota-sdk/agent-mcp` (`client/oauth/store.ts`) — a keychain can replace it without anything
 * else changing.
 */

import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { MCPOAuthError } from '../client/oauth/errors.js';

import type {
  IMCPOAuthCredential,
  IMCPOAuthCredentialKey,
  IMCPOAuthCredentialStore,
} from '../client/oauth/store.js';

/**
 * A stable, file-name-safe name for a key; both parts are length-prefixed so none collide.
 *
 * A fast hash on purpose. CodeQL's insufficient-password-hash rule reads `oauthCredentialKey` as a
 * password source by its name and asks for a slow hash; that finding is a false positive. The
 * digest hides nothing: it only names files in an owner-only directory, and the record in that
 * file stores both inputs in plain text beside the tokens. A slow hash would therefore guard
 * nothing while delaying every token read, refresh and lock, and it could not be salted: the same
 * key must always name the same file.
 */
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
