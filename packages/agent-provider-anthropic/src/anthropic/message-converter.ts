import { nonVisualObservationText } from '@robota-sdk/agent-core';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  TUniversalMessage,
  IToolSchema,
  IAssistantMessage,
  IToolMessage,
  IUserMessage,
} from '@robota-sdk/agent-core';

/**
 * Issue #2875 (follow-up to #2078): `tc.function.arguments` is untrusted text a provider emitted —
 * a bare `JSON.parse` here threw a raw `SyntaxError` out of message conversion for malformed JSON,
 * and passed an array root straight to the Anthropic API for a call like `[1]` (the API requires an
 * object `input`), UNCAUGHT — worse than agent-core's decode-time refusal, since it happened on the
 * NEXT round, after the batch had already been reported back to the model as isolated per-call
 * failures. `{}` on failure keeps the round from crashing a second time on the same malformed call.
 */
function parseAnthropicToolCallInput(serializedArguments: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedArguments);
  } catch {
    return {};
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

/** Convert IUserMessage parts to Anthropic content blocks (text + images). */
function convertUserParts(
  msg: Pick<IUserMessage, 'content' | 'parts'>,
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
    } else {
      blocks.push({
        type: 'text',
        text: nonVisualObservationText(part) ?? 'Unsupported observation',
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
            input: parseAnthropicToolCallInput(tc.function.arguments),
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
            ...(toolMsg.metadata?.['success'] === false ? { is_error: true } : {}),
            content: toolMsg.parts?.length
              ? [
                  ...(toolMsg.content &&
                  !toolMsg.parts.some(
                    (part) => part.type === 'text' && part.text === toolMsg.content,
                  )
                    ? [{ type: 'text' as const, text: toolMsg.content }]
                    : []),
                  ...convertUserParts(toolMsg),
                ]
              : msg.content || '',
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
 * Text from a web page, reduced to words. Control and format characters could steer a terminal or
 * reorder the line, and every surface renders the reply as markdown, where brackets, angle brackets
 * and backticks could make a link that shows one address and opens another.
 */
function printableTitle(title: string | null): string {
  return (title ?? '')
    .replace(/[\p{Cc}\p{Cf}[\]<>`]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A page-supplied address, or undefined when it is not a web address. Brackets and backticks stay
 * legal after the host, where markdown would read them as a link that shows one address and opens
 * another, so they print percent-encoded. The origin drops any `user@`, which could pass for the host.
 */
function webAddress(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    const rest = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${parsed.origin}${rest.replace(/[[\]`]/g, (char) => encodeURIComponent(char))}`;
  } catch {
    return undefined;
  }
}

/** A headed, numbered list with one line per web address; empty when there is no web address. */
function formatSourceList(
  heading: string,
  sources: ReadonlyArray<{ title: string | null; url: string }>,
): string {
  const seen = new Set<string>();
  const lines = sources.flatMap(({ title, url }) => {
    const address = webAddress(url);
    if (address === undefined || seen.has(address)) return [];
    seen.add(address);
    const printable = printableTitle(title);
    return [printable ? `${printable}\n   ${address}` : address];
  });
  return lines.length > 0
    ? `${heading}\n${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}`
    : '';
}

/** Format a WebSearchToolResultBlock into readable text. */
export function formatWebSearchResults(block: Anthropic.Messages.WebSearchToolResultBlock): string {
  if (!Array.isArray(block.content)) return '';

  return formatSourceList(
    '[Web Search Results]',
    block.content.filter(
      (r): r is Anthropic.Messages.WebSearchResultBlock =>
        r.type === 'web_search_result' && 'title' in r && 'url' in r,
    ),
  );
}

/**
 * The web sources a reply cites, one per address in first-cited order. Anthropic's documentation
 * asks for citations to be shown with the output, and they arrive beside the text rather than in it.
 */
export function formatCitedSources(citations: readonly Anthropic.Messages.TextCitation[]): string {
  return formatSourceList(
    '[Sources]',
    citations.filter(
      (citation): citation is Anthropic.Messages.CitationsWebSearchResultLocation =>
        citation.type === 'web_search_result_location',
    ),
  );
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
