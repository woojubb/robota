import { randomUUID } from 'node:crypto';
import type { IToolCall, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
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
import { streamWithAbort } from './responses-stream-utils';

interface IOpenAIResponsesStreamAssemblyOptions {
  stream: AsyncIterable<TOpenAIResponsesStreamEvent>;
  onTextDelta?: TTextDeltaCallback;
  signal?: AbortSignal;
}

interface IOpenAIResponsesReasoningMetadata {
  reasoningSummaryCount: number;
  reasoningSummaries: string[];
  hasEncryptedReasoning: boolean;
}

interface IOpenAIResponseUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface IOpenAIResponsesStreamState {
  textParts: string[];
  toolCalls: IToolCall[];
  completedResponse?: IOpenAIResponsesResponse;
  reasoning: IOpenAIResponsesReasoningMetadata;
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
  };

  for await (const event of streamWithAbort(options.stream, options.signal)) {
    applyStreamEvent(state, event, options.onTextDelta);
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
  onTextDelta: TTextDeltaCallback | undefined,
): void {
  if (event.type === 'response.output_text.delta') {
    state.textParts.push(event.delta);
    onTextDelta?.(event.delta);
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
    metadata: buildMetadata(input.response, input.reasoning),
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

function mapUsage(usage: IOpenAIResponsesUsage): IOpenAIResponseUsage {
  return {
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
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
