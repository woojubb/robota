/**
 * The injected environment resolver (#2347 / #2051).
 *
 * Provider normalization must be deterministic from its arguments and a resolver it is HANDED —
 * never from ambient `process.env`. This module is the ONE place in the normalization path that is
 * allowed to touch `process.env`: it defines the default resolver a composition root injects when it
 * wants the host environment. Every normalization module (`env-ref.ts`, both `provider-factory.ts`)
 * takes a `TEnvResolver` parameter and is forbidden `process.env` by the
 * `provider-env-resolution` scan.
 */

/** Resolve an environment variable NAME (not a `$ENV:` reference) to its value, or `undefined`. */
export type TEnvResolver = (name: string) => string | undefined;

/** The host process environment. Injected by composition roots; a test injects a map instead. */
export const processEnvResolver: TEnvResolver = (name) => process.env[name];

/** Build a resolver over a fixed record — what a unit test injects instead of mutating `process.env`. */
export function createRecordEnvResolver(record: Readonly<Record<string, string>>): TEnvResolver {
  return (name) => record[name];
}
