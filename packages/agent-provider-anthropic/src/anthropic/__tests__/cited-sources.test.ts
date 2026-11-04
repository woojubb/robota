/**
 * The sources a reply cites: Anthropic's documentation asks for them to be shown, and they arrive
 * beside the text, so without this a reader sees every search result but not which ones back the answer.
 */
import { describe, expect, it, vi } from 'vitest';

import { AnthropicProvider } from '../provider';

import type { TUniversalMessage } from '@robota-sdk/agent-core';

const messages: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'When?', state: 'complete', timestamp: new Date() },
];

function citation(url: string, title: string | null = 'A title'): Record<string, unknown> {
  return {
    type: 'web_search_result_location',
    url,
    title,
    cited_text: 'quoted',
    encrypted_index: 'index',
  };
}

function textDelta(text: string): Record<string, unknown> {
  return { type: 'content_block_delta', delta: { type: 'text_delta', text } };
}

function citationDelta(cited: Record<string, unknown>): Record<string, unknown> {
  return { type: 'content_block_delta', delta: { type: 'citations_delta', citation: cited } };
}

/** The reply text and the deltas handed to the caller, for a stream of these content events. */
async function replyFrom(
  events: Record<string, unknown>[],
): Promise<{ content: string; deltas: string[] }> {
  async function* stream(): AsyncIterable<Record<string, unknown>> {
    yield {
      type: 'message_start',
      message: { usage: { input_tokens: 1, output_tokens: 0 }, model: 'claude-test' },
    };
    yield { type: 'content_block_start', content_block: { type: 'text' } };
    yield* events;
    yield { type: 'content_block_stop' };
    yield {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 2 },
    };
  }
  const client = { messages: { create: vi.fn().mockResolvedValue(stream()) } };
  const provider = new AnthropicProvider({
    client: client as unknown as ConstructorParameters<typeof AnthropicProvider>[0]['client'],
  });
  const deltas: string[] = [];
  const result = await provider.chat(messages, {
    model: 'claude-test',
    onTextDelta: (delta) => deltas.push(delta),
  });
  return { content: result.content ?? '', deltas };
}

describe('sources a reply cites', () => {
  it('ends the reply with them, one per URL in first-cited order', async () => {
    const { content, deltas } = await replyFrom([
      textDelta('Born in 1916.'),
      citationDelta(citation('https://example.com/b', 'B')),
      textDelta(' In Michigan.'),
      citationDelta(citation('https://example.com/a', 'A')),
      citationDelta(citation('https://example.com/b', 'B again')),
    ]);

    expect(content).toBe(
      'Born in 1916. In Michigan.\n\n[Sources]\n1. B\n   https://example.com/b\n2. A\n   https://example.com/a',
    );
    expect(deltas.join('')).toBe(content);
  });

  it('adds nothing to a reply that cites nothing', async () => {
    expect((await replyFrom([textDelta('No search here.')])).content).toBe('No search here.');
  });

  it('prints only the URL for a source with no title', async () => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta(citation('https://example.com/a', null)),
    ]);

    expect(content).toBe('Text.\n\n[Sources]\n1. https://example.com/a');
  });

  it('ignores citations that are not web sources', async () => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta({ type: 'char_location', cited_text: 'quoted', document_index: 0 }),
    ]);

    expect(content).toBe('Text.');
  });

  it('prints a page-supplied title and URL without what could steer a terminal', async () => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta(citation('https://example.com/a', 'Safe\u001b[2J\u0007 ‮title\n2. Forged')),
      citationDelta(citation('javascript:alert(1)', 'Not a web address')),
      citationDelta(citation('not a url', 'Not an address at all')),
    ]);

    expect(content).toBe(
      'Text.\n\n[Sources]\n1. Safe [2J   title 2. Forged\n   https://example.com/a',
    );
  });

  it('keeps the search results list to web addresses and printable titles too', async () => {
    const { content } = await replyFrom([
      {
        type: 'content_block_start',
        content_block: {
          type: 'web_search_tool_result',
          content: [
            { type: 'web_search_result', title: 'Good\u001b[2J', url: 'https://example.com/a' },
            { type: 'web_search_result', title: 'Bad', url: 'javascript:alert(1)' },
          ],
        },
      },
    ]);

    expect(content).toContain('[Web Search Results]\n1. Good [2J\n   https://example.com/a');
    expect(content).not.toContain('javascript:');
  });
});
