import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type {
  TUniversalMessage,
  IToolSchema,
  IAssistantMessage,
  IToolMessage,
} from '@robota-sdk/agent-core';

/**
 * Convert TUniversalMessage array to Anthropic message format.
 *
 * CRITICAL: Anthropic API requires specific content handling:
 * - tool_use messages: content MUST be null
 * - regular messages: content should be a string
 */
export function convertToAnthropicFormat(messages: TUniversalMessage[]): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return {
        role: 'user',
        content: msg.content || '',
      };
    } else if (msg.role === 'assistant') {
      const assistantMsg = msg as IAssistantMessage;

      // Anthropic uses content blocks — include both text and tool_use
      if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
        const contentBlocks: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = [];

        // Include text content if present alongside tool calls
        if (assistantMsg.content) {
          contentBlocks.push({
            type: 'text' as const,
            text: assistantMsg.content,
          });
        }

        for (const tc of assistantMsg.toolCalls) {
          contentBlocks.push({
            type: 'tool_use' as const,
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }

        return {
          role: 'assistant' as const,
          content: contentBlocks,
        };
      }

      // Regular assistant message (no tool calls)
      return {
        role: 'assistant',
        content: assistantMsg.content || '',
      };
    } else if (msg.role === 'tool') {
      // Tool result message — convert to Anthropic tool_result content block
      const toolMsg = msg as IToolMessage;
      return {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: toolMsg.toolCallId ?? '',
            content: msg.content || '',
          },
        ],
      };
    } else {
      // System messages
      return {
        role: 'user', // Anthropic doesn't have system role, use user
        content: msg.content || '',
      };
    }
  });
}

/**
 * Convert Anthropic response to TUniversalMessage.
 *
 * Anthropic responses can contain multiple content blocks:
 * e.g., [text("I'll read the file"), tool_use(Read, {...}), tool_use(Bash, {...})]
 * We must extract ALL text and ALL tool_use blocks.
 */
export function convertFromAnthropicResponse(response: Anthropic.Message): TUniversalMessage {
  if (!response.content || response.content.length === 0) {
    throw new Error('No content in Anthropic response');
  }

  let textParts: string[] = [];
  const toolCalls: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }> = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      const textBlock = block as Anthropic.TextBlock;
      if (textBlock.text) {
        textParts.push(textBlock.text);
      }
    } else if (block.type === 'tool_use') {
      const toolBlock = block as Anthropic.ToolUseBlock;
      toolCalls.push({
        id: toolBlock.id,
        type: 'function' as const,
        function: {
          name: toolBlock.name,
          arguments: JSON.stringify(toolBlock.input),
        },
      });
    } else if (block.type === 'server_tool_use') {
      // Server tool invocation (e.g., web_search) — results come in a separate block
    } else if (block.type === 'web_search_tool_result') {
      const resultBlock = block as Anthropic.Messages.WebSearchToolResultBlock;
      const searchResults = formatWebSearchResults(resultBlock);
      if (searchResults) {
        textParts.push(searchResults);
      }
    }
  }

  // Use empty string instead of null so agent-core's buildFinalResult
  // doesn't reject the message. Tool-only responses have no text.
  const textContent = textParts.join('\n') || '';

  const result: TUniversalMessage = {
    id: randomUUID(),
    role: 'assistant',
    content: textContent,
    state: 'complete' as const,
    timestamp: new Date(),
    ...(toolCalls.length > 0 && { toolCalls }),
  };

  // Add metadata if available
  if (response.usage) {
    result.metadata = {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    };

    if (response.stop_reason) {
      result.metadata['stopReason'] = response.stop_reason;
    }
  }

  return result;
}

/** Format a WebSearchToolResultBlock into readable text. */
export function formatWebSearchResults(block: Anthropic.Messages.WebSearchToolResultBlock): string {
  if (!Array.isArray(block.content)) return '';

  const results = block.content
    .filter(
      (r): r is Anthropic.Messages.WebSearchResultBlock =>
        r.type === 'web_search_result' && 'title' in r && 'url' in r,
    )
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`)
    .join('\n');

  return results ? `[Web Search Results]\n${results}` : '';
}

/**
 * Convert tool schemas to Anthropic format.
 */
export function convertToolsToAnthropicFormat(tools: IToolSchema[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }));
}
