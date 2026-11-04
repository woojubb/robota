/**
 * Google Search on the wire: captured at the fetch the Gemini SDK itself calls, so the SDK's own
 * request and response conversion is part of what is checked.
 */
import { AbstractTool, ConversationAgent } from '@robota-sdk/agent-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../provider';
import { createGeminiProviderDefinition } from '../provider-definition';

import type {
  IAssistantMessage,
  IChatOptions,
  IToolResult,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const GEMINI_3 = 'gemini-3-flash-preview';
const GEMINI_2 = 'gemini-2.5-flash';
const SIGNATURE = 'c2lnbmVkLXJlYXNvbmluZw==';

const tool: IToolSchema = {
  name: 'read_file',
  description: 'Read a file',
  parameters: { type: 'object', properties: { path: { type: 'string' } } },
};

const message: TUniversalMessage = {
  id: 'm1',
  role: 'user',
  content: 'What changed in Node 24?',
  state: 'complete',
  timestamp: new Date(),
};

interface IWireBody {
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
  tools?: Array<Record<string, unknown>>;
  toolConfig?: {
    includeServerSideToolInvocations?: boolean;
    functionCallingConfig?: { mode?: string };
  };
}

const usageMetadata = { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 };

function reply(parts: object[], grounding?: object): object {
  return {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: 'STOP',
        ...(grounding !== undefined && { groundingMetadata: grounding }),
      },
    ],
    usageMetadata,
    responseId: 'resp',
  };
}

let bodies: IWireBody[] = [];
let replies: object[][] = [];

beforeEach(() => {
  bodies = [];
  replies = [];
  vi.stubEnv('GOOGLE_GEMINI_BASE_URL', undefined);
  vi.stubEnv('GOOGLE_VERTEX_BASE_URL', undefined);
  vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', undefined);
  vi.stubEnv('GOOGLE_GENAI_USE_ENTERPRISE', undefined);
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit): Promise<Response> => {
    bodies.push(JSON.parse(String(init?.body)) as IWireBody);
    const chunks = replies.shift() ?? [reply([{ text: 'ok' }])];
    if (String(url).includes('streamGenerateContent')) {
      const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('');
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(chunks[0]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function provider(defaultModel = GEMINI_3, enableWebTools = true): GeminiProvider {
  return new GeminiProvider({ apiKey: 'test-key', defaultModel, enableWebTools });
}

async function sent(chatOptions: IChatOptions, target = provider()): Promise<IWireBody> {
  await target.chat([message], chatOptions);
  return bodies.at(-1) as IWireBody;
}

const FUNCTION_DECLARATIONS = expect.objectContaining({
  functionDeclarations: [expect.objectContaining({ name: 'read_file' })],
});

describe('Google Search on the request', () => {
  it('stays off by default', async () => {
    const body = await sent({ tools: [tool] }, provider(GEMINI_3, false));

    expect(body.tools).toEqual([FUNCTION_DECLARATIONS]);
    expect(body.toolConfig).toBeUndefined();
    expect((await sent({}, provider(GEMINI_3, false))).tools).toBeUndefined();
  });

  it('goes alone when the request has no function tools', async () => {
    const body = await sent({});

    expect(body.tools).toEqual([{ googleSearch: {} }]);
    expect(body.toolConfig).toBeUndefined();
  });

  it.each([undefined, 'auto'] as const)(
    'joins function tools on Gemini 3 with the flag and VALIDATED mode for toolChoice %s',
    async (toolChoice) => {
      const body = await sent({ tools: [tool], ...(toolChoice && { toolChoice }) });

      expect(body.tools).toEqual([{ googleSearch: {} }, FUNCTION_DECLARATIONS]);
      expect(body.toolConfig).toEqual({
        includeServerSideToolInvocations: true,
        functionCallingConfig: { mode: 'VALIDATED' },
      });
    },
  );

  it('keeps the rest of a static tool config when it joins function tools', async () => {
    const target = new GeminiProvider({
      apiKey: 'test-key',
      defaultModel: GEMINI_3,
      enableWebTools: true,
      toolConfig: { retrievalConfig: { languageCode: 'en' } },
    });

    expect((await sent({ tools: [tool] }, target)).toolConfig).toEqual({
      retrievalConfig: { languageCode: 'en' },
      includeServerSideToolInvocations: true,
      functionCallingConfig: { mode: 'VALIDATED' },
    });
  });

  it('joins function tools on Gemini 4 and on a models/ name', async () => {
    expect((await sent({ tools: [tool] }, provider('gemini-4-argon'))).tools).toHaveLength(2);
    expect((await sent({ tools: [tool] }, provider('models/gemini-3.8-flash'))).tools).toHaveLength(
      2,
    );
  });

  it('leaves function tools alone on Gemini 2, and goes alone without them', async () => {
    const withTools = await sent({ tools: [tool] }, provider(GEMINI_2));
    expect(withTools.tools).toEqual([FUNCTION_DECLARATIONS]);
    expect(withTools.toolConfig).toBeUndefined();

    expect((await sent({}, provider(GEMINI_2))).tools).toEqual([{ googleSearch: {} }]);
  });

  it.each(['gemini-1.5-pro', 'gemini-flash-latest', 'learnlm-2.0'])(
    'does not assume model %s can search',
    async (model) => {
      expect((await sent({}, provider(model))).tools).toBeUndefined();
    },
  );

  it.each([
    ['none', 'NONE'],
    ['required', 'ANY'],
    [{ tool: 'read_file' }, 'ANY'],
  ] as const)('withholds it for toolChoice %j', async (toolChoice, mode) => {
    const body = await sent({ tools: [tool], toolChoice });

    expect(body.tools).toEqual([FUNCTION_DECLARATIONS]);
    expect(body.toolConfig?.includeServerSideToolInvocations).toBeUndefined();
    expect(body.toolConfig?.functionCallingConfig?.mode).toBe(mode);
  });

  it('withholds it when the call says so', async () => {
    const body = await sent({ nativeWebTools: { webSearch: false, webFetch: false } });

    expect(body.tools).toBeUndefined();
  });

  it('withholds it from a JSON reply and from an image reply', async () => {
    expect((await sent({ responseFormat: { type: 'json_object' } })).tools).toBeUndefined();

    const images = new GeminiProvider({
      apiKey: 'test-key',
      defaultModel: GEMINI_3,
      enableWebTools: true,
      imageCapableModels: [GEMINI_3],
    });
    replies.push([reply([{ inlineData: { mimeType: 'image/png', data: 'aW1n' } }])]);
    const result = await images.generateImage({ prompt: 'a cat', model: GEMINI_3 });
    expect(result.ok).toBe(true);
    expect(bodies.at(-1)?.tools).toBeUndefined();
  });

  it('fails a call that requires search where the model cannot run it', async () => {
    await expect(
      provider(GEMINI_2).chat([message], {
        tools: [tool],
        nativeWebTools: { webSearch: true },
      }),
    ).rejects.toThrow(/cannot run Google Search on model gemini-2\.5-flash next to function tools/);
    expect(bodies).toHaveLength(0);
  });

  it('leaves function tools alone in Vertex mode, where the SDK refuses the flag', async () => {
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
    const vertex = provider();

    await vertex.chat([message], { tools: [tool] });

    expect(bodies.at(-1)?.tools).toEqual([FUNCTION_DECLARATIONS]);
    expect(vertex.getCapabilities().nativeWebTools.webSearch.reason).toContain('function tools');
  });
});

const GROUNDING = {
  webSearchQueries: ['node 24 release', 'node 24 changes'],
  groundingChunks: [
    { web: { uri: 'https://a.example', title: 'a' } },
    { web: { uri: 'https://b.example', title: 'b' } },
    { web: { uri: 'https://a.example', title: 'a again' } },
  ],
  searchEntryPoint: { renderedContent: '<div>suggestions</div>' },
};

describe('search accounting on the result', () => {
  it('reports queries, citations and suggestions from a whole reply', async () => {
    replies.push([reply([{ text: 'Node 24 ships V8 13.' }], GROUNDING)]);

    const result = await provider().chat([message]);

    expect(result.metadata).toMatchObject({
      providerBuiltInToolsEnabled: ['google_search'],
      providerBuiltInToolsUsed: ['google_search'],
      geminiWebSearchCalls: 2,
      geminiWebSearchQueries: ['node 24 release', 'node 24 changes'],
      geminiWebSearchCitations: ['https://a.example', 'https://b.example'],
      geminiSearchSuggestionsHtml: '<div>suggestions</div>',
      promptTokens: 1,
    });
  });

  it('reports them from a stream whose grounding arrives on a chunk with no parts', async () => {
    replies.push([
      reply([{ text: 'Node 24 ' }]),
      reply([{ text: 'ships V8 13.' }]),
      { candidates: [{ groundingMetadata: GROUNDING, finishReason: 'STOP' }], usageMetadata },
    ]);
    const deltas: string[] = [];

    const result = await provider().chat([message], {
      onTextDelta: (delta) => {
        deltas.push(delta);
      },
    });

    expect(deltas.join('')).toBe('Node 24 ships V8 13.');
    expect(result.content).toBe('Node 24 ships V8 13.');
    expect(result.metadata).toMatchObject({
      geminiWebSearchCalls: 2,
      geminiWebSearchCitations: ['https://a.example', 'https://b.example'],
      totalTokens: 2,
    });
  });

  it('counts the search tool steps a response carries instead of grounding', async () => {
    replies.push([
      reply([
        { toolCall: { id: 't1', toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['q1', 'q2'] } } },
        { text: 'done' },
      ]),
    ]);

    const result = await provider().chat([message], { tools: [tool] });

    expect(result.metadata?.['geminiWebSearchCalls']).toBe(2);
  });

  it('says it searched nothing when the model chose not to', async () => {
    const result = await provider().chat([message]);

    expect(result.metadata?.['providerBuiltInToolsEnabled']).toEqual(['google_search']);
    expect(result.metadata?.['geminiWebSearchCalls']).toBe(0);
    expect(result.metadata?.['providerBuiltInToolsUsed']).toBeUndefined();
  });

  it('adds no search keys when the request did not carry search', async () => {
    const result = await provider(GEMINI_3, false).chat([message]);

    expect(result.metadata?.['providerBuiltInToolsEnabled']).toBeUndefined();
    expect(result.metadata?.['geminiWebSearchCalls']).toBeUndefined();
  });
});

const SERVER_TOOL_CALL = {
  toolCall: { id: 'srv-1', toolType: 'GOOGLE_SEARCH_WEB', args: { queries: ['node 24'] } },
  thoughtSignature: SIGNATURE,
};
const SERVER_TOOL_RESPONSE = {
  toolResponse: { id: 'srv-1', toolType: 'GOOGLE_SEARCH_WEB', response: { searchSuggestions: 'x' } },
  thoughtSignature: SIGNATURE,
};

class ReadFileTool extends AbstractTool {
  readonly schema = tool;

  protected async executeImpl(): Promise<IToolResult> {
    return { success: true, data: 'file text' };
  }
}

function agentOn(target: GeminiProvider): ConversationAgent {
  return new ConversationAgent({
    name: 'wire',
    aiProviders: [target],
    defaultModel: { provider: target.name, model: GEMINI_3 },
    tools: [new ReadFileTool()],
  });
}

describe('sending the model its own parts back', () => {
  it('returns signatures and server-side tool steps on the next request of a tool round', async () => {
    replies.push(
      [
        reply([SERVER_TOOL_CALL, SERVER_TOOL_RESPONSE, { text: 'Reading the file.' }]),
        reply([
          {
            functionCall: { name: 'read_file', args: { path: 'a.ts' } },
            thoughtSignature: SIGNATURE,
          },
        ]),
      ],
      [reply([{ text: 'Done.' }])],
    );

    await agentOn(provider()).run('What changed?');

    expect(bodies).toHaveLength(2);
    const second = bodies[1] as IWireBody;
    const model = second.contents.find((content) => content.role === 'model');
    expect(model?.parts.slice(0, 3)).toEqual([
      SERVER_TOOL_CALL,
      SERVER_TOOL_RESPONSE,
      { text: 'Reading the file.' },
    ]);
    const call = model?.parts[3] as {
      functionCall: { id: string; name: string; args: object };
      thoughtSignature: string;
    };
    expect(call.thoughtSignature).toBe(SIGNATURE);
    expect(call.functionCall).toMatchObject({ name: 'read_file', args: { path: 'a.ts' } });

    const response = second.contents.at(-1)?.parts[0] as { functionResponse: { id: string } };
    expect(response.functionResponse.id).toBe(call.functionCall.id);
  });

  it('keeps nothing extra for a plain reply', async () => {
    replies.push([reply([{ text: 'Hello.', thoughtSignature: SIGNATURE }])]);

    const result = await provider().chat([message]);

    expect(result.metadata?.['providerContinuation']).toBeUndefined();
  });

  it('keeps nothing extra for an unsigned function call, and rebuilds it', async () => {
    replies.push([
      reply([{ functionCall: { id: 'c1', name: 'read_file', args: { path: 'a.ts' } } }]),
    ]);

    const result = await provider(GEMINI_2).chat([message], { tools: [tool] });

    expect(result.metadata?.['providerContinuation']).toBeUndefined();
  });

  it.each([
    ['text', { content: 'edited' }],
    ['tool calls', { toolCalls: [] }],
    ['encoding', { metadata: { providerContinuation: 'not json' } }],
    ['owner', { metadata: { providerContinuation: '{"anthropicBlocks":[]}' } }],
  ])('rebuilds the parts when the %s no longer matches', async (_label, change) => {
    replies.push([
      reply([
        { text: 'Reading.' },
        { functionCall: { id: 'c1', name: 'read_file', args: {} }, thoughtSignature: SIGNATURE },
      ]),
    ]);
    const target = provider();
    const first = (await target.chat([message], { tools: [tool] })) as IAssistantMessage;

    await target.chat([message, { ...first, ...change } as TUniversalMessage, message]);

    const model = bodies.at(-1)?.contents.find((content) => content.role === 'model');
    expect(JSON.stringify(model?.parts)).not.toContain(SIGNATURE);
  });
});

describe('capabilities', () => {
  it('reports search supported and off by default, and web fetch unsupported', () => {
    const { webSearch, webFetch } = provider(GEMINI_3, false).getCapabilities().nativeWebTools;

    expect(webSearch).toMatchObject({ supported: true, enabled: false });
    expect(webSearch.reason).toContain('nativeWebTools.webSearch');
    expect(webFetch).toMatchObject({ supported: false, enabled: false });
  });

  it('reports search on without a caveat on Gemini 3', () => {
    expect(provider().getCapabilities().nativeWebTools.webSearch).toEqual({
      supported: true,
      enabled: true,
      source: 'gemini-generate-content',
    });
  });

  it('says on Gemini 2 that function tools go without it', () => {
    const { webSearch } = provider(GEMINI_2).getCapabilities().nativeWebTools;

    expect(webSearch).toMatchObject({ supported: true, enabled: true });
    expect(webSearch.reason).toContain('function tools');
  });

  it('reports it off for a model it does not assume can search', () => {
    const { webSearch } = provider('gemini-flash-latest').getCapabilities().nativeWebTools;

    expect(webSearch).toMatchObject({ supported: true, enabled: false });
    expect(webSearch.reason).toContain('gemini-flash-latest');
  });
});

describe('profile option nativeWebTools', () => {
  const profile = (options?: Record<string, never> | object) => ({
    name: 'gemini',
    model: GEMINI_3,
    apiKey: 'test-key',
    ...(options !== undefined && { options: options as Record<string, never> }),
  });

  it('declares web search and enables it only when the profile asks', () => {
    const definition = createGeminiProviderDefinition();

    expect(definition.nativeWebTools?.({})).toEqual(['webSearch']);
    expect(
      definition.createProvider(profile()).getCapabilities?.().nativeWebTools.webSearch.enabled,
    ).toBe(false);
    expect(
      definition.createProvider(profile({ nativeWebTools: { webSearch: true } })).getCapabilities?.()
        .nativeWebTools.webSearch.enabled,
    ).toBe(true);
  });

  it.each([
    [{ nativeWebTools: true }, 'must be an object'],
    [{ nativeWebTools: { websearch: true } }, 'unknown key'],
    [{ nativeWebTools: { webSearch: 'yes' } }, 'must be a boolean'],
    [{ nativeWebTools: { webFetch: true } }, 'does not support native web fetch'],
  ])('refuses %j', (options, text) => {
    expect(() => createGeminiProviderDefinition().createProvider(profile(options))).toThrow(text);
  });
});
