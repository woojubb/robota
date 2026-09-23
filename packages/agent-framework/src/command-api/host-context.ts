// The types that used to be declared directly in this file moved to `host-context-types.ts`
// (ARCH-029-style leaf extraction): `host-roles.ts` and `session-roles.ts` imported them back
// from here while this file also re-exports FROM them below, which created import cycles.
// Re-exported so every existing import of these names keeps working.
export type {
  ICommandListEntry,
  TCommandInvocationSource,
  ICommandSkillListEntry,
  ICommandSkillActivationRequest,
  TAutoCompactThresholdSource,
  IModelReapplyOptions,
  IUnknownCommandModuleName,
  ICommandSessionReplayValidationReport,
  ICommandHostNoCapability,
} from './host-context-types.js';

/**
 * ARCH-029 — the command axis decomposed into role ports.
 *
 * Each interface below is a CAPABILITY, and the three exported names commands used to reference are
 * now empty `extends` aggregates over them. That is exactly the shape ARCH-012 landed one layer over
 * (`IInteractiveSession` at `agent-interface-session/src/session-contracts.ts`), and it is what
 * lets a command declare only the role it uses: a role port is a SUPERTYPE of the aggregate, so a
 * command narrowing its declared parameter still satisfies `ISystemCommand.execute` by
 * contravariance — sound, not method bivariance.
 *
 * The aggregates stay because the dispatch contract needs one widest type. What must not stay is
 * consumers naming them: `scan-aggregate-naming.mjs` freezes that count and drives it to zero,
 * because the previous attempt on this contract (REFACTOR-006) closed green while the facade
 * survived, and it then grew from 20 members / 50% optional to 46 / 70%.
 */

export type {
  ICommandSessionContextWindow,
  ICommandSessionHistory,
  ICommandSessionIdentity,
  ICommandSessionModel,
  ICommandSessionPermissions,
  ICommandSessionPreset,
  ICommandSessionRuntime,
} from './session-roles.js';

export type {
  ICommandHostAdapterAccess,
  ICommandHostAgentJobs,
  ICommandHostBackgroundTasks,
  ICommandHostCatalog,
  ICommandHostCheckpoints,
  ICommandHostContext,
  ICommandHostContextReferences,
  ICommandHostContextWindow,
  ICommandHostGoal,
  ICommandHostMemory,
  ICommandHostPlan,
  ICommandHostPresetApplication,
  ICommandHostSessionAccess,
  ICommandHostTerminalHandoff,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
} from './host-roles.js';

export type {
  IAgentJobDispatch,
  IAgentJobGroups,
  IAgentJobHostContext,
  IAgentJobLogs,
  IAgentJobMonitors,
  IAgentJobSchedules,
} from './agent-job-roles.js';
