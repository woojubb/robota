/**
 * Leaf type module for {@link IToolCallHandoffProvenance} and {@link IToolCallHandoffPolicy}.
 *
 * Split out of `create-session-types.ts` so `tool-call-handoff.ts` can depend on
 * {@link IToolCallHandoffProvenance} without importing back from `create-session-types.ts`
 * (which imports `TSubagentRunnerFactory` from `in-process-subagent-runner.ts`, which imports
 * `createSubagentSession` from `create-subagent-session.ts`, which imports
 * `unwrapToolCallHandoff` from `tool-call-handoff.ts`) — that previously created an import cycle.
 */

/**
 * MCP-004 §S3: provenance the wrapper attaches to a spawned `tool-invocation` background task —
 * flattened onto `IToolInvocationBackgroundTaskRequest`'s own fields, which `agent-executor`'s
 * helpers project into the task state's `metadata` (`serverId`, `sourceName`, `securityIdentity`,
 * `permissionMode`, `provenanceOwner`) for `/tasks` and the notification to read.
 */
export interface IToolCallHandoffProvenance {
  readonly serverId: string;
  readonly sourceName: string;
  readonly securityIdentity: string;
  readonly permissionMode: string;
}

/**
 * MCP-004 §S3: the host's policy for handing a main-turn tool call to a background task once it
 * outruns `thresholdMs`. `budgetMs` is informational only — it sizes the spawned task's
 * `maxRuntimeMs` (`budgetMs - elapsed`) for `/tasks`; the supervisor's own `toolCallMs` (S2,
 * `agent-mcp`) is the one enforcer of the call's actual budget.
 */
export interface IToolCallHandoffPolicy {
  readonly thresholdMs: number;
  readonly budgetMs: number;
  readonly toolNames: readonly string[];
  /** Keyed by tool name — every name in `toolNames` must have an entry (refuse at build time otherwise). */
  readonly provenance: Readonly<Record<string, IToolCallHandoffProvenance>>;
}
