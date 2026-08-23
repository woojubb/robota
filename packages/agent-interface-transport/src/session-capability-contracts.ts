import type {
  ICommandListEntry,
  ICommandResult,
  TCommandInvocationSource,
} from './command-contracts.js';
import type { ISubmitOptions, TDriverId } from './driver-contracts.js';
import type {
  IGoalState,
  IInteractiveSessionEvents,
  TInteractiveEventName,
  TPermissionResultValue,
} from './session-contracts.js';
import type { ITurnHandle } from './turn-contracts.js';
import type {
  IContextWindowState,
  TActionResponse,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { ISubagentJobState } from '@robota-sdk/agent-interface-execution';
import type {
  IExecutionWorkspaceSnapshot,
  IExecutionWorkspaceSnapshotOptions,
} from '@robota-sdk/agent-interface-execution';
import type {
  IBackgroundTaskInput,
  IBackgroundTaskListFilter,
  IBackgroundTaskLogCursor,
  IBackgroundTaskLogPage,
  IBackgroundTaskState,
  TBackgroundTaskIsolation,
} from '@robota-sdk/agent-interface-execution';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
} from '@robota-sdk/agent-interface-execution';

export interface ISessionLifecycle {
  /** True once the underlying session has been initialized. */
  readonly isInitialized: boolean;
  shutdown(options?: { reason?: string; message?: string }): Promise<void>;
}

export interface ISessionTurnSubmission {
  submit(
    input: string,
    displayInput?: string,
    rawInput?: string,
    options?: ISubmitOptions,
  ): Promise<ITurnHandle>;
}

export interface ISessionTurnControl {
  abort(): void;
  cancelQueue(): void;
}

export interface ISessionGoal {
  setGoal(
    objective: string,
    options?: { maxIterations?: number; noProgressLimit?: number },
  ): Promise<IGoalState>;
  getGoalState(): IGoalState | null;
  cancelGoal(): IGoalState | null;
}

export interface ISessionExecutionState {
  isExecuting(): boolean;
  getPendingPrompt(): string | null;
  getPendingCount(): number;
}

export interface ISessionDriverAttribution {
  getActiveDriverId(): TDriverId | null;
}

export interface ISessionConversationRead {
  getMessages(): TUniversalMessage[];
  getContextState(): IContextWindowState;
}

export interface ISessionIdentity {
  getSession(): { getSessionId(): string };
}

export interface ISessionWorkspaceLocation {
  getCwd(): string;
}

export interface ISessionCommands {
  executeCommand(
    name: string,
    args: string,
    source?: TCommandInvocationSource,
    originDriverId?: TDriverId,
  ): Promise<ICommandResult | null>;
  listCommands(): ICommandListEntry[];
}

export interface ISessionEvents {
  on<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
  off<E extends TInteractiveEventName>(event: E, handler: IInteractiveSessionEvents[E]): void;
}

export interface ISessionPromptResolution {
  resolvePermission(id: string, result: TPermissionResultValue, answererDriverId?: TDriverId): void;
  resolveAsk(id: string, response: TActionResponse, answererDriverId?: TDriverId): void;
}

export interface ISessionBackgroundTasks {
  listBackgroundTasks(filter?: IBackgroundTaskListFilter): IBackgroundTaskState[];
  getBackgroundTask(taskId: string): IBackgroundTaskState | undefined;
  cancelBackgroundTask(taskId: string, reason?: string): Promise<void>;
  closeBackgroundTask(taskId: string): Promise<void>;
  sendBackgroundTask(taskId: string, input: IBackgroundTaskInput): Promise<void>;
  readBackgroundTaskLog(
    taskId: string,
    cursor?: IBackgroundTaskLogCursor,
  ): Promise<IBackgroundTaskLogPage>;
}

export interface ISessionBackgroundGroups {
  listBackgroundJobGroups(): IBackgroundJobGroupState[];
  getBackgroundJobGroup(groupId: string): IBackgroundJobGroupState | undefined;
  createBackgroundJobGroup(
    input: Omit<IBackgroundJobGroupCreateRequest, 'parentSessionId'>,
  ): IBackgroundJobGroupState;
  waitBackgroundJobGroup(groupId: string): Promise<IBackgroundJobGroupState>;
}

export interface ISessionExecutionWorkspace {
  getExecutionWorkspaceSnapshot(
    options?: IExecutionWorkspaceSnapshotOptions,
  ): IExecutionWorkspaceSnapshot;
}

export interface ISessionAgentJobs {
  listAgentDefinitions(): Array<{ name: string; description: string }>;
  listAgentJobs(): ISubagentJobState[];
  spawnAgentJob(input: {
    agentType: string;
    label: string;
    mode: 'foreground' | 'background';
    prompt: string;
    model?: string;
    isolation?: TBackgroundTaskIsolation;
  }): Promise<ISubagentJobState>;
  sendAgentJob(taskId: string, prompt: string): Promise<void>;
  cancelAgentJob(taskId: string, reason?: string): Promise<void>;
  closeAgentJob(taskId: string): Promise<void>;
}

export interface ISessionCapabilityMap {
  lifecycle: ISessionLifecycle;
  turnSubmission: ISessionTurnSubmission;
  turnControl: ISessionTurnControl;
  goal: ISessionGoal;
  executionState: ISessionExecutionState;
  driverAttribution: ISessionDriverAttribution;
  conversationRead: ISessionConversationRead;
  identity: ISessionIdentity;
  workspaceLocation: ISessionWorkspaceLocation;
  commands: ISessionCommands;
  events: ISessionEvents;
  promptResolution: ISessionPromptResolution;
  backgroundTasks: ISessionBackgroundTasks;
  backgroundGroups: ISessionBackgroundGroups;
  executionWorkspace: ISessionExecutionWorkspace;
  agentJobs: ISessionAgentJobs;
}

export const SESSION_CAPABILITY_MEMBER_KEYS = Object.freeze({
  lifecycle: Object.freeze(['isInitialized', 'shutdown'] as const),
  turnSubmission: Object.freeze(['submit'] as const),
  turnControl: Object.freeze(['abort', 'cancelQueue'] as const),
  goal: Object.freeze(['setGoal', 'getGoalState', 'cancelGoal'] as const),
  executionState: Object.freeze(['isExecuting', 'getPendingPrompt', 'getPendingCount'] as const),
  driverAttribution: Object.freeze(['getActiveDriverId'] as const),
  conversationRead: Object.freeze(['getMessages', 'getContextState'] as const),
  identity: Object.freeze(['getSession'] as const),
  workspaceLocation: Object.freeze(['getCwd'] as const),
  commands: Object.freeze(['executeCommand', 'listCommands'] as const),
  events: Object.freeze(['on', 'off'] as const),
  promptResolution: Object.freeze(['resolvePermission', 'resolveAsk'] as const),
  backgroundTasks: Object.freeze([
    'listBackgroundTasks',
    'getBackgroundTask',
    'cancelBackgroundTask',
    'closeBackgroundTask',
    'sendBackgroundTask',
    'readBackgroundTaskLog',
  ] as const),
  backgroundGroups: Object.freeze([
    'listBackgroundJobGroups',
    'getBackgroundJobGroup',
    'createBackgroundJobGroup',
    'waitBackgroundJobGroup',
  ] as const),
  executionWorkspace: Object.freeze(['getExecutionWorkspaceSnapshot'] as const),
  agentJobs: Object.freeze([
    'listAgentDefinitions',
    'listAgentJobs',
    'spawnAgentJob',
    'sendAgentJob',
    'cancelAgentJob',
    'closeAgentJob',
  ] as const),
} satisfies {
  readonly [TKey in keyof ISessionCapabilityMap]: readonly (keyof ISessionCapabilityMap[TKey])[];
});

// ── Capability host contracts (HARNESS-103) ──────────────────────────────────
// These TYPES stayed here when the host's runtime mechanism moved to `testing/`. An
// `agent-interface-*` package must not contain runtime logic (project-structure.md), and the
// repository's own placement rule is `contracts→agent-interface-*, doubles→owner /testing`. The
// contract is the part that belongs in a contracts package; the 100-line prototype-walking
// forwarder that satisfies it is a double factory and now lives where doubles live.

type TUnionToIntersection<T> = (T extends T ? (value: T) => void : never) extends (
  value: infer TIntersection,
) => void
  ? TIntersection
  : never;

type TSelectedSessionPorts<TCapabilities extends Partial<ISessionCapabilityMap>> =
  TUnionToIntersection<Exclude<TCapabilities[keyof TCapabilities], undefined>>;

export interface ISessionCapabilityHost<
  TCapabilities extends Partial<ISessionCapabilityMap> = Partial<ISessionCapabilityMap>,
> {
  readonly capabilities: Readonly<TCapabilities>;
}

export type TSessionCapabilityHost<TCapabilities extends Partial<ISessionCapabilityMap>> =
  ISessionCapabilityHost<TCapabilities> & TSelectedSessionPorts<TCapabilities>;

export type TSessionCapabilityReadResult<TCapability> =
  Readonly<{ provided: false }> | Readonly<{ provided: true; value: TCapability }>;
