import type {
  IAgentBackgroundTaskRequest,
  IBackgroundTaskManager,
  IBackgroundTaskState,
  IProcessBackgroundTaskRequest,
  TBackgroundPermissionPolicy,
  TBackgroundTaskIsolation,
  TBackgroundTaskMode,
} from '@robota-sdk/agent-runtime';
import type {
  IBackgroundJobGroupCreateRequest,
  IBackgroundJobGroupState,
} from './background-job-orchestrator.js';
import { BackgroundJobOrchestrator } from './background-job-orchestrator.js';
import {
  createExecutionOriginMetadata,
  type IExecutionOrigin,
} from './execution-workspace-types.js';

export interface ISpawnAgentTaskRequest {
  readonly label: string;
  readonly agentType: string;
  readonly prompt: string;
  readonly mode?: TBackgroundTaskMode;
  readonly parentTaskId?: string;
  readonly depth?: number;
  readonly cwd?: string;
  readonly model?: string;
  readonly isolation?: TBackgroundTaskIsolation;
  readonly allowedTools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly permissionPolicy?: TBackgroundPermissionPolicy;
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly maxRuntimeMs?: number;
  readonly outputLimitBytes?: number;
  readonly maxTextDeltas?: number;
  readonly repetitionWindow?: number;
  readonly repetitionThreshold?: number;
}

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
  return {
    kind: 'agent',
    label: request.label,
    mode: request.mode ?? 'background',
    parentSessionId: options.sessionId,
    parentTaskId: request.parentTaskId,
    depth: request.depth ?? 1,
    cwd: request.cwd ?? options.cwd,
    agentType: request.agentType,
    prompt: request.prompt,
    model: request.model,
    isolation: request.isolation,
    allowedTools: request.allowedTools ? [...request.allowedTools] : undefined,
    disallowedTools: request.disallowedTools ? [...request.disallowedTools] : undefined,
    permissionPolicy: request.permissionPolicy ?? 'inherit-allowlist',
    timeoutMs: request.timeoutMs,
    idleTimeoutMs: request.idleTimeoutMs,
    maxRuntimeMs: request.maxRuntimeMs,
    outputLimitBytes: request.outputLimitBytes,
    maxTextDeltas: request.maxTextDeltas,
    repetitionWindow: request.repetitionWindow,
    repetitionThreshold: request.repetitionThreshold,
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
