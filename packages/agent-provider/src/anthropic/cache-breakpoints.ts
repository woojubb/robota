import type Anthropic from '@anthropic-ai/sdk';

/**
 * Prompt-cache breakpoints for one request.
 *
 * The API caches the exact bytes of the prompt up to a marked block, in the order tools, system,
 * messages. Two markers are enough for an agent loop: the system prompt (which also covers the tools
 * before it), and the end of the history, which moves forward as the conversation grows so that each
 * call reads what the previous one wrote. A prefix below the model's minimum silently does not cache.
 */
const EPHEMERAL: Anthropic.CacheControlEphemeral = { type: 'ephemeral' };

type TMarkableBlock =
  | Anthropic.TextBlockParam
  | Anthropic.ImageBlockParam
  | Anthropic.ToolUseBlockParam
  | Anthropic.ToolResultBlockParam;

/** The system prompt as one block that ends a cached prefix. */
export function cachedSystem(prompt: string): Anthropic.TextBlockParam[] {
  return [{ type: 'text', text: prompt, cache_control: EPHEMERAL }];
}

/**
 * The messages with a breakpoint on the end of the last one. The input is not modified; a history
 * that ends in nothing a marker can sit on (an empty text, a thinking block) is returned as it is.
 */
export function withTailBreakpoint(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  if (last === undefined) return messages;
  const content = markedContent(last.content);
  if (content === undefined) return messages;
  return [...messages.slice(0, lastIndex), { ...last, content }];
}

function markedContent(
  content: Anthropic.MessageParam['content'],
): Anthropic.ContentBlockParam[] | undefined {
  if (typeof content === 'string') {
    return content.length > 0
      ? [{ type: 'text', text: content, cache_control: EPHEMERAL }]
      : undefined;
  }
  for (let index = content.length - 1; index >= 0; index -= 1) {
    const block = content[index];
    if (block !== undefined && isMarkable(block)) {
      return [
        ...content.slice(0, index),
        { ...block, cache_control: EPHEMERAL },
        ...content.slice(index + 1),
      ];
    }
  }
  return undefined;
}

function isMarkable(block: Anthropic.ContentBlockParam): block is TMarkableBlock {
  if (block.type === 'text') return block.text.length > 0;
  return block.type === 'image' || block.type === 'tool_use' || block.type === 'tool_result';
}
