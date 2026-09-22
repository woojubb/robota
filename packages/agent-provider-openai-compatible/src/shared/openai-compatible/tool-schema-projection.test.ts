/**
 * MCP-005 (TC-09) — conformance: the real `GemmaProvider` / `QwenProvider` / `DeepSeekProvider` over
 * the shared MCP-005 fixture set. Each declares the permissive profile with its OWN `providerName`;
 * the shared request builder AND the Qwen Responses converter receive projected schemas (rejected
 * fixtures absent, one quarantine `warn` each); both the `chat` and `chatStream` request paths are
 * exercised.
 */
import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  setGlobalLoggerSink,
} from '@robota-sdk/agent-core';
import { loadToolSchemaProjectionFixtures } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeepSeekProvider } from '../../deepseek';
import { GemmaProvider } from '../../gemma';
import { QwenProvider } from '../../qwen';

import type { IToolSchema, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    responses: { create: vi.fn() },
  }));
  return { default: MockOpenAI };
});

const fixtures = loadToolSchemaProjectionFixtures();

function recordingSink(): { sink: ILogger; lines: string[] } {
  const lines: string[] = [];
  const record =
    (level: string) =>
    (...args: unknown[]): void => {
      lines.push(`${level} ${args.map((value) => String(value)).join(' ')}`);
    };
  return {
    lines,
    sink: {
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
      log: record('log'),
    },
  };
}

function createUserMessage(content: string): TUniversalMessage {
  return { id: 'msg-1', state: 'complete' as const, role: 'user', content, timestamp: new Date() };
}

interface IChatCompletionsClient {
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
}

function respondChatCompletions(client: IChatCompletionsClient): void {
  client.chat.completions.create.mockResolvedValue({
    id: 'chatcmpl-tool-schema-projection',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: '', refusal: null },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
  });
}

async function* streamChatCompletionsResult() {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'test-model',
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop', logprobs: null }],
  };
}

interface ISentTool {
  name: string;
  description: string;
  parameters: unknown;
}

function sentToolsFromChatCompletions(client: IChatCompletionsClient): ISentTool[] {
  const [requestParams] = client.chat.completions.create.mock.calls[
    client.chat.completions.create.mock.calls.length - 1
  ] as [
    { tools?: Array<{ function: { name: string; description: string; parameters: unknown } }> },
  ];
  return (requestParams.tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

describe.each([
  {
    label: 'gemma',
    providerName: 'gemma',
    createProvider: () => new GemmaProvider({ apiKey: 'test-key' }),
  },
  {
    label: 'qwen (chat-completions surface)',
    providerName: 'qwen',
    createProvider: () => new QwenProvider({ apiKey: 'test-key' }),
  },
  {
    label: 'deepseek',
    providerName: 'deepseek',
    createProvider: () => new DeepSeekProvider({ apiKey: 'test-key' }),
  },
])('MCP-005 TC-09 — $label, permissive profile', ({ providerName, createProvider }) => {
  const PROFILE = { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName };

  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  function getClient(provider: unknown): IChatCompletionsClient {
    return (provider as unknown as { client: IChatCompletionsClient }).client;
  }

  it('reaches the request in projected form for adopted/adapted fixtures (chat)', async () => {
    const provider = createProvider();
    const client = getClient(provider);
    respondChatCompletions(client);

    const tools: IToolSchema[] = [
      fixtures.subsetOnly,
      fixtures.unknownKeywords,
      fixtures.arrayItemsObject,
    ];
    await provider.chat([createUserMessage('hello')], { model: 'test-model', tools });

    const sent = sentToolsFromChatCompletions(client);
    expect(sent).toHaveLength(3);
    for (const [index, tool] of tools.entries()) {
      const projection = projectToolSchema(tool, PROFILE);
      expect(sent[index]?.parameters).toEqual(projection.tool.parameters);
      expect(sent[index]?.description).toEqual(projection.tool.description);
    }
  });

  it('omits a rejected fixture and reports one quarantine warn (chat)', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    const provider = createProvider();
    const client = getClient(provider);
    respondChatCompletions(client);

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    await provider.chat([createUserMessage('hello')], { model: 'test-model', tools });

    expect(sentToolsFromChatCompletions(client).map((tool) => tool.name)).toEqual([
      'good_tool_one',
      'good_tool_two',
    ]);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
    expect(quarantineLines[0]).toContain(`provider=${providerName}`);
    expect(quarantineLines[0]).toContain('tool=bad_tool');
  });

  it('every documented rejection kind is absent from the request', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    const provider = createProvider();
    const client = getClient(provider);
    respondChatCompletions(client);

    const rejected: IToolSchema[] = [
      fixtures.rootAnyOf,
      fixtures.prototypeKey,
      fixtures.deepNesting,
      fixtures.oversized,
    ];
    await provider.chat([createUserMessage('hello')], { model: 'test-model', tools: rejected });

    expect(sentToolsFromChatCompletions(client)).toHaveLength(0);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(rejected.length);
  });

  it('projects tools on the chatStream request path too', async () => {
    const provider = createProvider();
    const client = getClient(provider);
    client.chat.completions.create.mockResolvedValue(streamChatCompletionsResult());

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'test-model',
      tools,
    })) {
      // drain
    }

    expect(sentToolsFromChatCompletions(client).map((tool) => tool.name)).toEqual([
      'good_tool_one',
      'good_tool_two',
    ]);
  });
});

describe('MCP-005 TC-09 — qwen Responses surface (built-in web tools on)', () => {
  const PROFILE = { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'qwen' };

  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  function getResponsesClient(provider: QwenProvider): {
    responses: { create: ReturnType<typeof vi.fn> };
  } {
    return (
      provider as unknown as {
        responsesClient: { responses: { create: ReturnType<typeof vi.fn> } };
      }
    ).responsesClient;
  }

  function respondResponses(client: { responses: { create: ReturnType<typeof vi.fn> } }): void {
    client.responses.create.mockResolvedValue({
      id: 'resp-tool-schema-projection',
      model: 'qwen-test',
      output_text: '',
      status: 'completed',
      output: [],
    });
  }

  function sentTools(client: {
    responses: { create: ReturnType<typeof vi.fn> };
  }): Array<{ name: string; description: string; parameters: unknown }> {
    const [requestParams] = client.responses.create.mock.calls[
      client.responses.create.mock.calls.length - 1
    ] as [
      {
        tools?: Array<{ type: string; name?: string; description?: string; parameters?: unknown }>;
      },
    ];
    return (requestParams.tools ?? [])
      .filter(
        (tool): tool is { type: string; name: string; description: string; parameters: unknown } =>
          tool.type === 'function',
      )
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  }

  it('chat(): the Qwen Responses converter receives projected schemas', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true },
    });
    const client = getResponsesClient(provider);
    respondResponses(client);

    const tools: IToolSchema[] = [fixtures.subsetOnly, fixtures.unknownKeywords];
    await provider.chat([createUserMessage('hello')], { model: 'qwen-test', tools });

    const sent = sentTools(client);
    expect(sent).toHaveLength(2);
    for (const [index, tool] of tools.entries()) {
      const projection = projectToolSchema(tool, PROFILE);
      expect(sent[index]?.parameters).toEqual(projection.tool.parameters);
    }
  });

  it('chat(): a rejected fixture is absent and reports one quarantine warn', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true },
    });
    const client = getResponsesClient(provider);
    respondResponses(client);

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    await provider.chat([createUserMessage('hello')], { model: 'qwen-test', tools });

    expect(sentTools(client).map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
    expect(quarantineLines[0]).toContain('provider=qwen');
  });

  it('chatStream(): the Qwen Responses converter receives projected schemas', async () => {
    const provider = new QwenProvider({
      apiKey: 'dashscope-key',
      builtInWebTools: { webSearch: true },
    });
    const client = getResponsesClient(provider);
    async function* streamResult() {
      yield {
        type: 'response.completed',
        response: { id: 'r1', output_text: '', output: [], status: 'completed' },
      };
    }
    client.responses.create.mockResolvedValue(streamResult());

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'qwen-test',
      tools,
    })) {
      // drain
    }

    expect(sentTools(client).map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
  });
});
