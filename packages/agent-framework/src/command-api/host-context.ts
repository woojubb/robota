export type { ICommandHostProductVocabulary } from './host-roles.js';
// These types are declared in `host-context-types.ts`, a leaf module: `host-roles.ts` and
// `session-roles.ts` need them, and importing them from here while this file also re-exports FROM
// them below would create import cycles. Re-exported so consumers have one import path for every
// command-host name.
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
  ICommandProductVocabulary,
} from './host-context-types.js';

/**
 * The command axis decomposed into role ports.
 *
 * Each interface below is a CAPABILITY, and the three exported names commands reference are empty
 * `extends` aggregates over them. It is the same shape the session contract has one layer over
 * (`IInteractiveSession` at `agent-interface/src/session/session-contracts.ts`), and it is what
 * lets a command declare only the role it uses: a role port is a SUPERTYPE of the aggregate, so a
 * command narrowing its declared parameter still satisfies `ISystemCommand.execute` by
 * contravariance — sound, not method bivariance.
 *
 * The aggregates stay because the dispatch contract needs one widest type. What must not stay is
 * consumers naming them: a facade that stays in use keeps growing, and this one grew from 20
 * members / 50% optional to 46 / 70%.
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
  ICommandHostSetupState,
  ICommandHostTerminalHandoff,
  ICommandHostUserInteraction,
  ICommandHostWorkspace,
} from './host-roles.js';
export type { TCommandSurfaceLocality } from '@robota-sdk/agent-interface/command';

export type {
  IAgentJobDispatch,
  IAgentJobGroups,
  IAgentJobHostContext,
  IAgentJobLogs,
  IAgentJobMonitors,
  IAgentJobSchedules,
} from './agent-job-roles.js';
