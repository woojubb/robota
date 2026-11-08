/**
 * Leaf type module for {@link IToolSummary}.
 *
 * Split out of `session-contracts.ts` so `turn-contracts.ts` can depend on this type without
 * importing back from `session-contracts.ts` (which imports `IExecutionResult`/`TTurnSource` from
 * `turn-contracts.ts`) — that previously created an import cycle between the two.
 */
export interface IToolSummary {
  name: string;
  args: string;
}
