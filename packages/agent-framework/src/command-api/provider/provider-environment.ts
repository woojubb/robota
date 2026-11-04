import type { TEnvResolver } from '@robota-sdk/agent-core';

/**
 * What `$ENV:` references and a definition's default credential variable are read against: a fixed
 * map (the snapshot a host took at startup, since the live environment may have dropped credentials
 * it holds for itself) or a resolver over a live source (`host.env`). Absent, every reference reads
 * as unset, because a platform-neutral module has no process environment of its own to fall back on.
 */
export type TProviderEnvironment = Readonly<Record<string, string | undefined>> | TEnvResolver;

const UNSET: TEnvResolver = () => undefined;

/** The resolver for `environment`; absent, one that reads every name as unset. */
export function resolveProviderEnvironment(
  environment: TProviderEnvironment | undefined,
): TEnvResolver {
  if (environment === undefined) return UNSET;
  if (typeof environment === 'function') return environment;
  return (name) => environment[name];
}
