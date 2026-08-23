import {
  createExecutionOriginMetadata,
  type IExecutionOrigin,
} from './execution-workspace-types.js';

import type { BackgroundJobOrchestrator } from './background-job-orchestrator.js';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
} from './background-job-orchestrator.js';
import type { IBackgroundTaskManager } from '@robota-sdk/agent-executor';
import type {
  IAgentBackgroundTaskRequest,
  IBackgroundTaskState,
  IProcessBackgroundTaskRequest,
  TBackgroundTaskMode,
} from '@robota-sdk/agent-interface-execution';

/**
 * ARCH-031: the third declaration of the seam's field family, now DERIVED like the other two.
 *
 * What the spawner owns, and therefore omits from what a caller may set: `kind` (fixed by the seam),
 * `parentSessionId` (taken from `options.sessionId`) and `metadata` (built from `options.origin`). A
 * caller that could set those could forge the parent session and the execution origin, which is why
 * only the TYPE collapses here — `createAgentRequest` stays, because it also applies the defaults below.
 *
 * `mode`/`depth`/`cwd` are optional here and defaulted by that mapper. `permissionPolicy` is NOT among
 * them: it stays required, so every spawn site states its own policy rather than inheriting one applied
 * in the middle of a projection.
 *
 * `Readonly<T>` adds property modifiers but does not make `allowedTools?: string[]` a `readonly
 * string[]`; the hand-written version declared the arrays readonly. That guarantee is knowingly given
 * up, because what actually prevents caller mutation is the mapper copying with `[...]`, and the
 * modifier was decorative beside it.
 */
export type ISpawnAgentTaskRequest = Readonly<
  Omit<
    IAgentBackgroundTaskRequest,
    'kind' | 'parentSessionId' | 'metadata' | 'mode' | 'depth' | 'cwd'
  > &
    Partial<Pick<IAgentBackgroundTaskRequest, 'mode' | 'depth' | 'cwd'>>
>;

export interface ISpawnProcessTaskRequest {
  readonly command: string;
  readonly label?: string;
  readonly mode?: TBackgroundTaskMode;
  readonly parentTaskId?: string;
  readonly depth?: number;
  readonly cwd?: string;
  readonly shell?: string;
  readonly env?: Record<string, string>;
  readonly stdin?: string;
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxRuntimeMs?: number;
  readonly outputLimitBytes?: number;
}

export interface IBackgroundTaskSpawnerGroupRequest {
  readonly waitPolicy: IBackgroundJobGroupCreateRequest['waitPolicy'];
  readonly taskIds: readonly string[];
  readonly label?: string;
}

export interface IExecutionWorkspaceTaskSpawner {
  spawnAgent(request: ISpawnAgentTaskRequest): Promise<IBackgroundTaskState>;
  spawnProcess(request: ISpawnProcessTaskRequest): Promise<IBackgroundTaskState>;
  createGroup(request: IBackgroundTaskSpawnerGroupRequest): IBackgroundJobGroupState;
}

export interface ICreateExecutionWorkspaceTaskSpawnerOptions {
  readonly manager: IBackgroundTaskManager;
  readonly groupOrchestrator: BackgroundJobOrchestrator;
  readonly sessionId: string;
  readonly cwd: string;
  readonly origin: IExecutionOrigin;
}

export function createExecutionWorkspaceTaskSpawner(
  options: ICreateExecutionWorkspaceTaskSpawnerOptions,
): IExecutionWorkspaceTaskSpawner {
  return {
    spawnAgent: (request) => options.manager.spawn(createAgentRequest(options, request)),
    spawnProcess: (request) => options.manager.spawn(createProcessRequest(options, request)),
    createGroup: (request) =>
      options.groupOrchestrator.createGroup({
        parentSessionId: options.sessionId,
        waitPolicy: request.waitPolicy,
        taskIds: [...request.taskIds],
        label: request.label,
      }),
  };
}

function createAgentRequest(
  options: ICreateExecutionWorkspaceTaskSpawnerOptions,
  request: ISpawnAgentTaskRequest,
): IAgentBackgroundTaskRequest {
  // ARCH-031: a spread with the spawner's own overrides, NOT a hand-written key list. The list this
  // replaced omitted `providerProfile` the moment the derivation introduced it — a caller could set it
  // and get a silent no-op, which is precisely the defect class this item exists to remove, recreated by
  // its own fix and caught at the done gate. A spread cannot forget a key.
  //
  // The three overrides after it are what the SPAWNER owns and a caller must not be able to forge:
  // `kind` is fixed by the seam, `parentSessionId` comes from the session, `metadata` from the origin.
  const { mode, depth, cwd, allowedTools, disallowedTools, ...rest } = request;
  return {
    ...rest,
    kind: 'agent',
    mode: mode ?? 'background',
    depth: depth ?? 1,
    cwd: cwd ?? options.cwd,
    allowedTools: allowedTools ? [...allowedTools] : undefined,
    disallowedTools: disallowedTools ? [...disallowedTools] : undefined,
    parentSessionId: options.sessionId,
    metadata: createExecutionOriginMetadata(options.origin),
  };
}

function createProcessRequest(
  options: ICreateExecutionWorkspaceTaskSpawnerOptions,
  request: ISpawnProcessTaskRequest,
): IProcessBackgroundTaskRequest {
  return {
    kind: 'process',
    label: request.label ?? request.command,
    mode: request.mode ?? 'background',
    parentSessionId: options.sessionId,
    parentTaskId: request.parentTaskId,
    depth: request.depth ?? 0,
    cwd: request.cwd ?? options.cwd,
    command: request.command,
    shell: request.shell,
    env: request.env,
    stdin: request.stdin,
    timeoutMs: request.timeoutMs,
    idleTimeoutMs: request.idleTimeoutMs,
    maxRuntimeMs: request.maxRuntimeMs,
    outputLimitBytes: request.outputLimitBytes,
    metadata: createExecutionOriginMetadata(options.origin),
  };
}
