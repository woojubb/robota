import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { IToolCall, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';

interface IStreamAssemblyOptions {
  stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
  onTextDelta?: TTextDeltaCallback;
  signal?: AbortSignal;
}

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

export async function assembleOpenAIStream(
  options: IStreamAssemblyOptions,
): Promise<TUniversalMessage> {
  const state: IAssemblyState = {
    textParts: [],
    toolCallParts: new Map(),
    model: '',
    finishReason: null,
  };

  for await (const chunk of streamWithAbort(options.stream, options.signal)) {
    applyChunk(state, chunk, options.onTextDelta);
  }

  return buildMessage(state);
}

function applyChunk(
  state: IAssemblyState,
  chunk: OpenAI.Chat.ChatCompletionChunk,
  onTextDelta: TTextDeltaCallback | undefined,
): void {
  if (chunk.model) {
    state.model = chunk.model;
  }

  const choice = chunk.choices?.[0];
  if (!choice) {
    return;
  }

  state.finishReason = choice.finish_reason ?? state.finishReason;
  applyTextDelta(state, choice.delta.content, onTextDelta);
  applyToolCallDeltas(state, choice.delta.tool_calls ?? []);
}

function applyTextDelta(
  state: IAssemblyState,
  content: string | null | undefined,
  onTextDelta: TTextDeltaCallback | undefined,
): void {
  if (!content) {
    return;
  }
  state.textParts.push(content);
  onTextDelta?.(content);
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

function buildMessage(state: IAssemblyState): TUniversalMessage {
  const metadata: NonNullable<TUniversalMessage['metadata']> = {};
  if (state.model) {
    metadata['model'] = state.model;
  }
  if (state.finishReason) {
    metadata['finishReason'] = state.finishReason;
  }

  return {
    id: randomUUID(),
    role: 'assistant',
    content: state.textParts.join(''),
    state: 'complete' as const,
    timestamp: new Date(),
    ...(state.toolCallParts.size > 0 && { toolCalls: buildToolCalls(state.toolCallParts) }),
    ...(Object.keys(metadata).length > 0 && { metadata }),
  };
}

function buildToolCalls(toolCallParts: Map<number, IToolCallPart>): IToolCall[] {
  return Array.from(toolCallParts.entries())
    .sort(([left], [right]) => left - right)
    .map(([index, toolCall]) => ({
      id: toolCall.id || `call_${index}`,
      type: 'function' as const,
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
