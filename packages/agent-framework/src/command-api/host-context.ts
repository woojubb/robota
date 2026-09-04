import type { TModelEffort } from '@robota-sdk/agent-core';
import type {
  ICommandListEntry,
  TCommandInvocationSource,
} from '@robota-sdk/agent-interface-command';
import type { ISessionReplayValidationResult } from '@robota-sdk/agent-session';

// ICommandListEntry SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
// TCommandInvocationSource SSOT relocated to @robota-sdk/agent-interface-transport (REMOTE-003).

export type { ICommandListEntry, TCommandInvocationSource };

export interface ICommandSkillListEntry {
  readonly name: string;
  readonly description: string;
  readonly source: string;
  readonly modelInvocable: boolean;
  readonly userInvocable: boolean;
  readonly argumentHint?: string;
  readonly context?: string;
  readonly agent?: string;
}

export interface ICommandSkillActivationRequest {
  readonly invocationSource: TCommandInvocationSource;
  readonly displayInput?: string;
  readonly rawInput?: string;
}

export type TAutoCompactThresholdSource = 'default' | 'settings' | 'session';

/**
 * Live model re-application options (PRESET-013). Carries the model group a preset switch may
 * re-apply to a running session; `maxOutputTokens` maps to the agent's `maxTokens` channel.
 */
export interface IModelReapplyOptions {
  model?: string;
  effort?: TModelEffort;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * A preset `enabledCommandModules`/`disabledCommandModules` name that matched no built command
 * module (INFRA-032). Surfaced as a non-fatal notice on both the startup `--preset` path and the
 * in-session `/preset` path instead of being silently dropped. `kind` records which list the
 * unmatched name came from.
 */
export interface IUnknownCommandModuleName {
  readonly name: string;
  readonly kind: 'enabled' | 'disabled';
}

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

export interface ICommandSessionReplayValidationReport {
  logFile: string;
  entryCount: number;
  validation: ISessionReplayValidationResult;
}

/**
 * The role a command declares when it reads NOTHING from the host.
 *
 * Deliberately empty, and deliberately named. A command that needs no capability must still accept
 * the dispatch parameter positionally when a later parameter is used, and naming the 46-member
 * aggregate in order to ignore it is precisely the defect this decomposition removes — it takes the
 * whole surface for nothing. Every role port is a supertype of the aggregate; this is the widest
 * such supertype, so any host satisfies it.
 *
 * `unknown` would also type-check here and is NOT used: `code-quality.md` allows it only at trust
 * and `catch` boundaries, and an unused command parameter is neither.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the emptiness IS the contract: this role demands nothing.
export interface ICommandHostNoCapability {}

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
