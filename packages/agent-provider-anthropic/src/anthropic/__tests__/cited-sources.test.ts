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
      citationDelta(
        citation('https://example.com/a', 'Safe\u001b[2J\u0007 \u202Etitle\n2. Forged'),
      ),
      citationDelta(citation('javascript:alert(1)', 'Not a web address')),
      citationDelta(citation('not a url', 'Not an address at all')),
    ]);

    expect(content).toBe(
      'Text.\n\n[Sources]\n1. Safe 2J title 2. Forged\n   https://example.com/a',
    );
  });

  it.each([
    [
      'a link that shows one address and opens another',
      '[https://bank.example/](https://evil.example/)',
    ],
    ['a reference definition', '[1]: https://evil.example/'],
    ['an image', '![](https://evil.example/x.png)'],
    ['raw HTML', '<a href="https://evil.example/">bank</a>'],
    ['a code span that hides the line', '`bank`'],
  ])('leaves no markdown or HTML syntax in a title holding %s', async (_label, title) => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta(citation('https://example.com/a', title)),
    ]);

    const printed = content.split('[Sources]\n1. ')[1]?.split('\n')[0] ?? '';
    expect(printed).not.toMatch(/[[\]<>`]/);
  });

  it.each([
    ['its path', 'https://x.example/][https://bank.example/](https://evil.example/)'],
    ['its query', 'https://x.example/?q=][https://bank.example/](https://evil.example/)'],
    ['its fragment', 'https://x.example/#][https://bank.example/](https://evil.example/)'],
    ['its query, with a backtick', 'https://x.example/?q=`a`'],
  ])('leaves no markdown syntax in an address that holds it in %s', async (_label, url) => {
    const { content } = await replyFrom([textDelta('Text.'), citationDelta(citation(url, 'T'))]);

    const address = content.split('\n   ')[1] ?? '';
    expect(address).toMatch(/^https:\/\/x\.example\//);
    expect(address).not.toMatch(/[[\]`]/);
  });

  it('keeps an IPv6 host whole and prints no user name that could pass for the host', async () => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta(citation('https://[::1]:8443/a', 'Six')),
      citationDelta(citation('https://bank.example@evil.example/a', 'Named')),
    ]);

    expect(content).toContain('https://[::1]:8443/a');
    expect(content).toContain('https://evil.example/a');
    expect(content).not.toContain('bank.example');
  });

  it('lists an address once whatever spelling each citation used', async () => {
    const { content } = await replyFrom([
      textDelta('Text.'),
      citationDelta(citation('https://example.com', 'First')),
      citationDelta(citation('HTTPS://Example.COM/', 'Second')),
      citationDelta(citation('https://example.com:443/', 'Third')),
    ]);

    expect(content).toBe('Text.\n\n[Sources]\n1. First\n   https://example.com/');
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

    expect(content).toContain('[Web Search Results]\n1. Good 2J\n   https://example.com/a');
    expect(content).not.toContain('javascript:');
  });
});
