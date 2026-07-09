import { randomUUID } from 'node:crypto';

import type Anthropic from '@anthropic-ai/sdk';
import type {
  TUniversalMessage,
  IToolSchema,
  IAssistantMessage,
  IToolMessage,
  IUserMessage,
} from '@robota-sdk/agent-core';

/** Convert IUserMessage parts to Anthropic content blocks (text + images). */
function convertUserParts(
  msg: IUserMessage,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  if (!msg.parts || msg.parts.length === 0) {
    return [{ type: 'text', text: msg.content || '' }];
  }

  const blocks: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> = [];
  for (const part of msg.parts) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_inline') {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType as Anthropic.Base64ImageSource['media_type'],
          data: part.data,
        },
      });
    } else if (part.type === 'image_uri') {
      blocks.push({
        type: 'image',
        source: { type: 'url', url: part.uri },
      });
    }
  }
  return blocks;
}

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
      const userMsg = msg as IUserMessage;
      if (userMsg.parts && userMsg.parts.length > 0) {
        return { role: 'user', content: convertUserParts(userMsg) };
      }
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

/**
 * Map the provider-agnostic tool-invocation directive onto Anthropic's `tool_choice`
 * parameter (CORE-017). `'required'` maps to Anthropic's `{ type: 'any' }` (the model must
 * call some tool); a named directive maps to `{ type: 'tool', name }`.
 */
export function toAnthropicToolChoice(
  toolChoice: 'auto' | 'none' | 'required' | { tool: string },
): Anthropic.Messages.ToolChoice {
  if (toolChoice === 'auto') {
    return { type: 'auto' };
  }
  if (toolChoice === 'none') {
    return { type: 'none' };
  }
  if (toolChoice === 'required') {
    return { type: 'any' };
  }
  return { type: 'tool', name: toolChoice.tool };
}
