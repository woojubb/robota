import { randomUUID } from 'node:crypto';
import type { IToolCall, TTextDeltaCallback, TUniversalMessage } from '@robota-sdk/agent-core';
import type {
  IQwenResponsesFunctionCallOutputItem,
  IQwenResponsesErrorEvent,
  IQwenResponsesResponse,
  IQwenResponsesUsage,
  TQwenBuiltInWebToolName,
  TQwenResponsesOutputItem,
  TQwenResponsesStreamEvent,
} from './types';
import { streamWithAbort } from './responses-stream-utils';

interface IQwenResponsesParseOptions {
  enabledBuiltInTools: readonly TQwenBuiltInWebToolName[];
}

interface IQwenResponsesStreamAssemblyOptions extends IQwenResponsesParseOptions {
  stream: AsyncIterable<TQwenResponsesStreamEvent>;
  onTextDelta?: TTextDeltaCallback;
  signal?: AbortSignal;
}

interface IQwenProviderToolUsage {
  webSearchCalls: number;
  webExtractorCalls: number;
  unsupportedToolTypes: Set<string>;
}

interface IQwenResponsesStreamState {
  textParts: string[];
  toolCalls: IToolCall[];
  completedResponse?: IQwenResponsesResponse;
  usage: IQwenProviderToolUsage;
}

export function parseQwenResponsesResponse(
  response: IQwenResponsesResponse,
  options: IQwenResponsesParseOptions,
): TUniversalMessage {
  const output = response.output ?? [];
  const usage = collectProviderToolUsage(output, response.usage);
  const toolCalls = extractFunctionToolCalls(output);
  const content = response.output_text ?? extractMessageText(output);

  return buildAssistantMessage({
    content,
    toolCalls,
    response,
    usage,
    enabledBuiltInTools: options.enabledBuiltInTools,
  });
}

export async function assembleQwenResponsesStream(
  options: IQwenResponsesStreamAssemblyOptions,
): Promise<TUniversalMessage> {
  const state: IQwenResponsesStreamState = {
    textParts: [],
    toolCalls: [],
    usage: createEmptyToolUsage(),
  };

  for await (const event of streamWithAbort(options.stream, options.signal)) {
    applyStreamEvent(state, event, options.onTextDelta);
  }

  if (state.completedResponse !== undefined) {
    return buildMessageFromCompletedResponse(state, options.enabledBuiltInTools);
  }

  return buildAssistantMessage({
    content: state.textParts.join(''),
    toolCalls: state.toolCalls,
    usage: state.usage,
    enabledBuiltInTools: options.enabledBuiltInTools,
  });
}

function applyStreamEvent(
  state: IQwenResponsesStreamState,
  event: TQwenResponsesStreamEvent,
  onTextDelta: TTextDeltaCallback | undefined,
): void {
  if (event.type === 'response.output_text.delta') {
    state.textParts.push(event.delta);
    onTextDelta?.(event.delta);
    return;
  }

  if (event.type === 'response.completed') {
    state.completedResponse = event.response;
    mergeToolUsage(
      state.usage,
      collectProviderToolUsage(event.response.output ?? [], event.response.usage),
    );
    return;
  }

  if (event.type === 'response.output_item.done') {
    applyOutputItem(state, event.item);
    return;
  }

  if (event.type === 'response.web_search_call.completed') {
    state.usage.webSearchCalls += 1;
    return;
  }

  if (event.type === 'response.error' || event.type === 'response.failed') {
    throw new Error(`Qwen Responses API failed: ${extractErrorMessage(event)}`);
  }
}

function buildMessageFromCompletedResponse(
  state: IQwenResponsesStreamState,
  enabledBuiltInTools: readonly TQwenBuiltInWebToolName[],
): TUniversalMessage {
  const response = state.completedResponse;
  if (response === undefined) {
    throw new Error('Qwen Responses stream completed without response metadata');
  }

  const output = response.output ?? [];
  const responseToolCalls = extractFunctionToolCalls(output);
  const content =
    state.textParts.length > 0
      ? state.textParts.join('')
      : (response.output_text ?? extractMessageText(output));
  const usage = collectProviderToolUsage(output, response.usage);
  mergeToolUsage(usage, state.usage);

  return buildAssistantMessage({
    content,
    toolCalls: responseToolCalls.length > 0 ? responseToolCalls : state.toolCalls,
    response,
    usage,
    enabledBuiltInTools,
  });
}

function applyOutputItem(state: IQwenResponsesStreamState, item: TQwenResponsesOutputItem): void {
  if (item.type === 'function_call') {
    if (isFunctionCallOutputItem(item)) {
      state.toolCalls.push(convertFunctionCall(item));
    }
    return;
  }
  mergeToolUsage(state.usage, collectProviderToolUsage([item], undefined));
}

function buildAssistantMessage(input: {
  content: string;
  toolCalls: IToolCall[];
  response?: IQwenResponsesResponse;
  usage: IQwenProviderToolUsage;
  enabledBuiltInTools: readonly TQwenBuiltInWebToolName[];
}): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'assistant',
    content: input.content,
    state: 'complete',
    timestamp: new Date(),
    ...(input.toolCalls.length > 0 && { toolCalls: input.toolCalls }),
    ...(input.response?.usage !== undefined && {
      usage: {
        promptTokens: input.response.usage.input_tokens ?? 0,
        completionTokens: input.response.usage.output_tokens ?? 0,
        totalTokens: input.response.usage.total_tokens ?? 0,
      },
    }),
    metadata: buildProviderToolMetadata(input.enabledBuiltInTools, input.usage, input.response),
  };
}

function buildProviderToolMetadata(
  enabledBuiltInTools: readonly TQwenBuiltInWebToolName[],
  usage: IQwenProviderToolUsage,
  response: IQwenResponsesResponse | undefined,
): NonNullable<TUniversalMessage['metadata']> {
  const usedTools = collectUsedToolNames(usage);
  return {
    providerToolMode: 'qwen_responses',
    providerBuiltInToolsEnabled: [...enabledBuiltInTools],
    ...(usedTools.length > 0 && { providerBuiltInToolsUsed: usedTools }),
    qwenWebSearchCalls: usage.webSearchCalls,
    qwenWebExtractorCalls: usage.webExtractorCalls,
    ...(usage.unsupportedToolTypes.size > 0 && {
      qwenUnsupportedProviderToolTypes: [...usage.unsupportedToolTypes].sort(),
    }),
    ...(response?.id !== undefined && { responseId: response.id }),
    ...(response?.model !== undefined && { model: response.model }),
    ...(response?.status !== undefined && { finishReason: response.status }),
  };
}

function collectUsedToolNames(usage: IQwenProviderToolUsage): TQwenBuiltInWebToolName[] {
  const used: TQwenBuiltInWebToolName[] = [];
  if (usage.webSearchCalls > 0) {
    used.push('web_search');
  }
  if (usage.webExtractorCalls > 0) {
    used.push('web_extractor');
  }
  return used;
}

function collectProviderToolUsage(
  output: readonly TQwenResponsesOutputItem[],
  responseUsage: IQwenResponsesUsage | undefined,
): IQwenProviderToolUsage {
  const usage = createEmptyToolUsage();
  for (const item of output) {
    if (item.type === 'web_search_call') {
      usage.webSearchCalls += 1;
    } else if (item.type === 'web_extractor_call') {
      usage.webExtractorCalls += 1;
    } else if (isProviderToolOutput(item.type)) {
      usage.unsupportedToolTypes.add(item.type);
    }
  }
  applyUsageCounts(usage, responseUsage);
  return usage;
}

function applyUsageCounts(
  usage: IQwenProviderToolUsage,
  responseUsage: IQwenResponsesUsage | undefined,
): void {
  const xTools = responseUsage?.x_tools;
  if (xTools === undefined) {
    return;
  }
  usage.webSearchCalls = Math.max(usage.webSearchCalls, xTools['web_search']?.count ?? 0);
  usage.webExtractorCalls = Math.max(usage.webExtractorCalls, xTools['web_extractor']?.count ?? 0);
  for (const toolName of Object.keys(xTools)) {
    if (toolName !== 'web_search' && toolName !== 'web_extractor') {
      usage.unsupportedToolTypes.add(toolName);
    }
  }
}

function mergeToolUsage(target: IQwenProviderToolUsage, source: IQwenProviderToolUsage): void {
  target.webSearchCalls = Math.max(target.webSearchCalls, source.webSearchCalls);
  target.webExtractorCalls = Math.max(target.webExtractorCalls, source.webExtractorCalls);
  for (const toolType of source.unsupportedToolTypes) {
    target.unsupportedToolTypes.add(toolType);
  }
}

function createEmptyToolUsage(): IQwenProviderToolUsage {
  return {
    webSearchCalls: 0,
    webExtractorCalls: 0,
    unsupportedToolTypes: new Set(),
  };
}

function isProviderToolOutput(type: string): boolean {
  return type.endsWith('_call') && type !== 'function_call';
}

function extractFunctionToolCalls(output: readonly TQwenResponsesOutputItem[]): IToolCall[] {
  return output.filter(isFunctionCallOutputItem).map((item) => convertFunctionCall(item));
}

function isFunctionCallOutputItem(
  item: TQwenResponsesOutputItem,
): item is IQwenResponsesFunctionCallOutputItem {
  return (
    item.type === 'function_call' && 'call_id' in item && 'name' in item && 'arguments' in item
  );
}

function convertFunctionCall(item: IQwenResponsesFunctionCallOutputItem): IToolCall {
  return {
    id: item.call_id,
    type: 'function',
    function: {
      name: item.name,
      arguments: item.arguments,
    },
  };
}

function extractMessageText(output: readonly TQwenResponsesOutputItem[]): string {
  return output
    .filter((item): item is Extract<TQwenResponsesOutputItem, { type: 'message' }> => {
      return item.type === 'message';
    })
    .flatMap((item) => item.content)
    .map((part) => part.text)
    .join('');
}

function extractErrorMessage(event: IQwenResponsesErrorEvent): string {
  return event.message ?? event.error?.message ?? event.response?.error?.message ?? 'unknown error';
}
