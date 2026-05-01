import type OpenAI from 'openai';
import { isAssistantMessage } from '@robota-sdk/agent-core';
import type { ILogger, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import { OpenAICompatibleResponseParser } from '@robota-sdk/agent-provider-openai-compatible';
import type { IOpenAICompatibleToolCallTextProjector } from '@robota-sdk/agent-provider-openai-compatible';
import { createStreamTextMessage, createStreamToolCallMessage } from './message-factory';
import { GemmaReasoningProjector } from './reasoning-projector';
import { createGemmaToolCallProjector } from './tool-call-projector';

export interface IGemmaStreamProjectionState {
  reasoningProjector: GemmaReasoningProjector;
  responseParser: OpenAICompatibleResponseParser;
  toolCallProjector?: IOpenAICompatibleToolCallTextProjector;
}

export function createGemmaStreamProjectionState(
  logger: ILogger,
  tools: readonly IToolSchema[] | undefined,
): IGemmaStreamProjectionState {
  return {
    reasoningProjector: new GemmaReasoningProjector(),
    responseParser: new OpenAICompatibleResponseParser({ logger }),
    ...(tools && { toolCallProjector: createGemmaToolCallProjector(tools) }),
  };
}

export function projectGemmaStreamChunk(
  chunk: OpenAI.Chat.ChatCompletionChunk,
  state: IGemmaStreamProjectionState,
): TUniversalMessage[] {
  const choice = chunk.choices?.[0];
  if (!choice) {
    return [];
  }

  const nativeToolCallMessage = state.responseParser.parseStreamingChunk(chunk);
  if (nativeToolCallMessage && isAssistantMessage(nativeToolCallMessage)) {
    if (nativeToolCallMessage.toolCalls?.length) {
      return [nativeToolCallMessage];
    }
  }

  return projectGemmaTextDelta(choice.delta.content || '', choice.finish_reason, state);
}

export function flushGemmaStreamProjection(
  state: IGemmaStreamProjectionState,
): TUniversalMessage[] {
  const messages = projectGemmaTextDelta('', null, state, true);
  const flushedContent = state.reasoningProjector.flush();
  if (flushedContent.length > 0) {
    messages.push(createStreamTextMessage(flushedContent, null));
  }
  return messages;
}

function projectGemmaTextDelta(
  rawContent: string,
  finishReason: OpenAI.Chat.ChatCompletionChunk.Choice['finish_reason'],
  state: IGemmaStreamProjectionState,
  flushToolProjector = false,
): TUniversalMessage[] {
  const toolProjection = flushToolProjector
    ? state.toolCallProjector?.flush()
    : state.toolCallProjector?.project(rawContent);
  const messages: TUniversalMessage[] = [];

  if (toolProjection?.toolCalls.length) {
    messages.push(createStreamToolCallMessage(toolProjection.toolCalls, finishReason));
  }

  const contentAfterToolProjection = toolProjection?.visibleText ?? rawContent;
  const visibleContent = state.reasoningProjector.project(contentAfterToolProjection);
  if (visibleContent.length > 0) {
    messages.push(createStreamTextMessage(visibleContent, finishReason));
  }

  return messages;
}
