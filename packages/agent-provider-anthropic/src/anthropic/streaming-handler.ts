import { randomId } from '@robota-sdk/agent-core';

import { formatCitedSources, formatWebSearchResults } from './message-converter';
import { awaitWithProviderRequestId } from './provider-request-id';

import type Anthropic from '@anthropic-ai/sdk';
import type {
  TProviderNativeRawPayloadCallback,
  TUniversalMessage,
  TTextDeltaCallback,
} from '@robota-sdk/agent-core';

/** SDK request options, or none at all when there is neither a signal nor a header to send. */
export function anthropicRequestOptions(
  signal: AbortSignal | undefined,
  headers: Readonly<Record<string, string>>,
): Anthropic.RequestOptions | undefined {
  const hasHeaders = Object.keys(headers).length > 0;
  if (!signal && !hasHeaders) return undefined;
  return { ...(signal ? { signal } : {}), ...(hasHeaders ? { headers: { ...headers } } : {}) };
}

/**
 * Stream the Anthropic API response and assemble a complete TUniversalMessage.
 *
 * Calls onTextDelta for each text chunk as it arrives.
 * Returns the fully assembled TUniversalMessage when the stream is done.
 */
export async function streamAndAssemble(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  onTextDelta: TTextDeltaCallback,
  onServerToolUse: ((toolName: string, input: Record<string, string>) => void) | undefined,
  signal: AbortSignal | undefined,
  onProviderNativeRawPayload?: TProviderNativeRawPayloadCallback,
  /** Per-request headers (trusted `traceparent`), added after the request payload was captured. */
  requestHeaders: Readonly<Record<string, string>> = {},
): Promise<TUniversalMessage> {
  const streamParams: Anthropic.MessageCreateParamsStreaming = {
    ...params,
    stream: true,
  };

  onProviderNativeRawPayload?.({
    provider: 'anthropic',
    apiSurface: 'anthropic-messages',
    payloadKind: 'request',
    payload: streamParams,
  });
  const { data: stream, providerRequestId } = await awaitWithProviderRequestId(
    client.messages.create(streamParams, anthropicRequestOptions(signal, requestHeaders)),
  );

  // Accumulate the full response from stream events
  const textParts: string[] = [];
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];
  let currentTool:
    | { kind: 'client'; id: string; name: string; json: string }
    | { kind: 'server'; name: string; json: string }
    | undefined;
  const citations: Anthropic.Messages.TextCitation[] = [];
  let usage = { input_tokens: 0, output_tokens: 0 };
  let sawUsageStart = false;
  let sawUsageEnd = false;
  let model = '';
  let stopReason: string | null = null;

  try {
    let sequence = 0;
    for await (const event of streamWithAbort(stream, signal)) {
      onProviderNativeRawPayload?.({
        provider: 'anthropic',
        apiSurface: 'anthropic-messages',
        payloadKind: 'stream_event',
        sequence,
        payload: event,
      });
      sequence++;
      switch (event.type) {
        case 'message_start':
          usage = event.message.usage;
          sawUsageStart = true;
          model = event.message.model;
          break;

        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentTool = {
              kind: 'client', id: event.content_block.id, name: event.content_block.name, json: '',
            };
          } else if (event.content_block.type === 'server_tool_use') {
            currentTool = { kind: 'server', name: event.content_block.name, json: '' };
          } else if (event.content_block.type === 'web_search_tool_result') {
            const resultBlock = event.content_block as Anthropic.Messages.WebSearchToolResultBlock;
            const formatted = formatWebSearchResults(resultBlock);
            if (formatted) {
              textParts.push(`\n${formatted}\n\n`);
              onTextDelta(`\n${formatted}\n\n`);
            }
          }
          break;

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            textParts.push(event.delta.text);
            onTextDelta(event.delta.text);
          } else if (event.delta.type === 'citations_delta') {
            citations.push(event.delta.citation);
          } else if (event.delta.type === 'input_json_delta') {
            if (currentTool) currentTool.json += event.delta.partial_json;
          }
          break;

        case 'content_block_stop':
          if (currentTool?.kind === 'client') {
            toolCalls.push({
              id: currentTool.id,
              type: 'function',
              function: { name: currentTool.name, arguments: currentTool.json || '{}' },
            });
          } else if (currentTool?.kind === 'server') {
            const query = serverToolQuery(currentTool.json);
            const toolLabel = query
              ? `\n🔍 Searching: "${query}"\n`
              : `\n🔍 [${currentTool.name}]\n`;
            textParts.push(toolLabel);
            onTextDelta(toolLabel);
            onServerToolUse?.(currentTool.name, { query });
          }
          currentTool = undefined;
          break;

        case 'message_delta':
          if (event.usage) {
            usage.output_tokens = event.usage.output_tokens;
            sawUsageEnd = true;
          }
          stopReason = event.delta.stop_reason;
          break;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return buildPartialResult(textParts, toolCalls, usage, model, providerRequestId);
    }
    throw err;
  }

  // If aborted via break (not via catch), return partial response
  if (signal?.aborted) {
    return buildPartialResult(textParts, toolCalls, usage, model, providerRequestId);
  }

  const citedSources = formatCitedSources(citations);
  if (citedSources) {
    textParts.push(`\n\n${citedSources}`);
    onTextDelta(`\n\n${citedSources}`);
  }

  const textContent = textParts.join('') || '';

  const result: TUniversalMessage = {
    id: randomId(),
    role: 'assistant',
    content: textContent,
    state: 'complete' as const,
    timestamp: new Date(),
    ...(toolCalls.length > 0 && { toolCalls }),
  };

  result.metadata = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    model,
    ...((sawUsageStart || sawUsageEnd) && {
      usageProvenance: sawUsageStart && sawUsageEnd && stopReason ? 'complete' : 'partial',
    }),
    ...(providerRequestId !== undefined && { providerRequestId }),
  };
  if (stopReason) {
    result.metadata['stopReason'] = stopReason;
  }

  return result;
}

function serverToolQuery(json: string): string {
  if (!json) return '';
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === 'object' && value !== null && 'query' in value && typeof value.query === 'string') {
      return value.query;
    }
  } catch {
    // An incomplete or malformed server input still has a readable bare marker.
  }
  return '';
}

function buildPartialResult(
  textParts: string[],
  toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>,
  usage: { input_tokens: number; output_tokens: number },
  model: string,
  providerRequestId?: string,
): TUniversalMessage {
  const partialText = textParts.join('') || '';
  const partialResult: TUniversalMessage = {
    id: randomId(),
    role: 'assistant',
    content: partialText,
    state: 'complete' as const,
    timestamp: new Date(),
    ...(toolCalls.length > 0 && { toolCalls }),
  };
  partialResult.metadata = {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    model,
    stopReason: 'aborted',
    usageProvenance: 'partial',
    ...(providerRequestId !== undefined && { providerRequestId }),
  };
  return partialResult;
}

/**
 * Wrap a stream to support abort signal interruption.
 */
async function* streamWithAbort(
  stream: AsyncIterable<Anthropic.MessageStreamEvent>,
  signal?: AbortSignal,
): AsyncIterable<Anthropic.MessageStreamEvent> {
  for await (const event of stream) {
    if (signal?.aborted) break;
    yield event;
  }
}

/**
 * Turn one raw Anthropic stream event into the universal chunks it carries, forwarding the raw
 * payload on the way past.
 *
 * Lives here rather than inline in the provider: shaping a vendor delta into a universal message is
 * this module's job, and the provider class is orchestration.
 */
export function* toUniversalStreamChunks(
  chunk: Anthropic.MessageStreamEvent,
): Generator<TUniversalMessage> {
  if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
    yield {
      id: randomId(),
      role: 'assistant',
      content: chunk.delta.text,
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}
