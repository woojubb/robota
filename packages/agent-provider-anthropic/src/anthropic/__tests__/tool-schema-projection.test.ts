/**
 * MCP-005 (TC-07) — conformance: the real `AnthropicProvider` over the shared MCP-005 fixture set.
 *
 * `tools[].input_schema` equals the projected `parameters` for every adopted/adapted fixture
 * (annotation and `patternProperties` keys pass through under `'adopt'` — Anthropic's profile is
 * permissive); the non-object-root, prototype-key and oversized fixtures are absent from the request;
 * one quarantine `warn` per absent fixture names it. Both request sites — `chat()` (`provider.ts:138`)
 * and `chatStream()` (`provider.ts:235`) — are exercised.
 */
import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  setGlobalLoggerSink,
} from '@robota-sdk/agent-core';
import { loadToolSchemaProjectionFixtures } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';

import type { IToolSchema, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';

vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: vi.fn() },
  }));
  return { default: MockAnthropic };
});

import Anthropic from '@anthropic-ai/sdk';

import { AnthropicProvider } from '../provider';

const fixtures = loadToolSchemaProjectionFixtures();
const ANTHROPIC_PROFILE = { ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'anthropic' };

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

/** A no-content streaming response, matching `chatWithStreaming`'s expected event shape. */
function emptyStreamEvents(): AsyncIterable<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [
    {
      type: 'message_start',
      message: { usage: { input_tokens: 1, output_tokens: 0 }, model: 'claude-3-opus-20240229' },
    },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}

interface ISentTool {
  name: string;
  description: string;
  input_schema: unknown;
}

describe('MCP-005 TC-07 — Anthropic conformance over shared fixtures', () => {
  let mockClient: { messages: { create: ReturnType<typeof vi.fn> } };
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = { messages: { create: vi.fn() } };
    provider = new AnthropicProvider({ client: mockClient as unknown as Anthropic });
  });

  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  function sentTools(): ISentTool[] {
    const [requestParams] = mockClient.messages.create.mock.calls[
      mockClient.messages.create.mock.calls.length - 1
    ] as [{ tools?: ISentTool[] }];
    return requestParams.tools ?? [];
  }

  it('chat(): input_schema equals the projected parameters for adopted/adapted fixtures', async () => {
    mockClient.messages.create.mockResolvedValue(emptyStreamEvents());
    const tools: IToolSchema[] = [
      fixtures.subsetOnly,
      fixtures.unknownKeywords,
      fixtures.arrayItemsObject,
      fixtures.nestedAnyOfOptional,
    ];

    await provider.chat([createUserMessage('hello')], {
      model: 'claude-3-opus-20240229',
      tools,
    });

    const sent = sentTools();
    expect(sent).toHaveLength(4);
    for (const [index, tool] of tools.entries()) {
      const projection = projectToolSchema(tool, ANTHROPIC_PROFILE);
      expect(sent[index]?.input_schema).toEqual(projection.tool.parameters);
      expect(sent[index]?.description).toEqual(projection.tool.description);
    }
  });

  it('chat(): rejected fixtures are absent and each gets one quarantine warn', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    mockClient.messages.create.mockResolvedValue(emptyStreamEvents());

    const rejected: IToolSchema[] = [
      fixtures.rootAnyOf,
      fixtures.prototypeKey,
      fixtures.oversized,
      fixtures.deepNesting,
    ];
    await provider.chat([createUserMessage('hello')], {
      model: 'claude-3-opus-20240229',
      tools: rejected,
    });

    expect(sentTools()).toHaveLength(0);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(rejected.length);
    expect(quarantineLines.every((line) => line.includes('provider=anthropic'))).toBe(true);
  });

  it('chat(): one bad tool among many is quarantined, the rest reach the request', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    mockClient.messages.create.mockResolvedValue(emptyStreamEvents());

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    await provider.chat([createUserMessage('hello')], {
      model: 'claude-3-opus-20240229',
      tools,
    });

    expect(sentTools().map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
    expect(quarantineLines[0]).toContain('tool=bad_tool');
  });

  it('chatStream(): input_schema equals the projected parameters and rejected fixtures are absent', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    mockClient.messages.create.mockResolvedValue(emptyStreamEvents());

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'claude-3-opus-20240229',
      tools,
    })) {
      // drain
    }

    const sent = sentTools();
    expect(sent.map((tool) => tool.name)).toEqual(['good_tool_one', 'good_tool_two']);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
  });
});
