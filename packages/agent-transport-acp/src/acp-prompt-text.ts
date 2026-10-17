/** A prompt's content blocks as the single text the session receives. */

import type { ContentBlock } from '@agentclientprotocol/sdk';

export interface IAcpPromptText {
  /** What the person typed: the text blocks alone. A `/command` is recognised on this. */
  readonly typed: string;
  /** What the session receives: the typed text followed by the context the editor attached. */
  readonly full: string;
}

const MIN_FENCE = 3;

/** A backtick fence longer than any run inside the text, so attached content cannot close it early. */
function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length));
  return '`'.repeat(Math.max(MIN_FENCE, longest + 1));
}

/**
 * Text blocks are the typed message. An embedded text resource is appended as fenced context; a
 * resource link is listed by URI so the model can read it under the session's own permissions. Image
 * and audio blocks are not advertised as supported, so they are ignored.
 */
export function promptText(blocks: readonly ContentBlock[]): IAcpPromptText {
  let typed = '';
  const context: string[] = [];
  const links: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text') typed += block.text;
    else if (block.type === 'resource' && 'text' in block.resource) {
      const marks = fence(block.resource.text);
      context.push(
        `Context from ${block.resource.uri}:\n${marks}\n${block.resource.text}\n${marks}`,
      );
    } else if (block.type === 'resource_link') links.push(`- ${block.uri}`);
  }
  if (links.length > 0) context.push(`Referenced resources:\n${links.join('\n')}`);
  return { typed, full: context.length === 0 ? typed : `${typed}\n\n${context.join('\n\n')}` };
}
