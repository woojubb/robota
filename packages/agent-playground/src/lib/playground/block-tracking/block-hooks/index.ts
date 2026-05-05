import { SilentLogger } from '@robota-sdk/agent-core';
import type { ILogger } from '@robota-sdk/agent-core';
import { handleAfterExecute, handleBeforeExecute, handleToolError } from './handlers';
import type { IBlockDataCollector, IToolExecutionTrackingData } from '../types';
import type { IBlockTrackingHookOptions, IBlockTrackingHookRuntime, IToolHooks } from './types';

export function createBlockTrackingHooks(
  blockCollector: IBlockDataCollector,
  logger: ILogger = SilentLogger,
  options: IBlockTrackingHookOptions = {},
): IToolHooks {
  const runtime = createHookRuntime(blockCollector, logger, options);

  return {
    beforeExecute: (toolName, parameters, context) =>
      handleBeforeExecute(runtime, toolName, parameters, context),
    afterExecute: (toolName, parameters, result, context) =>
      handleAfterExecute(runtime, toolName, parameters, result, context),
    onError: (toolName, parameters, error, context) =>
      handleToolError(runtime, toolName, parameters, error, context),
  };
}

export function createDelegationTrackingHooks(
  blockCollector: IBlockDataCollector,
  logger: ILogger = SilentLogger,
  options: Pick<IBlockTrackingHookOptions, 'parentBlockId' | 'level'> = {},
): IToolHooks {
  return createBlockTrackingHooks(blockCollector, logger, {
    ...options,
    blockTypeMapping: {
      assignTask: 'tool_call',
      delegate_to_agent: 'tool_call',
    },
  });
}

function createHookRuntime(
  blockCollector: IBlockDataCollector,
  logger: ILogger,
  options: IBlockTrackingHookOptions,
): IBlockTrackingHookRuntime {
  return {
    blockCollector,
    logger,
    parentBlockId: options.parentBlockId,
    level: options.level ?? 0,
    blockTypeMapping: options.blockTypeMapping ?? {},
    activeExecutions: new Map<string, IToolExecutionTrackingData>(),
  };
}

export type { IToolHooks } from './types';
export type { IBlockTrackingHookOptions } from './types';
