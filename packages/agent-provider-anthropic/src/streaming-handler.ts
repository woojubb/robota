import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { TUniversalMessage, TTextDeltaCallback } from '@robota-sdk/agent-core';
import { formatWebSearchResults } from './message-converter';

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
): Promise<TUniversalMessage> {
  const streamParams: Anthropic.MessageCreateParamsStreaming = {
    ...params,
    stream: true,
  };

  const stream = await client.messages.create(streamParams, signal ? { signal } : undefined);

  // Accumulate the full response from stream events
  const textParts: string[] = [];
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];
  let currentToolId = '';
  let currentToolName = '';
  let currentToolJson = '';
  let currentBlockType = '';
  let usage = { input_tokens: 0, output_tokens: 0 };
  let model = '';
  let stopReason: string | null = null;

  try {
    for await (const event of streamWithAbort(stream, signal)) {
      switch (event.type) {
        case 'message_start':
          usage = event.message.usage;
          model = event.message.model;
          break;

        case 'content_block_start':
          currentBlockType = event.content_block.type;
          if (event.content_block.type === 'tool_use') {
            currentToolId = event.content_block.id;
            currentToolName = event.content_block.name;
            currentToolJson = '';
          } else if (event.content_block.type === 'server_tool_use') {
            const serverBlock = event.content_block as {
              name?: string;
              input?: { query?: string };
            };
            const query = serverBlock.input?.query ?? '';
            const toolLabel = query
              ? `\n🔍 Searching: "${query}"\n`
              : `\n🔍 [${serverBlock.name ?? 'server_tool'}]\n`;
            textParts.push(toolLabel);
            onTextDelta(toolLabel);
            if (onServerToolUse) {
              onServerToolUse(serverBlock.name ?? 'server_tool', { query });
            }
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
          } else if (event.delta.type === 'input_json_delta') {
            currentToolJson += event.delta.partial_json;
          }
          break;

        case 'content_block_stop':
          if (currentToolId) {
            toolCalls.push({
              id: currentToolId,
              type: 'function' as const,
              function: {
                name: currentToolName,
                arguments: currentToolJson || '{}',
              },
            });
            currentToolId = '';
            currentToolName = '';
            currentToolJson = '';
          }
          currentBlockType = '';
          break;

        case 'message_delta':
          if (event.usage) {
            usage.output_tokens = event.usage.output_tokens;
          }
          stopReason = event.delta.stop_reason;
          break;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return buildPartialResult(textParts, toolCalls, usage, model);
    }
    throw err;
  }

  // If aborted via break (not via catch), return partial response
  if (signal?.aborted) {
    return buildPartialResult(textParts, toolCalls, usage, model);
  }

  const textContent = textParts.join('') || '';

  const result: TUniversalMessage = {
    id: randomUUID(),
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
  };
  if (stopReason) {
    result.metadata['stopReason'] = stopReason;
  }

  return result;
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
): TUniversalMessage {
  const partialText = textParts.join('') || '';
  const partialResult: TUniversalMessage = {
    id: randomUUID(),
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
