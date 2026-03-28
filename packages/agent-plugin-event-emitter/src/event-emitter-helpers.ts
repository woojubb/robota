/**
 * Event Emitter Plugin - Validation and event data builder helpers.
 *
 * Extracted from event-emitter-plugin.ts to keep each file under 300 lines.
 * @internal
 */

import {
  PluginError,
  type IPluginExecutionContext,
  type IPluginExecutionResult,
  type IToolExecutionContext,
} from '@robota-sdk/agent-core';
import type { IEventEmitterPluginOptions } from './plugin-types';
import type { IEventEmitterEventData, TEventDataValue } from './types';

/** Build event data for CONVERSATION_START from execution context. @internal */
export function buildConversationStartData(
  context: IPluginExecutionContext,
): Partial<IEventEmitterEventData> {
  return {
    executionId: context.executionId,
    sessionId: context.sessionId,
    userId: context.userId,
    data: {
      messages: context.messages?.map((msg) => ({
        role: msg.role,
        content: msg.content || '',
        timestamp: msg.timestamp ? msg.timestamp.toISOString() : new Date().toISOString(),
      })),
      config: context.config as Record<
        string,
        | string
        | number
        | boolean
        | Date
        | string[]
        | number[]
        | boolean[]
        | Record<string, string | number | boolean | null>
        | null
        | undefined
      >,
    },
  };
}

/** Build event data for CONVERSATION_COMPLETE from execution result. @internal */
export function buildConversationCompleteData(
  context: IPluginExecutionContext,
  result: IPluginExecutionResult,
): Partial<IEventEmitterEventData> {
  return {
    executionId: context.executionId,
    sessionId: context.sessionId,
    userId: context.userId,
    data: {
      response: result.content || result.response,
      tokensUsed: result.usage?.totalTokens || result.tokensUsed,
      toolCalls: result.toolCalls?.map((call) => ({
        id: call.id || '',
        name: call.name || '',
        arguments: JSON.stringify(call.arguments || {}),
        result: String(call.result || ''),
      })),
    },
  };
}

/** Build event data for TOOL_BEFORE_EXECUTE from tool context. @internal */
export function buildToolBeforeData(
  context: IPluginExecutionContext,
  toolData: IToolExecutionContext,
): Partial<IEventEmitterEventData> {
  return {
    executionId: context.executionId,
    sessionId: context.sessionId,
    userId: context.userId,
    data: {
      toolName: toolData.toolName,
      toolId: toolData.executionId,
      arguments: JSON.stringify(toolData.parameters ?? {}),
    } as Record<string, TEventDataValue>,
  };
}

/** Build base event data for TOOL_SUCCESS/TOOL_ERROR from a tool call result. @internal */
export function buildToolAfterBaseData(
  context: IPluginExecutionContext,
  toolCall: { name?: string; id?: string; result?: TEventDataValue },
  duration?: number,
): Partial<IEventEmitterEventData> {
  return {
    executionId: context.executionId,
    sessionId: context.sessionId,
    userId: context.userId,
    data: {
      toolName: toolCall.name || '',
      toolId: toolCall.id || '',
      ...(toolCall.result !== null &&
        toolCall.result !== undefined && { toolResult: String(toolCall.result) }),
      ...(duration !== undefined && { duration }),
      success: toolCall.result !== null && toolCall.result !== undefined,
    } as Record<string, TEventDataValue>,
  };
}

/** Validate EventEmitterPlugin constructor options. @internal */
export function validateEventEmitterOptions(
  options: IEventEmitterPluginOptions,
  pluginName: string,
): void {
  if (options.maxListeners !== undefined && options.maxListeners < 0) {
    throw new PluginError(
      `Invalid maxListeners option: ${options.maxListeners}. Must be a non-negative number.`,
      pluginName,
      { maxListeners: options.maxListeners },
    );
  }

  if (
    options.buffer !== undefined &&
    options.buffer.maxSize !== undefined &&
    options.buffer.maxSize < 0
  ) {
    throw new PluginError(
      `Invalid buffer.maxSize option: ${options.buffer.maxSize}. Must be a non-negative number.`,
      pluginName,
      { bufferMaxSize: options.buffer.maxSize },
    );
  }

  if (
    options.buffer !== undefined &&
    options.buffer.flushInterval !== undefined &&
    options.buffer.flushInterval < 0
  ) {
    throw new PluginError(
      `Invalid buffer.flushInterval option: ${options.buffer.flushInterval}. Must be a non-negative number.`,
      pluginName,
      { bufferFlushInterval: options.buffer.flushInterval },
    );
  }
}
