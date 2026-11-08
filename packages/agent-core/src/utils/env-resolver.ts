/**
 * The injected environment resolver.
 *
 * Provider normalization must be deterministic from its arguments and a resolver it is HANDED —
 * never from ambient `process.env`. Every normalization module (`env-ref.ts`, both
 * `provider-factory.ts`) takes a `TEnvResolver` parameter. The host-environment resolver is Node-only
 * and lives in `process-env-resolver.ts`, exported from `@robota-sdk/agent-core/node`.
 */

/** Resolve an environment variable NAME (not a `$ENV:` reference) to its value, or `undefined`. */
export type TEnvResolver = (name: string) => string | undefined;

/** Build a resolver over a fixed record — what a unit test or a non-Node host injects. */
export function createRecordEnvResolver(record: Readonly<Record<string, string>>): TEnvResolver {
  return (name) => record[name];
}
