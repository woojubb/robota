import type { TEnvResolver } from './env-resolver.js';

export const ENV_REFERENCE_PREFIX = '$ENV:';

export function isEnvReference(value: string): boolean {
  return value.startsWith(ENV_REFERENCE_PREFIX);
}

export function formatEnvReference(name: string): string {
  return `${ENV_REFERENCE_PREFIX}${name}`;
}

/**
 * Resolve a `$ENV:<name>` reference through `resolve`: a non-reference is returned as-is; an
 * empty name is `undefined`. This function never reads `process.env`; the host environment is one
 * resolver a composition root can pass (`processEnvResolver` from `@robota-sdk/agent-core/node`).
 */
export function resolveEnvReference(value: string, resolve: TEnvResolver): string | undefined {
  if (!isEnvReference(value)) {
    return value;
  }
  const envName = value.slice(ENV_REFERENCE_PREFIX.length).trim();
  if (envName.length === 0) {
    return undefined;
  }
  return resolve(envName);
}

export function hasUsableSecretReference(
  value: string | undefined,
  resolve: TEnvResolver,
): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  return resolveEnvReference(value, resolve) !== undefined;
}
