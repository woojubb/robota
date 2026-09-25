/**
 * The environment that decides where a provider connects.
 *
 * A provider built in one process from another process's configuration connects where that
 * configuration says only if both processes see the same values for every variable the client
 * reads on its own: a base-URL fallback, a second credential, a proxy, a CA bundle. This module
 * names those variables and compares them, so a mismatch is refused before a credential can reach
 * a process that would send it elsewhere.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { findProviderDefinition } from '@robota-sdk/agent-core';

import type { ISerializableProviderProfile } from '../background-tasks/types.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

/** Variables every HTTP client in the process honours, whatever the provider. */
export const TRANSPORT_ENVIRONMENT: readonly string[] = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NODE_USE_ENV_PROXY',
  'NODE_EXTRA_CA_CERTS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_OPTIONS',
];

const ENV_REFERENCE_PREFIX = '$ENV:';

/** The variable a profile's credential is read from, when it names one. */
function credentialVariable(profile: ISerializableProviderProfile): string | undefined {
  if (profile.apiKeyEnv !== undefined) return profile.apiKeyEnv;
  if (profile.apiKey?.startsWith(ENV_REFERENCE_PREFIX) === true) {
    return profile.apiKey.slice(ENV_REFERENCE_PREFIX.length);
  }
  return undefined;
}

/**
 * Every variable that decides where `profile` connects: the transport set, what its definition
 * declares, and the variable its credential is read from. Sorted, so two processes list them alike.
 */
export function connectionEnvironmentNames(
  profile: ISerializableProviderProfile,
  providerDefinitions: readonly IProviderDefinition[],
): string[] {
  const declared =
    findProviderDefinition(providerDefinitions, profile.type)?.destinationEnvironment ?? [];
  const credential = credentialVariable(profile);
  return [
    ...new Set([...TRANSPORT_ENVIRONMENT, ...declared, ...(credential ? [credential] : [])]),
  ].sort();
}

/** The first name whose value differs between the two environments; `undefined` when none does. */
export function findConnectionEnvironmentDivergence(
  names: readonly string[],
  expected: NodeJS.ProcessEnv,
  actual: NodeJS.ProcessEnv,
): string | undefined {
  return names.find((name) => (expected[name] ?? '') !== (actual[name] ?? ''));
}

/**
 * What a child repeats before it builds a provider: the names, a fresh nonce, and a keyed digest of
 * the values the parent checked. The values themselves never travel. The nonce travels with the
 * digest, so a reader of the payload could still test guesses for a low-entropy value offline;
 * the digest only keeps a value from appearing, or matching across jobs, as-is.
 */
export interface IConnectionEnvironmentCheck {
  readonly names: readonly string[];
  readonly nonce: string;
  readonly digest: string;
}

function digestOf(names: readonly string[], env: NodeJS.ProcessEnv, nonce: string): string {
  const values = names.map((name) => [name, env[name] ?? null]);
  return createHmac('sha256', nonce).update(JSON.stringify(values)).digest('hex');
}

export function sealConnectionEnvironment(
  names: readonly string[],
  env: NodeJS.ProcessEnv,
): IConnectionEnvironmentCheck {
  const nonce = randomBytes(32).toString('hex');
  return { names: [...names], nonce, digest: digestOf(names, env, nonce) };
}

/** Whether `env` holds the values the check was sealed over. */
export function verifyConnectionEnvironment(
  check: IConnectionEnvironmentCheck,
  env: NodeJS.ProcessEnv,
): boolean {
  const expected = Buffer.from(check.digest, 'hex');
  const actual = Buffer.from(digestOf(check.names, env, check.nonce), 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
