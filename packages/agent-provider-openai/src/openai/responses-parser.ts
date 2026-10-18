import { randomUUID } from 'node:crypto';

import { streamWithAbort } from './responses-stream-utils';

import type {
  IOpenAIResponsesErrorEvent,
  IOpenAIResponsesFunctionCallOutputItem,
  IOpenAIResponsesMessageOutputItem,
  IOpenAIResponsesReasoningOutputItem,
  IOpenAIResponsesResponse,
  IOpenAIResponsesUsage,
  TOpenAIResponsesOutputContent,
  TOpenAIResponsesOutputItem,
  TOpenAIResponsesStreamEvent,
} from './responses-types';
import type {
  IToolCall,
  ITokenUsageWithCacheRead,
  TTextDeltaCallback,
  TThinkingDeltaCallback,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

/** Between two summary parts of a reasoning stream: a blank line, so each part reads as a paragraph. */
const THOUGHT_PART_SEPARATOR = '\n\n';

/** Message usage; `totalTokens` is absent when the response omitted `total_tokens`. */
type TResponsesMessageUsage = Omit<ITokenUsageWithCacheRead, 'totalTokens'> &
  Partial<Pick<ITokenUsageWithCacheRead, 'totalTokens'>>;

interface IOpenAIResponsesStreamAssemblyOptions {
  stream: AsyncIterable<TOpenAIResponsesStreamEvent>;
  onTextDelta?: TTextDeltaCallback;
  onThinkingDelta?: TThinkingDeltaCallback;
  signal?: AbortSignal;
}

interface IOpenAIResponsesReasoningMetadata {
  reasoningSummaryCount: number;
  reasoningSummaries: string[];
  hasEncryptedReasoning: boolean;
}

/**
 * Where the streamed reasoning summary stands. A summary arrives in parts and a reply can hold
 * several reasoning items; each part is its own thought, so the next one starts on a new paragraph.
 */
interface IOpenAIResponsesThoughtStreamState {
  /** The part the stream last named, by a part event or by a delta. */
  currentPart?: string;
  /** The part whose text was last handed to the caller; absent until any text was. */
  sentPart?: string;
  sentText: boolean;
}

interface IOpenAIResponsesStreamState {
  textParts: string[];
  toolCalls: IToolCall[];
  completedResponse?: IOpenAIResponsesResponse;
  reasoning: IOpenAIResponsesReasoningMetadata;
  thought: IOpenAIResponsesThoughtStreamState;
}

export function parseOpenAIResponsesResponse(
  response: IOpenAIResponsesResponse,
): TUniversalMessage {
  assertUsableResponse(response);
  const output = response.output ?? [];
  const content = response.output_text ?? extractMessageText(output);
  return buildAssistantMessage({
    content,
    toolCalls: extractFunctionToolCalls(output),
    response,
    reasoning: collectReasoningMetadata(output),
  });
}

export async function assembleOpenAIResponsesStream(
  options: IOpenAIResponsesStreamAssemblyOptions,
): Promise<TUniversalMessage> {
  const state: IOpenAIResponsesStreamState = {
    textParts: [],
    toolCalls: [],
    reasoning: createEmptyReasoningMetadata(),
    thought: { sentText: false },
  };

  for await (const event of streamWithAbort(options.stream, options.signal)) {
    applyStreamEvent(state, event, options);
  }

  if (state.completedResponse !== undefined) {
    return buildMessageFromCompletedResponse(state);
  }

  return buildAssistantMessage({
    content: state.textParts.join(''),
    toolCalls: state.toolCalls,
    reasoning: state.reasoning,
  });
}

function applyStreamEvent(
  state: IOpenAIResponsesStreamState,
  event: TOpenAIResponsesStreamEvent,
  callbacks: Pick<IOpenAIResponsesStreamAssemblyOptions, 'onTextDelta' | 'onThinkingDelta'>,
): void {
  if (event.type === 'response.output_text.delta') {
    state.textParts.push(event.delta);
    callbacks.onTextDelta?.(event.delta);
    return;
  }

  // A reasoning summary is shown as it streams and is not part of the reply, so it never joins
  // `textParts`.
  if (event.type === 'response.reasoning_summary_part.added') {
    noteSummaryPart(state.thought, event);
    return;
  }

  if (event.type === 'response.reasoning_summary_text.delta') {
    noteSummaryPart(state.thought, event);
    callbacks.onThinkingDelta?.(thoughtDelta(state.thought, event.delta));
    return;
  }

  if (event.type === 'response.completed') {
    state.completedResponse = event.response;
    mergeReasoningMetadata(state.reasoning, collectReasoningMetadata(event.response.output ?? []));
    return;
  }

  if (event.type === 'response.output_item.done') {
    applyOutputItem(state, event.item);
    return;
  }

  if (
    event.type === 'response.error' ||
    event.type === 'response.failed' ||
    event.type === 'response.incomplete'
  ) {
    throw new Error(`OpenAI Responses API failed: ${extractErrorMessage(event)}`);
  }
}

function noteSummaryPart(
  thought: IOpenAIResponsesThoughtStreamState,
  event: { item_id?: string; summary_index?: number },
): void {
  // A stream that names no part leaves the last one standing, so its text is never split.
  if (event.item_id === undefined && event.summary_index === undefined) {
    return;
  }
  thought.currentPart = `${event.item_id ?? ''}#${event.summary_index ?? 0}`;
}

/**
 * The text to hand the caller for a summary delta: the first text of a part that follows earlier
 * text is led by a paragraph break, so concatenated deltas read as separate thoughts. A part that
 * carries no text adds no break, and an empty delta changes nothing.
 */
function thoughtDelta(thought: IOpenAIResponsesThoughtStreamState, delta: string): string {
  if (delta.length === 0) {
    return delta;
  }
  const startsNewPart = thought.sentText && thought.currentPart !== thought.sentPart;
  thought.sentText = true;
  thought.sentPart = thought.currentPart;
  return startsNewPart ? `${THOUGHT_PART_SEPARATOR}${delta}` : delta;
}

function applyOutputItem(
  state: IOpenAIResponsesStreamState,
  item: TOpenAIResponsesOutputItem,
): void {
  if (isFunctionCallOutputItem(item)) {
    state.toolCalls.push(convertFunctionCall(item));
    return;
  }
  if (isReasoningOutputItem(item)) {
    mergeReasoningMetadata(state.reasoning, collectReasoningMetadata([item]));
  }
}

function buildMessageFromCompletedResponse(state: IOpenAIResponsesStreamState): TUniversalMessage {
  const response = state.completedResponse;
  if (response === undefined) {
    throw new Error('OpenAI Responses stream completed without response metadata');
  }

  assertUsableResponse(response);
  const output = response.output ?? [];
  const responseToolCalls = extractFunctionToolCalls(output);
  const content =
    state.textParts.length > 0
      ? state.textParts.join('')
      : (response.output_text ?? extractMessageText(output));
  const reasoning = collectReasoningMetadata(output);
  mergeReasoningMetadata(reasoning, state.reasoning);

  return buildAssistantMessage({
    content,
    toolCalls: responseToolCalls.length > 0 ? responseToolCalls : state.toolCalls,
    response,
    reasoning,
  });
}

function buildAssistantMessage(input: {
  content: string;
  toolCalls: IToolCall[];
  response?: IOpenAIResponsesResponse;
  reasoning: IOpenAIResponsesReasoningMetadata;
}): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: input.content,
    state: 'complete',
    timestamp: new Date(),
    ...(input.toolCalls.length > 0 && { toolCalls: input.toolCalls }),
    ...(input.response?.usage !== undefined && { usage: mapUsage(input.response.usage) }),
    metadata: {
      ...buildMetadata(input.response, input.reasoning),
      ...(input.response?.usage !== undefined && {
        usageProvenance:
          input.response.usage.input_tokens !== undefined &&
          input.response.usage.output_tokens !== undefined &&
          input.response.usage.total_tokens !== undefined
            ? 'complete'
            : 'partial',
      }),
    },
  };
}

function buildMetadata(
  response: IOpenAIResponsesResponse | undefined,
  reasoning: IOpenAIResponsesReasoningMetadata,
): NonNullable<TUniversalMessage['metadata']> {
  return {
    providerApiSurface: 'responses',
    ...(response?.id !== undefined && { responseId: response.id }),
    ...(response?.model !== undefined && { model: response.model }),
    ...(response?.status !== undefined && { finishReason: response.status }),
    ...(reasoning.reasoningSummaryCount > 0 && {
      reasoningSummaryCount: reasoning.reasoningSummaryCount,
      reasoningSummaries: reasoning.reasoningSummaries,
    }),
    ...(reasoning.hasEncryptedReasoning && { hasEncryptedReasoning: true }),
  };
}

function mapUsage(usage: IOpenAIResponsesUsage): TResponsesMessageUsage {
  const cachedTokens = usage.input_tokens_details?.cached_tokens;
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    // An omitted total stays omitted: a 0 reads downstream as a real, empty call.
    ...(usage.total_tokens !== undefined && { totalTokens: usage.total_tokens }),
    ...(typeof cachedTokens === 'number' && { cacheReadTokens: cachedTokens }),
  };
}

function extractFunctionToolCalls(output: readonly TOpenAIResponsesOutputItem[]): IToolCall[] {
  return output.filter(isFunctionCallOutputItem).map((item) => convertFunctionCall(item));
}

function isFunctionCallOutputItem(
  item: TOpenAIResponsesOutputItem,
): item is IOpenAIResponsesFunctionCallOutputItem {
  return (
    item.type === 'function_call' && 'call_id' in item && 'name' in item && 'arguments' in item
  );
}

function convertFunctionCall(item: IOpenAIResponsesFunctionCallOutputItem): IToolCall {
  return {
    id: item.call_id,
    type: 'function',
    function: {
      name: item.name,
      arguments: item.arguments,
    },
  };
}

function extractMessageText(output: readonly TOpenAIResponsesOutputItem[]): string {
  return output
    .filter(isMessageOutputItem)
    .flatMap((item) => item.content)
    .map(extractTextContent)
    .join('');
}

function extractTextContent(content: TOpenAIResponsesOutputContent): string {
  if (content.type === 'refusal') {
    return content.refusal;
  }
  return content.text;
}

function isMessageOutputItem(
  item: TOpenAIResponsesOutputItem,
): item is IOpenAIResponsesMessageOutputItem {
  return item.type === 'message' && 'content' in item && Array.isArray(item.content);
}

function collectReasoningMetadata(
  output: readonly TOpenAIResponsesOutputItem[],
): IOpenAIResponsesReasoningMetadata {
  const metadata = createEmptyReasoningMetadata();
  for (const item of output) {
    if (!isReasoningOutputItem(item)) {
      continue;
    }
    const summaries = item.summary?.map((summary) => summary.text).filter(isString) ?? [];
    metadata.reasoningSummaryCount += summaries.length;
    metadata.reasoningSummaries.push(...summaries);
    metadata.hasEncryptedReasoning = metadata.hasEncryptedReasoning || !!item.encrypted_content;
  }
  return metadata;
}

function isReasoningOutputItem(
  item: TOpenAIResponsesOutputItem,
): item is IOpenAIResponsesReasoningOutputItem {
  return item.type === 'reasoning';
}

function createEmptyReasoningMetadata(): IOpenAIResponsesReasoningMetadata {
  return {
    reasoningSummaryCount: 0,
    reasoningSummaries: [],
    hasEncryptedReasoning: false,
  };
}

function mergeReasoningMetadata(
  target: IOpenAIResponsesReasoningMetadata,
  source: IOpenAIResponsesReasoningMetadata,
): void {
  target.reasoningSummaryCount += source.reasoningSummaryCount;
  target.reasoningSummaries.push(...source.reasoningSummaries);
  target.hasEncryptedReasoning = target.hasEncryptedReasoning || source.hasEncryptedReasoning;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

function assertUsableResponse(response: IOpenAIResponsesResponse): void {
  if (response.status === 'failed' || response.status === 'incomplete') {
    throw new Error(`OpenAI Responses API failed: ${response.error?.message ?? response.status}`);
  }
}

function extractErrorMessage(event: IOpenAIResponsesErrorEvent): string {
  return event.message ?? event.error?.message ?? event.response?.error?.message ?? 'unknown error';
}
