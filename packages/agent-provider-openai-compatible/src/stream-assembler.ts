import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { IToolCall, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IOpenAICompatibleStreamAssemblyOptions,
  TOpenAICompatibleTextProjector,
} from './types';

interface IToolCallPart {
  id: string;
  name: string;
  arguments: string;
}

interface IAssemblyState {
  textParts: string[];
  toolCallParts: Map<number, IToolCallPart>;
  model: string;
  finishReason: string | null;
}

export async function assembleOpenAICompatibleStream(
  options: IOpenAICompatibleStreamAssemblyOptions,
): Promise<TUniversalMessage> {
  const state: IAssemblyState = {
    textParts: [],
    toolCallParts: new Map(),
    model: '',
    finishReason: null,
  };

  for await (const chunk of streamWithAbort(options.stream, options.signal)) {
    applyChunk(state, chunk, options);
  }
  applyProjectedTextFlush(state, options);

  return buildMessage(state, options.metadata);
}

function applyChunk(
  state: IAssemblyState,
  chunk: OpenAI.Chat.ChatCompletionChunk,
  options: IOpenAICompatibleStreamAssemblyOptions,
): void {
  if (chunk.model) {
    state.model = chunk.model;
  }

  const choice = chunk.choices?.[0];
  if (!choice) {
    return;
  }

  state.finishReason = choice.finish_reason ?? state.finishReason;
  applyTextDelta(state, choice.delta.content, options);
  applyToolCallDeltas(state, choice.delta.tool_calls ?? []);
}

function applyTextDelta(
  state: IAssemblyState,
  content: string | null | undefined,
  options: IOpenAICompatibleStreamAssemblyOptions,
): void {
  if (!content) {
    return;
  }

  const visibleContent = projectText(content, options.textProjector);
  if (visibleContent.length === 0) {
    return;
  }

  state.textParts.push(visibleContent);
  options.onTextDelta?.(visibleContent);
}

function projectText(text: string, projector?: TOpenAICompatibleTextProjector): string {
  return projector ? projector(text) : text;
}

function applyProjectedTextFlush(
  state: IAssemblyState,
  options: IOpenAICompatibleStreamAssemblyOptions,
): void {
  const visibleContent = options.textProjectorFlush?.();
  if (!visibleContent) {
    return;
  }

  state.textParts.push(visibleContent);
  options.onTextDelta?.(visibleContent);
}

function applyToolCallDeltas(
  state: IAssemblyState,
  deltas: OpenAI.Chat.ChatCompletionChunk.Choice.Delta.ToolCall[],
): void {
  for (const delta of deltas) {
    const index = delta.index ?? 0;
    const current = state.toolCallParts.get(index) ?? { id: '', name: '', arguments: '' };
    state.toolCallParts.set(index, {
      id: delta.id ?? current.id,
      name: delta.function?.name ?? current.name,
      arguments: current.arguments + (delta.function?.arguments ?? ''),
    });
  }
}

function buildMessage(
  state: IAssemblyState,
  metadata: Record<string, string | number | boolean> = {},
): TUniversalMessage {
  const resultMetadata: NonNullable<TUniversalMessage['metadata']> = { ...metadata };
  if (state.model) {
    resultMetadata['model'] = state.model;
  }
  if (state.finishReason) {
    resultMetadata['finishReason'] = state.finishReason;
  }

  return {
    id: randomUUID(),
    role: 'assistant',
    content: state.textParts.join(''),
    state: 'complete',
    timestamp: new Date(),
    ...(state.toolCallParts.size > 0 && { toolCalls: buildToolCalls(state.toolCallParts) }),
    ...(Object.keys(resultMetadata).length > 0 && { metadata: resultMetadata }),
  };
}

function buildToolCalls(toolCallParts: Map<number, IToolCallPart>): IToolCall[] {
  return Array.from(toolCallParts.entries())
    .sort(([left], [right]) => left - right)
    .map(([index, toolCall]) => ({
      id: toolCall.id || `call_${index}`,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments || '{}',
      },
    }));
}

async function* streamWithAbort<T>(
  source: AsyncIterable<T>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  for await (const item of source) {
    if (signal?.aborted) {
      break;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (signal?.aborted) {
      break;
    }
    yield item;
  }
}
