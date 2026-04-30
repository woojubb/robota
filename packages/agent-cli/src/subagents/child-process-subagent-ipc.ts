import type {
  IAgentDefinition,
  IInProcessSubagentRunnerDeps,
  ISerializableProviderProfile,
  ISubagentSpawnRequest,
  TPermissionMode,
} from '@robota-sdk/agent-sdk';
import type { TToolArgs } from '@robota-sdk/agent-core';

export type TSubagentWorkerWireValue = string | number | boolean | null | undefined | object;

type TSubagentWorkerWireRecord = Record<string, TSubagentWorkerWireValue>;

export interface ISubagentWorkerStartPayload {
  jobId: string;
  request: ISubagentSpawnRequest;
  agentDefinition: IAgentDefinition;
  parentConfig: IInProcessSubagentRunnerDeps['config'];
  parentContext: IInProcessSubagentRunnerDeps['context'];
  providerProfile: ISerializableProviderProfile;
  permissionMode?: TPermissionMode;
}

export interface ISubagentWorkerStartMessage {
  type: 'start';
  payload: ISubagentWorkerStartPayload;
}

export interface ISubagentWorkerSendMessage {
  type: 'send';
  prompt: string;
}

export interface ISubagentWorkerCancelMessage {
  type: 'cancel';
  reason?: string;
}

export type TSubagentWorkerParentMessage =
  | ISubagentWorkerStartMessage
  | ISubagentWorkerSendMessage
  | ISubagentWorkerCancelMessage;

export interface ISubagentWorkerReadyMessage {
  type: 'ready';
}

export interface ISubagentWorkerTextDeltaMessage {
  type: 'text_delta';
  delta: string;
}

export interface ISubagentWorkerToolStartMessage {
  type: 'tool_start';
  toolName: string;
  toolArgs?: TToolArgs;
}

export interface ISubagentWorkerToolEndMessage {
  type: 'tool_end';
  toolName: string;
  success: boolean;
}

export interface ISubagentWorkerResultMessage {
  type: 'result';
  output: string;
}

export interface ISubagentWorkerErrorMessage {
  type: 'error';
  message: string;
}

export interface ISubagentWorkerCancelledMessage {
  type: 'cancelled';
  reason?: string;
}

export type TSubagentWorkerChildMessage =
  | ISubagentWorkerReadyMessage
  | ISubagentWorkerTextDeltaMessage
  | ISubagentWorkerToolStartMessage
  | ISubagentWorkerToolEndMessage
  | ISubagentWorkerResultMessage
  | ISubagentWorkerErrorMessage
  | ISubagentWorkerCancelledMessage;

function isRecord(value: TSubagentWorkerWireValue): value is TSubagentWorkerWireRecord {
  return typeof value === 'object' && value !== null;
}

function hasString(value: TSubagentWorkerWireRecord, key: string): boolean {
  return typeof value[key] === 'string';
}

function isStartPayload(value: TSubagentWorkerWireValue): value is ISubagentWorkerStartPayload {
  if (!isRecord(value)) return false;
  if (!hasString(value, 'jobId')) return false;
  if (!isRecord(value.request)) return false;
  if (!hasString(value.request, 'type')) return false;
  if (!hasString(value.request, 'prompt')) return false;
  if (!isRecord(value.agentDefinition)) return false;
  if (!hasString(value.agentDefinition, 'name')) return false;
  if (!hasString(value.agentDefinition, 'systemPrompt')) return false;
  if (!isRecord(value.parentConfig)) return false;
  if (!isRecord(value.parentContext)) return false;
  if (!isRecord(value.providerProfile)) return false;
  if (!hasString(value.providerProfile, 'type')) return false;
  return hasString(value.providerProfile, 'model');
}

export function isSubagentWorkerParentMessage(
  value: TSubagentWorkerWireValue,
): value is TSubagentWorkerParentMessage {
  if (!isRecord(value) || !hasString(value, 'type')) return false;
  switch (value.type) {
    case 'start':
      return isStartPayload(value.payload);
    case 'send':
      return hasString(value, 'prompt');
    case 'cancel':
      return value.reason === undefined || typeof value.reason === 'string';
    default:
      return false;
  }
}

export function isSubagentWorkerChildMessage(
  value: TSubagentWorkerWireValue,
): value is TSubagentWorkerChildMessage {
  if (!isRecord(value) || !hasString(value, 'type')) return false;
  switch (value.type) {
    case 'ready':
      return true;
    case 'text_delta':
      return hasString(value, 'delta');
    case 'tool_start':
      return hasString(value, 'toolName');
    case 'tool_end':
      return hasString(value, 'toolName') && typeof value.success === 'boolean';
    case 'result':
      return hasString(value, 'output');
    case 'error':
      return hasString(value, 'message');
    case 'cancelled':
      return value.reason === undefined || typeof value.reason === 'string';
    default:
      return false;
  }
}
