import type { TToolParameters, TUniversalValue } from '@robota-sdk/agent-core';
import type { IBlockDataCollector, IBlockMessage, IBlockMetadata } from '../types';

const JSON_INDENT_SPACES = 2;

export interface IToolCallBlockInput {
  blockCollector: IBlockDataCollector;
  toolName: string;
  parameters: TToolParameters;
  executionId: string;
  parentBlockId?: string;
  level: number;
  blockType: IBlockMetadata['type'];
}

export interface IToolResultBlockInput {
  blockCollector: IBlockDataCollector;
  toolName: string;
  result: TUniversalValue;
  executionId: string;
  parentBlockId: string;
  level: number;
  endTime: Date;
  duration: number;
}

export interface IToolErrorBlockInput {
  blockCollector: IBlockDataCollector;
  toolName: string;
  error: Error;
  executionId: string;
  parentBlockId: string;
  level: number;
  endTime: Date;
  duration: number;
}

export function createToolCallBlock(input: IToolCallBlockInput): IBlockMessage {
  return {
    role: 'assistant',
    content: `🔧 ${input.toolName}`,
    blockMetadata: {
      id: input.blockCollector.generateBlockId(),
      type: input.blockType,
      level: input.level,
      parentId: input.parentBlockId,
      children: [],
      isExpanded: true,
      visualState: 'in_progress',
      executionContext: {
        toolName: input.toolName,
        executionId: input.executionId,
        timestamp: new Date(),
      },
      renderData: {
        parameters: input.parameters,
      },
    },
  };
}

export function createToolResultBlock(input: IToolResultBlockInput): IBlockMessage {
  return {
    role: 'system',
    content:
      typeof input.result === 'string'
        ? input.result
        : JSON.stringify(input.result, null, JSON_INDENT_SPACES),
    blockMetadata: {
      id: input.blockCollector.generateBlockId(),
      type: 'tool_result',
      level: input.level + 1,
      parentId: input.parentBlockId,
      children: [],
      isExpanded: false,
      visualState: 'completed',
      executionContext: {
        toolName: input.toolName,
        executionId: input.executionId,
        timestamp: input.endTime,
        duration: input.duration,
      },
      renderData: {
        result: input.result,
      },
    },
  };
}

export function createToolErrorBlock(input: IToolErrorBlockInput): IBlockMessage {
  return {
    role: 'system',
    content: `❌ Error: ${input.error.message}`,
    blockMetadata: {
      id: input.blockCollector.generateBlockId(),
      type: 'error',
      level: input.level + 1,
      parentId: input.parentBlockId,
      children: [],
      isExpanded: true,
      visualState: 'error',
      executionContext: {
        toolName: input.toolName,
        executionId: input.executionId,
        timestamp: input.endTime,
        duration: input.duration,
      },
      renderData: {
        error: input.error,
      },
    },
  };
}
