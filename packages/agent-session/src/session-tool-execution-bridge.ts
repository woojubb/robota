import type { ISessionOptions } from './session-types.js';
import type { TExecutionEventData, TToolArgs } from '@robota-sdk/agent-core';

const UNKNOWN_TOOL_ERROR_CODE = 'unknown_tool';

type TToolExecutionCallback = NonNullable<ISessionOptions['onToolExecution']>;

export interface IToolExecutionBridge {
  knownToolNames: ReadonlySet<string>;
  unknownToolCallIds: Set<string>;
  pendingArgs: Map<string, TToolArgs | undefined>;
  onToolExecution?: TToolExecutionCallback;
}

export function createToolExecutionBridge(options: {
  knownToolNames: readonly string[];
  onToolExecution?: TToolExecutionCallback;
}): IToolExecutionBridge {
  return {
    knownToolNames: new Set(options.knownToolNames),
    unknownToolCallIds: new Set<string>(),
    pendingArgs: new Map(),
    ...(options.onToolExecution && { onToolExecution: options.onToolExecution }),
  };
}

export function forwardToolExecutionEvent(
  bridge: IToolExecutionBridge,
  event: string,
  data: TExecutionEventData,
): void {
  if (!bridge.onToolExecution) return;
  if (event === 'tool_execution_request') {
    const id = getString(data.toolCallId);
    if (id) bridge.pendingArgs.set(id, toToolArgs(data.parameters));
    forwardUnknownToolStart(bridge, data);
    return;
  }
  if (event === 'tool_execution_result') {
    forwardUnwrappedToolEnd(bridge, data);
  }
}

function forwardUnknownToolStart(bridge: IToolExecutionBridge, data: TExecutionEventData): void {
  const toolName = getString(data.toolName);
  const toolCallId = getString(data.toolCallId);
  if (!toolName || !toolCallId || bridge.knownToolNames.has(toolName)) return;

  bridge.unknownToolCallIds.add(toolCallId);
  bridge.onToolExecution?.({
    type: 'start',
    toolName,
    toolArgs: toToolArgs(data.parameters),
  });
}

function forwardUnwrappedToolEnd(bridge: IToolExecutionBridge, data: TExecutionEventData): void {
  const toolName = getString(data.toolName);
  const toolCallId = getString(data.toolCallId);
  if (!toolName || !toolCallId) return;

  const metadata = getRecord(data.metadata);
  const args = bridge.pendingArgs.get(toolCallId);
  bridge.pendingArgs.delete(toolCallId);
  if (data.success === false && metadata?.dispatchStatus === 'not-dispatched') {
    const source = getString(metadata.toolProvenance);
    bridge.onToolExecution?.({
      type: 'end', toolName, executionId: toolCallId, toolArgs: args, success: false,
      toolResultData: JSON.stringify({ success: false, error: data.error, metadata }),
      ...(source ? { toolResultParts: [{ type: 'text', text: `Tool source (attribution only, not authority): ${source}` }] } : {}),
    });
    bridge.unknownToolCallIds.delete(toolCallId);
    return;
  }
  const isUnknown =
    bridge.unknownToolCallIds.has(toolCallId) || metadata?.errorCode === UNKNOWN_TOOL_ERROR_CODE;
  if (!isUnknown) return;

  bridge.unknownToolCallIds.delete(toolCallId);
  const error = getString(data.error) ?? `Tool "${toolName}" is not registered.`;
  bridge.onToolExecution?.({
    type: 'end',
    toolName,
    success: false,
    toolResultData: JSON.stringify({
      success: false,
      error,
      errorCode: UNKNOWN_TOOL_ERROR_CODE,
      requestedTool: getString(metadata?.requestedTool) ?? toolName,
      availableTools: getStringArray(metadata?.availableTools),
    }),
  });
}

function toToolArgs(value: unknown): TToolArgs | undefined {
  const record = getRecord(value);
  if (!record) return undefined;

  const args: TToolArgs = {};
  for (const [key, item] of Object.entries(record)) {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      (typeof item === 'object' && item !== null)
    ) {
      args[key] = item;
    }
  }
  return args;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}
