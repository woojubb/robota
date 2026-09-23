/**
 * Leaf type module for {@link IMCPDiscoverOptions}.
 *
 * Split out of `session.ts` so `discovery.ts` can depend on this type without importing back from
 * `session.ts`, which previously created an import cycle between the two
 * (`discovery.ts` -> `session.ts` -> `discovery.ts`).
 */
export interface IMCPDiscoverOptions {
  /** Hard bound on list pages per domain; exceeding it is a named `page-bound-exceeded` failure. */
  readonly maxPages: number;
  readonly perRequestTimeoutMs: number;
  readonly signal?: AbortSignal;
}
