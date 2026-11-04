/**
 * Hosted web search on OpenAI's own Responses API: when a `web_search` tool joins a request, how the
 * result reports it, and where the option is accepted at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';
import { createOpenAIProviderDefinition } from '../provider-definition';

import type { IChatOptions, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

const WEB_SEARCH_TOOL = { type: 'web_search' };

const lookupTool: IToolSchema = {
  name: 'lookup',
  description: 'Look something up',
  parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
};

const messages: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

type TRequest = Record<string, unknown> & { tools?: unknown[]; tool_choice?: unknown };

function citedMessage(urls: readonly string[]): Record<string, unknown> {
  return {
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'output_text',
        text: 'answer',
        annotations: [
          ...urls.map((url) => ({ type: 'url_citation', url, title: url })),
          { type: 'file_citation', file_id: 'file-1' },
        ],
      },
    ],
  };
}

function completedResponse(output: unknown[] = []): Record<string, unknown> {
  return { id: 'resp-1', model: 'gpt-4o', output_text: 'answer', output, status: 'completed' };
}

async function* eventsFrom(events: unknown[]): AsyncIterable<unknown> {
  for (const event of events) yield event;
}

function setup(
  options: Record<string, unknown> = {},
  result: unknown = completedResponse(),
): { provider: OpenAIProvider; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue(result);
  const client = { responses: { create } } as unknown as OpenAI;
  const provider = new OpenAIProvider({ client, defaultModel: 'gpt-4o', ...options });
  return { provider, create };
}

function searching(options: Record<string, unknown> = {}): Record<string, unknown> {
  return { nativeWebTools: { webSearch: true }, ...options };
}

async function sentRequest(
  options: Record<string, unknown>,
  chatOptions: IChatOptions = {},
): Promise<TRequest> {
  const { provider, create } = setup(options);
  await provider.chat(messages, chatOptions);
  return create.mock.calls[0]?.[0] as TRequest;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hosted web search request', () => {
  it('adds the web_search tool after the function tools and keeps tool_choice auto', async () => {
    const request = await sentRequest(searching(), { tools: [lookupTool] });

    expect(request.tools).toEqual([
      expect.objectContaining({ type: 'function', name: 'lookup' }),
      WEB_SEARCH_TOOL,
    ]);
    expect(request.tool_choice).toBe('auto');
  });

  it('sends web_search alone when the caller has no function tools', async () => {
    const request = await sentRequest(searching());

    expect(request.tools).toEqual([WEB_SEARCH_TOOL]);
    expect(request.tool_choice).toBe('auto');
  });

  it('sends the same tool on a streamed request', async () => {
    const { provider, create } = setup(searching(), eventsFrom([]));
    await provider.chat(messages, { onTextDelta: () => undefined });

    const request = create.mock.calls[0]?.[0] as TRequest;
    expect(request.stream).toBe(true);
    expect(request.tools).toEqual([WEB_SEARCH_TOOL]);
  });

  it('adds no web_search tool by default, and no tools field without function tools', async () => {
    const request = await sentRequest({});

    expect(request).not.toHaveProperty('tools');
    expect(request).not.toHaveProperty('tool_choice');

    const withFunction = await sentRequest({}, { tools: [lookupTool] });
    expect(withFunction.tools).toEqual([expect.objectContaining({ type: 'function' })]);
  });

  describe('withheld', () => {
    const cases: Array<[string, IChatOptions, Record<string, unknown>]> = [
      ['toolChoice none', { toolChoice: 'none' }, {}],
      ['toolChoice required', { toolChoice: 'required' }, {}],
      ['a forced function', { toolChoice: { tool: 'x' } }, {}],
      ['a per-call webSearch false', { nativeWebTools: { webSearch: false } }, {}],
      ['minimal reasoning', {}, { reasoning: { effort: 'minimal' } }],
    ];

    it.each(cases)('for %s', async (_label, chatOptions, providerOptions) => {
      const request = await sentRequest(searching(providerOptions), {
        tools: [lookupTool],
        ...chatOptions,
      });

      expect(request.tools).toEqual([expect.objectContaining({ type: 'function' })]);
    });

    it.each([
      'gpt-4.1-nano',
      'gpt-4.1-nano-2025-04-14',
      'o1',
      'o1-pro',
      'o3-mini',
      'gpt-3.5-turbo',
      'gpt-4',
      'gpt-4-turbo',
    ])('for the model %s', async (model) => {
      const request = await sentRequest(searching(), { model, tools: [lookupTool] });

      expect(request.tools).toEqual([expect.objectContaining({ type: 'function' })]);
    });
  });

  it.each([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4.1',
    'gpt-4.1-mini',
    'o3',
    'o4-mini',
    'gpt-5',
    'gpt-5.5',
  ])('is included for the model %s', async (model) => {
    const request = await sentRequest(searching(), { model });

    expect(request.tools).toEqual([WEB_SEARCH_TOOL]);
  });

  it('is included for an explicit auto tool choice', async () => {
    const request = await sentRequest(searching(), { toolChoice: 'auto' });

    expect(request.tools).toEqual([WEB_SEARCH_TOOL]);
  });

  it('withholds the tool for the provider default model too', async () => {
    const request = await sentRequest(searching({ defaultModel: 'o3-mini' }));

    expect(request).not.toHaveProperty('tools');
  });
});

describe('hosted web search result', () => {
  const twoSearches = [
    {
      type: 'web_search_call',
      id: 'ws1',
      status: 'completed',
      action: { type: 'search', query: 'a' },
    },
    {
      type: 'web_search_call',
      id: 'ws2',
      status: 'completed',
      action: { type: 'open_page', url: 'https://a.test' },
    },
    {
      type: 'web_search_call',
      id: 'ws3',
      status: 'completed',
      action: { type: 'search', query: 'b' },
    },
    citedMessage(['https://a.test', 'https://b.test', 'https://a.test']),
  ];

  it('counts only search actions and lists each cited URL once, in order', async () => {
    const { provider } = setup(searching(), completedResponse(twoSearches));

    const message = await provider.chat(messages, {});

    expect(message.metadata).toMatchObject({
      providerBuiltInToolsEnabled: ['web_search'],
      providerBuiltInToolsUsed: ['web_search'],
      openaiWebSearchCalls: 2,
      openaiWebSearchCitations: ['https://a.test', 'https://b.test'],
    });
  });

  it('counts a call that names no action as a search', async () => {
    const { provider } = setup(
      searching(),
      completedResponse([{ type: 'web_search_call', id: 'ws1' }]),
    );

    const message = await provider.chat(messages, {});

    expect(message.metadata).toMatchObject({ openaiWebSearchCalls: 1 });
  });

  it('reports nothing when the request did not carry the tool', async () => {
    const { provider } = setup({}, completedResponse(twoSearches));

    const message = await provider.chat(messages, {});

    for (const key of [
      'providerBuiltInToolsEnabled',
      'providerBuiltInToolsUsed',
      'openaiWebSearchCalls',
      'openaiWebSearchCitations',
    ]) {
      expect(message.metadata).not.toHaveProperty(key);
    }
  });

  it('reports a withheld tool as not carried', async () => {
    const { provider } = setup(searching(), completedResponse(twoSearches));

    const message = await provider.chat(messages, { toolChoice: 'none' });

    expect(message.metadata).not.toHaveProperty('providerBuiltInToolsEnabled');
  });

  it('reports zero searches without a used tool when the model did not search', async () => {
    const { provider } = setup(searching(), completedResponse());

    const message = await provider.chat(messages, {});

    expect(message.metadata).toMatchObject({
      providerBuiltInToolsEnabled: ['web_search'],
      openaiWebSearchCalls: 0,
    });
    expect(message.metadata).not.toHaveProperty('providerBuiltInToolsUsed');
    expect(message.metadata).not.toHaveProperty('openaiWebSearchCitations');
  });

  describe('streamed', () => {
    const search = (id: string): Record<string, unknown> => ({
      type: 'web_search_call',
      id,
      status: 'completed',
      action: { type: 'search', query: id },
    });
    const completed = { type: 'response.completed', response: completedResponse() };
    const itemEvents = [
      { type: 'response.output_item.done', item: search('ws1') },
      {
        type: 'response.output_item.done',
        item: { ...search('ws2'), action: { type: 'find_in_page' } },
      },
      { type: 'response.output_item.done', item: search('ws3') },
      { type: 'response.output_item.done', item: citedMessage(['https://a.test']) },
      { type: 'response.output_text.delta', delta: 'answer' },
    ];

    it('reports the searches of a stream that completes', async () => {
      const deltas: string[] = [];
      const { provider } = setup(searching(), eventsFrom([...itemEvents, completed]));

      const message = await provider.chat(messages, { onTextDelta: (delta) => deltas.push(delta) });

      expect(deltas).toEqual(['answer']);
      expect(message.metadata).toMatchObject({
        providerBuiltInToolsEnabled: ['web_search'],
        providerBuiltInToolsUsed: ['web_search'],
        openaiWebSearchCalls: 2,
        openaiWebSearchCitations: ['https://a.test'],
      });
    });

    it('takes the larger count and the union when the completed response reports more', async () => {
      const response = completedResponse([
        search('ws1'),
        search('ws2'),
        search('ws3'),
        search('ws4'),
        citedMessage(['https://b.test']),
      ]);
      const { provider } = setup(
        searching(),
        eventsFrom([...itemEvents, { type: 'response.completed', response }]),
      );

      const message = await provider.chat(messages, { onTextDelta: () => undefined });

      expect(message.metadata).toMatchObject({
        openaiWebSearchCalls: 4,
        openaiWebSearchCitations: ['https://a.test', 'https://b.test'],
      });
    });

    it('still reports when the stream ends without response.completed', async () => {
      const { provider } = setup(searching(), eventsFrom(itemEvents));

      const message = await provider.chat(messages, { onTextDelta: () => undefined });

      expect(message.content).toBe('answer');
      expect(message.metadata).toMatchObject({
        providerBuiltInToolsEnabled: ['web_search'],
        providerBuiltInToolsUsed: ['web_search'],
        openaiWebSearchCalls: 2,
        openaiWebSearchCitations: ['https://a.test'],
      });
    });

    it('reports nothing for a stream whose request did not carry the tool', async () => {
      const { provider } = setup({}, eventsFrom([...itemEvents, completed]));

      const message = await provider.chat(messages, { onTextDelta: () => undefined });

      expect(message.metadata).not.toHaveProperty('openaiWebSearchCalls');
      expect(message.metadata).not.toHaveProperty('providerBuiltInToolsEnabled');
    });

    it('reports through chatStream as well', async () => {
      const { provider } = setup(searching(), eventsFrom([...itemEvents, completed]));

      const chunks: TUniversalMessage[] = [];
      for await (const chunk of provider.chatStream(messages, {})) chunks.push(chunk);

      expect(chunks.at(-1)?.metadata).toMatchObject({ openaiWebSearchCalls: 2 });
    });
  });
});

describe('hosted web search capability', () => {
  const source = 'openai-responses';

  it('is supported and enabled on the vendor Responses API when the option is on', () => {
    const { provider } = setup(searching());

    expect(provider.getCapabilities().nativeWebTools).toEqual({
      webSearch: { supported: true, enabled: true, source },
      webFetch: {
        supported: false,
        enabled: false,
        source,
        reason: 'OpenAI provider exposes hosted web search only.',
      },
    });
  });

  it('is not enabled on a default model without web search, and says so', () => {
    const { provider } = setup(searching({ defaultModel: 'gpt-4.1-nano' }));
    const { webSearch } = provider.getCapabilities().nativeWebTools;

    expect(webSearch).toMatchObject({ supported: true, enabled: false, source });
    expect(webSearch.reason).toContain('gpt-4.1-nano');
  });

  it('fails a call that requires search where the model or its reasoning cannot run it', async () => {
    const { provider, create } = setup(searching());

    await expect(
      provider.chat(messages, { model: 'o3-mini', nativeWebTools: { webSearch: true } }),
    ).rejects.toThrow(/cannot run hosted web search on model o3-mini/);
    expect(create).not.toHaveBeenCalled();
  });

  it('is supported but not enabled, with the way to turn it on, when the option is off', () => {
    const { provider } = setup();

    expect(provider.getCapabilities().nativeWebTools.webSearch).toEqual({
      supported: true,
      enabled: false,
      source,
      reason: 'Set the provider profile option nativeWebTools.webSearch to true.',
    });
  });

  it('is unsupported on Chat Completions', () => {
    const { provider } = setup({ apiSurface: 'chat-completions' });

    expect(provider.getCapabilities().nativeWebTools).toEqual({
      webSearch: {
        supported: false,
        enabled: false,
        source: 'openai-compatible-chat-completions',
        reason:
          'OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web search.',
      },
      webFetch: {
        supported: false,
        enabled: false,
        source: 'openai-compatible-chat-completions',
        reason:
          'OpenAI-compatible Chat Completions endpoints support declared function tools, not provider-native web fetch.',
      },
    });
  });

  it('is unsupported on the Responses API behind a custom baseURL', () => {
    const { provider } = setup({
      apiSurface: 'responses',
      baseURL: 'https://gateway.example.com/v1',
    });

    expect(provider.getCapabilities().nativeWebTools.webSearch).toEqual({
      supported: false,
      enabled: false,
      source,
      reason: "Hosted web search runs only on OpenAI's own endpoint, not a custom baseURL.",
    });
    expect(provider.getCapabilities().nativeWebTools.webFetch.reason).toBe(
      'OpenAI provider exposes hosted web search only.',
    );
  });

  it('lets a call require search only once the profile turned it on', async () => {
    const { provider } = setup();

    await expect(provider.chat(messages, { nativeWebTools: { webSearch: true } })).rejects.toThrow(
      'Provider openai supports native web search but it is not enabled. Set the provider profile option nativeWebTools.webSearch to true.',
    );
    await expect(
      setup(searching()).provider.chat(messages, { nativeWebTools: { webSearch: true } }),
    ).resolves.toBeDefined();
  });
});

describe('hosted web search construction', () => {
  it('rejects web search on Chat Completions', () => {
    expect(() => setup({ apiSurface: 'chat-completions', ...searching() })).toThrow(
      "Provider openai hosted web search runs only on OpenAI's own Responses API, not on apiSurface chat-completions.",
    );
  });

  it('rejects web search behind a custom baseURL', () => {
    expect(() => setup({ baseURL: 'https://gateway.example.com/v1', ...searching() })).toThrow(
      'not on apiSurface chat-completions with a custom baseURL.',
    );
    expect(() =>
      setup({ apiSurface: 'responses', baseURL: 'https://gateway.example.com/v1', ...searching() }),
    ).toThrow('not on apiSurface responses with a custom baseURL.');
  });

  it('rejects web fetch', () => {
    expect(() => setup({ nativeWebTools: { webFetch: true } })).toThrow(
      'Provider openai does not support native web fetch.',
    );
  });

  it('accepts an explicit false for either tool on any surface', () => {
    expect(() =>
      setup({
        apiSurface: 'chat-completions',
        nativeWebTools: { webSearch: false, webFetch: false },
      }),
    ).not.toThrow();
  });
});

describe('hosted web search in the provider definition', () => {
  const definition = createOpenAIProviderDefinition();
  const profile = { name: 'openai', model: 'gpt-4o', apiKey: 'sk-test' };

  it('declares web search for a profile on the vendor Responses API', () => {
    expect(definition.nativeWebTools?.({})).toEqual(['webSearch']);
    expect(definition.nativeWebTools?.({ options: { apiSurface: 'responses' } })).toEqual([
      'webSearch',
    ]);
  });

  it('declares nothing for a custom baseURL or Chat Completions', () => {
    expect(definition.nativeWebTools?.({ baseURL: 'http://localhost:1234/v1' })).toEqual([]);
    expect(definition.nativeWebTools?.({ options: { apiSurface: 'chat-completions' } })).toEqual(
      [],
    );
  });

  it('declares nothing while OPENAI_BASE_URL redirects the SDK, and ignores an empty one', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://gateway.example.com/v1');
    expect(definition.nativeWebTools?.({})).toEqual([]);

    vi.stubEnv('OPENAI_BASE_URL', '');
    expect(definition.nativeWebTools?.({})).toEqual(['webSearch']);
  });

  it('builds a provider with search on from the profile option', () => {
    const provider = definition.createProvider({
      ...profile,
      options: { nativeWebTools: { webSearch: true } },
    });

    expect(provider.getCapabilities?.().nativeWebTools.webSearch).toMatchObject({
      supported: true,
      enabled: true,
    });
  });

  it('builds a provider with search off by default', () => {
    expect(
      definition.createProvider(profile).getCapabilities?.().nativeWebTools.webSearch,
    ).toMatchObject({
      supported: true,
      enabled: false,
    });
  });

  it('does not read the old builtInWebTools spelling', () => {
    const provider = definition.createProvider({
      ...profile,
      options: { builtInWebTools: { webSearch: true } },
    });

    expect(provider.getCapabilities?.().nativeWebTools.webSearch.enabled).toBe(false);
  });

  it.each([
    ['a non-object', 'yes'],
    ['an array', [true]],
    ['an unknown key', { websearch: true }],
    ['a non-boolean flag', { webSearch: 'true' }],
    ['web fetch', { webFetch: true }],
  ])('rejects %s', (_label, nativeWebTools) => {
    expect(() => definition.createProvider({ ...profile, options: { nativeWebTools } })).toThrow(
      /Provider openai/,
    );
  });

  it('rejects an explicit request on a baseURL profile or Chat Completions', () => {
    const message =
      "Provider openai profile uses an OpenAI-compatible endpoint or Chat Completions; hosted web search runs only on OpenAI's own Responses API. Connect an MCP server that offers web search.";

    expect(() =>
      definition.createProvider({
        ...profile,
        baseURL: 'http://localhost:1234/v1',
        options: { nativeWebTools: { webSearch: true } },
      }),
    ).toThrow(message);
    expect(() =>
      definition.createProvider({
        ...profile,
        options: { apiSurface: 'chat-completions', nativeWebTools: { webSearch: true } },
      }),
    ).toThrow(message);
  });
});
