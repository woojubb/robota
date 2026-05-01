import { randomUUID } from 'node:crypto';
import type OpenAI from 'openai';
import type { IToolCall, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IOpenAICompatibleToolCallTextProjection,
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
  projectedToolCalls: IToolCall[];
  rawToolCallTextParts: string[];
  toolCallTextProjected: boolean;
  model: string;
  finishReason: string | null;
}

export async function assembleOpenAICompatibleStream(
  options: IOpenAICompatibleStreamAssemblyOptions,
): Promise<TUniversalMessage> {
  const state: IAssemblyState = {
    textParts: [],
    toolCallParts: new Map(),
    projectedToolCalls: [],
    rawToolCallTextParts: [],
    toolCallTextProjected: false,
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

  const toolProjection = projectToolCallText(content, options.toolCallTextProjector);
  applyToolCallTextProjection(state, toolProjection);
  const visibleContent = projectText(toolProjection.visibleText, options.textProjector);
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
  const toolProjection = options.toolCallTextProjector?.flush();
  if (toolProjection) {
    applyToolCallTextProjection(state, toolProjection);
    const visibleToolText = projectText(toolProjection.visibleText, options.textProjector);
    if (visibleToolText.length > 0) {
      state.textParts.push(visibleToolText);
      options.onTextDelta?.(visibleToolText);
    }
  }

  const visibleContent = options.textProjectorFlush?.();
  if (!visibleContent) {
    return;
  }

  state.textParts.push(visibleContent);
  options.onTextDelta?.(visibleContent);
}

function projectToolCallText(
  text: string,
  projector: IOpenAICompatibleStreamAssemblyOptions['toolCallTextProjector'],
): IOpenAICompatibleToolCallTextProjection {
  return (
    projector?.project(text) ?? {
      visibleText: text,
      toolCalls: [],
      removedToolCallText: false,
    }
  );
}

function applyToolCallTextProjection(
  state: IAssemblyState,
  projection: IOpenAICompatibleToolCallTextProjection,
): void {
  if (projection.toolCalls.length > 0) {
    state.projectedToolCalls.push(...projection.toolCalls);
  }
  if (projection.removedToolCallText) {
    state.toolCallTextProjected = true;
  }
  if (projection.rawToolCallText && projection.rawToolCallText.length > 0) {
    state.rawToolCallTextParts.push(projection.rawToolCallText);
  }
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
  if (state.toolCallTextProjected) {
    resultMetadata['toolCallTextProjected'] = true;
  }
  if (state.rawToolCallTextParts.length > 0) {
    resultMetadata['rawToolCallText'] = state.rawToolCallTextParts.join('');
  }

  const toolCalls = buildAllToolCalls(state);

  return {
    id: randomUUID(),
    role: 'assistant',
    content: state.textParts.join(''),
    state: 'complete',
    timestamp: new Date(),
    ...(toolCalls.length > 0 && { toolCalls }),
    ...(Object.keys(resultMetadata).length > 0 && { metadata: resultMetadata }),
  };
}

function buildAllToolCalls(state: IAssemblyState): IToolCall[] {
  return [...buildToolCalls(state.toolCallParts), ...state.projectedToolCalls];
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
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (!signal?.aborted) {
      const item = await nextStreamItem(iterator, signal);
      if (item.done) break;
      await yieldToMacrotask(signal);
      if (signal?.aborted) break;
      yield item.value;
    }
  } finally {
    if (signal?.aborted) {
      await iterator.return?.();
    }
  }
}

async function nextStreamItem<T>(
  iterator: AsyncIterator<T>,
  signal?: AbortSignal,
): Promise<IteratorResult<T>> {
  if (!signal) return iterator.next();
  if (signal.aborted) return { done: true, value: undefined as T };

  let abortListener: (() => void) | undefined;
  const aborted = new Promise<IteratorResult<T>>((resolve) => {
    abortListener = (): void => resolve({ done: true, value: undefined as T });
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([iterator.next(), aborted]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

async function yieldToMacrotask(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
