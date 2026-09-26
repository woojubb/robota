/**
 * MCP-005 (TC-08) — conformance: the real `OpenAIProvider` over the shared MCP-005 fixture set.
 *
 * With `strictTools` off both the Responses and Chat Completions surfaces carry the permissive
 * projection; with it on both carry the strict projection (§ Profiles — both surfaces honor
 * `strictTools` identically). Adopted/adapted fixtures reach the request in projected form (compared
 * against `projectToolSchema` directly, not hand-computed); rejected fixtures are absent; one
 * `tool_schema_quarantined` warn per absent fixture names it. Both `chat` and `chatStream` request
 * paths of each converter are exercised.
 */
import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  setGlobalLoggerSink,
  STRICT_TOOL_SCHEMA_PROFILE,
} from '@robota-sdk/agent-core';
import { loadToolSchemaProjectionFixtures } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';

import type { IToolSchema, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    responses: { create: vi.fn() },
  }));
  return { default: MockOpenAI };
});

const fixtures = loadToolSchemaProjectionFixtures();
const PERMISSIVE_PROFILE = { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'openai' };
const STRICT_PROFILE = { ...STRICT_TOOL_SCHEMA_PROFILE, providerName: 'openai' };

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

interface IFakeClient {
  responses: { create: ReturnType<typeof vi.fn> };
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
}

function fakeClient(provider: OpenAIProvider): IFakeClient {
  return (provider as unknown as { client: IFakeClient }).client;
}

function respondResponses(client: IFakeClient): void {
  client.responses.create.mockResolvedValue({
    id: 'resp-tool-schema-projection',
    model: 'gpt-4o',
    output_text: '',
    output: [],
    status: 'completed',
  });
}

function respondChatCompletions(client: IFakeClient): void {
  client.chat.completions.create.mockResolvedValue({
    id: 'chatcmpl-tool-schema-projection',
    object: 'chat.completion',
    created: Date.now(),
    model: 'gpt-4',
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

async function* streamResponsesResult() {
  yield {
    type: 'response.completed',
    response: { id: 'resp-stream', output_text: '', output: [], status: 'completed' },
  };
}

async function* streamChatCompletionsResult() {
  yield {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: Date.now(),
    model: 'gpt-4',
    choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop', logprobs: null }],
  };
}

interface ISentTool {
  name: string;
  description: string;
  parameters: unknown;
  /** Whether the tool was declared strict on the wire (absent counts as not strict). */
  strict: boolean;
}

function sentToolsFromResponses(client: IFakeClient): ISentTool[] {
  const [requestParams] = client.responses.create.mock.calls[
    client.responses.create.mock.calls.length - 1
  ] as [
    {
      tools?: Array<{ name: string; description: string; parameters: unknown; strict?: boolean }>;
    },
  ];
  return (requestParams.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict === true,
  }));
}

function sentToolsFromChatCompletions(client: IFakeClient): ISentTool[] {
  const [requestParams] = client.chat.completions.create.mock.calls[
    client.chat.completions.create.mock.calls.length - 1
  ] as [
    {
      tools?: Array<{
        function: { name: string; description: string; parameters: unknown; strict?: boolean };
      }>;
    },
  ];
  return (requestParams.tools ?? []).map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
    strict: tool.function.strict === true,
  }));
}

describe.each([
  {
    apiSurface: 'responses' as const,
    respond: respondResponses,
    sentTools: sentToolsFromResponses,
  },
  {
    apiSurface: 'chat-completions' as const,
    respond: respondChatCompletions,
    sentTools: sentToolsFromChatCompletions,
  },
])(
  'MCP-005 TC-08 — OpenAI $apiSurface, permissive profile (strictTools off)',
  ({ apiSurface, respond, sentTools }) => {
    afterEach(() => {
      setGlobalLoggerSink(undefined);
    });

    it('reaches the request in projected form for adopted/adapted fixtures', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface });
      const client = fakeClient(provider);
      respond(client);

      const tools: IToolSchema[] = [
        fixtures.subsetOnly,
        fixtures.unknownKeywords,
        fixtures.arrayItemsObject,
      ];
      await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools });

      const sent = sentTools(client);
      expect(sent).toHaveLength(3);
      expect(sent.every((tool) => !tool.strict)).toBe(true);
      for (const [index, tool] of tools.entries()) {
        const projection = projectToolSchema(tool, PERMISSIVE_PROFILE);
        expect(sent[index]?.parameters).toEqual(projection.tool.parameters);
        expect(sent[index]?.description).toEqual(projection.tool.description);
      }
    });

    it('omits a rejected fixture and reports one quarantine warn (chat)', async () => {
      const recorder = recordingSink();
      setGlobalLoggerSink(recorder.sink);
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface });
      const client = fakeClient(provider);
      respond(client);

      const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
      await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools });

      const sent = sentTools(client);
      expect(sent.map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);

      const quarantineLines = recorder.lines.filter((line) =>
        line.includes('tool_schema_quarantined'),
      );
      expect(quarantineLines).toHaveLength(1);
      expect(quarantineLines[0]).toContain('provider=openai');
      expect(quarantineLines[0]).toContain('tool=bad_tool');
    });

    it('every documented rejection kind is absent from the request', async () => {
      const recorder = recordingSink();
      setGlobalLoggerSink(recorder.sink);
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface });
      const client = fakeClient(provider);
      respond(client);

      const rejected: IToolSchema[] = [
        fixtures.rootAnyOf,
        fixtures.prototypeKey,
        fixtures.deepNesting,
        fixtures.oversized,
      ];
      await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools: rejected });

      expect(sentTools(client)).toHaveLength(0);
      const quarantineLines = recorder.lines.filter((line) =>
        line.includes('tool_schema_quarantined'),
      );
      expect(quarantineLines).toHaveLength(rejected.length);
    });

    it('projects tools on the chatStream request path too', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface });
      const client = fakeClient(provider);
      if (apiSurface === 'responses') {
        client.responses.create.mockResolvedValue(streamResponsesResult());
      } else {
        client.chat.completions.create.mockResolvedValue(streamChatCompletionsResult());
      }

      const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
      for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
        model: 'gpt-4o',
        tools,
      })) {
        // drain
      }

      const sent = sentTools(client);
      expect(sent.map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
      expect(sent.every((tool) => !tool.strict)).toBe(true);
    });
  },
);

describe.each([
  {
    apiSurface: 'responses' as const,
    respond: respondResponses,
    sentTools: sentToolsFromResponses,
  },
  {
    apiSurface: 'chat-completions' as const,
    respond: respondChatCompletions,
    sentTools: sentToolsFromChatCompletions,
  },
])(
  'MCP-005 TC-08 — OpenAI $apiSurface, strict profile (strictTools on)',
  ({ apiSurface, respond, sentTools }) => {
    it('reaches the request in strictly-projected form', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface, strictTools: true });
      const client = fakeClient(provider);
      respond(client);

      const tools: IToolSchema[] = [fixtures.subsetOnly, fixtures.nestedAnyOfOptional];
      await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools });

      const sent = sentTools(client);
      expect(sent).toHaveLength(2);
      for (const [index, tool] of tools.entries()) {
        const projection = projectToolSchema(tool, STRICT_PROFILE);
        expect(sent[index]?.parameters).toEqual(projection.tool.parameters);
        expect(sent[index]?.description).toEqual(projection.tool.description);
        expect(sent[index]?.strict).toBe(true);
      }
    });

    it('projects strictly on the chatStream request path too', async () => {
      const provider = new OpenAIProvider({ apiKey: 'sk-test', apiSurface, strictTools: true });
      const client = fakeClient(provider);
      if (apiSurface === 'responses') {
        client.responses.create.mockResolvedValue(streamResponsesResult());
      } else {
        client.chat.completions.create.mockResolvedValue(streamChatCompletionsResult());
      }

      const tools: IToolSchema[] = [fixtures.subsetOnly];
      for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
        model: 'gpt-4o',
        tools,
      })) {
        // drain
      }

      const sent = sentTools(client);
      const projection = projectToolSchema(fixtures.subsetOnly, STRICT_PROFILE);
      expect(sent[0]?.parameters).toEqual(projection.tool.parameters);
      expect(sent[0]?.strict).toBe(true);
    });
  },
);
