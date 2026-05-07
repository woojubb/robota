import type {
  ILogger,
  IToolExecutionContext,
  TToolParameters,
  TUniversalValue,
} from '@robota-sdk/agent-core';
import type { IBlockDataCollector, IBlockMetadata, IToolExecutionTrackingData } from '../types';

export interface IToolHooks {
  beforeExecute(
    toolName: string,
    parameters: TToolParameters,
    context?: IToolExecutionContext,
  ): Promise<void>;
  afterExecute(
    toolName: string,
    parameters: TToolParameters,
    result: TUniversalValue,
    context?: IToolExecutionContext,
  ): Promise<void>;
  onError(
    toolName: string,
    parameters: TToolParameters,
    error: Error,
    context?: IToolExecutionContext,
  ): Promise<void>;
}

export interface IBlockTrackingHookOptions {
  parentBlockId?: string;
  level?: number;
  blockTypeMapping?: Record<string, IBlockMetadata['type']>;
}

export interface IBlockTrackingHookRuntime {
  blockCollector: IBlockDataCollector;
  logger: ILogger;
  parentBlockId?: string;
  level: number;
  blockTypeMapping: Record<string, IBlockMetadata['type']>;
  activeExecutions: Map<string, IToolExecutionTrackingData>;
}
