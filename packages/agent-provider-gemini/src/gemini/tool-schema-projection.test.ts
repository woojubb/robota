/**
 * MCP-005 (TC-10) — conformance: the real `GeminiProvider` over the shared MCP-005 fixture set.
 *
 * For every fixture member `convertParameterSchema` omits, the projection's `changes` already holds a
 * `member-stripped` (Gemini's `unsupportedMembers: ['additionalProperties']`) or
 * `keyword-stripped`/`keyword-replaced` (Gemini's `unknownKeywords: 'strip'`) entry at that path — no
 * silent drop, root included — and the converted `FunctionDeclaration.parameters` deep-equal the field
 * rebuild of the ALREADY-PROJECTED schema. Both `chat` and `chatStream` request paths are exercised.
 */
import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  projectToolSchema,
  setGlobalLoggerSink,
} from '@robota-sdk/agent-core';
import { loadToolSchemaProjectionFixtures } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { convertToolsToGeminiFormat } from './tool-schema-converter';

import type { IToolSchema, ILogger, TUniversalMessage } from '@robota-sdk/agent-core';

const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();

vi.mock('@google/genai', () => {
  class GoogleGenAI {
    public readonly models = {
      generateContent: generateContentMock,
      generateContentStream: generateContentStreamMock,
    };
    public constructor(_options: { apiKey: string }) {}
  }
  return {
    GoogleGenAI,
    Type: {
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      BOOLEAN: 'BOOLEAN',
      ARRAY: 'ARRAY',
      OBJECT: 'OBJECT',
    },
    FunctionCallingConfigMode: { AUTO: 'AUTO', NONE: 'NONE', ANY: 'ANY' },
  };
});

import { GeminiProvider } from './provider';

const fixtures = loadToolSchemaProjectionFixtures();
const GEMINI_PROFILE = {
  ...PERMISSIVE_TOOL_SCHEMA_PROFILE,
  providerName: 'gemini',
  unknownKeywords: 'strip' as const,
  unsupportedMembers: ['additionalProperties'] as const,
};

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

function makeTextResponse(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

async function* streamOf(chunks: Array<ReturnType<typeof makeTextResponse>>) {
  for (const chunk of chunks) yield chunk;
}

function sentFunctionDeclarations(): Array<{
  name: string;
  description: string;
  parameters: unknown;
}> {
  const payload = generateContentMock.mock.calls[generateContentMock.mock.calls.length - 1]?.[0];
  return payload?.config?.tools?.[0]?.functionDeclarations ?? [];
}

/** Recursively collect every key present at every node, as `path:key` strings. */
function collectKeys(node: unknown, path = ''): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => collectKeys(entry, `${path}/${index}`));
  }
  if (typeof node !== 'object' || node === null) {
    return [];
  }
  const record = node as Record<string, unknown>;
  const own = Object.keys(record).map((key) => `${path}:${key}`);
  const nested = Object.entries(record).flatMap(([key, value]) =>
    key === 'properties' || key === 'items' || key === 'anyOf'
      ? Object.entries(
          key === 'properties' ? (value as Record<string, unknown>) : { [key]: value },
        ).flatMap(([childKey, childValue]) =>
          collectKeys(childValue, key === 'properties' ? `${path}/properties/${childKey}` : path),
        )
      : [],
  );
  return [...own, ...nested];
}

describe('MCP-005 TC-10 — Gemini conformance over shared fixtures', () => {
  beforeEach(() => {
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
  });

  afterEach(() => {
    setGlobalLoggerSink(undefined);
  });

  it('chat(): FunctionDeclaration.parameters deep-equal the rebuild of the ALREADY-PROJECTED schema', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const tools: IToolSchema[] = [
      fixtures.subsetOnly,
      fixtures.unknownKeywords,
      fixtures.arrayItemsObject,
      fixtures.nestedAnyOfOptional,
    ];
    await provider.chat([createUserMessage('hello')], { model: 'gemini-pro', tools });

    const sent = sentFunctionDeclarations();
    expect(sent).toHaveLength(4);
    for (const [index, tool] of tools.entries()) {
      const projection = projectToolSchema(tool, GEMINI_PROFILE);
      const [expected] = convertToolsToGeminiFormat([projection.tool as IToolSchema]);
      expect(sent[index]?.parameters).toEqual(expected?.parameters);
    }
  });

  it('chat(): no member the rebuild omits is a silent drop — every one is a recorded change', async () => {
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    // A schema exercising Gemini's ONE unsupported member (`additionalProperties`, root included) and
    // a foreign keyword under a typed node, nested and at the root.
    const tool: IToolSchema = {
      name: 'configure',
      description: 'Configure a resource',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nested: {
            type: 'object',
            additionalProperties: true,
            properties: { flag: { type: 'boolean' } },
            patternProperties: { '^x-': { type: 'string' } },
          } as unknown as IToolSchema['parameters']['properties'][string],
        },
        required: [],
      },
    };

    await provider.chat([createUserMessage('hello')], { model: 'gemini-pro', tools: [tool] });

    const projection = projectToolSchema(tool, GEMINI_PROFILE);
    expect(projection.outcome).toBe('adapted');
    // Every disappeared member (root `additionalProperties`, nested `additionalProperties`, the
    // foreign `patternProperties`) is accounted for by a change record.
    const changeKeywords = projection.changes.map((change) => `${change.path}:${change.keyword}`);
    expect(changeKeywords).toContain(':additionalProperties');
    expect(changeKeywords).toContain('/properties/nested:additionalProperties');
    expect(changeKeywords).toContain('/properties/nested:patternProperties');

    // The projected schema (what the rebuild actually sees) carries neither disappeared member.
    const projectedKeys = collectKeys(projection.tool.parameters);
    expect(projectedKeys.some((key) => key.endsWith(':additionalProperties'))).toBe(false);
    expect(projectedKeys.some((key) => key.endsWith(':patternProperties'))).toBe(false);

    // And the rebuild sent to Gemini matches converting the already-projected schema directly.
    const sent = sentFunctionDeclarations();
    const [expected] = convertToolsToGeminiFormat([projection.tool as IToolSchema]);
    expect(sent[0]?.parameters).toEqual(expected?.parameters);
  });

  it('chat(): rejected fixtures are absent and each gets one quarantine warn', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const rejected: IToolSchema[] = [
      fixtures.rootAnyOf,
      fixtures.prototypeKey,
      fixtures.deepNesting,
      fixtures.oversized,
    ];
    await provider.chat([createUserMessage('hello')], { model: 'gemini-pro', tools: rejected });

    expect(sentFunctionDeclarations()).toHaveLength(0);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(rejected.length);
    expect(quarantineLines.every((line) => line.includes('provider=gemini'))).toBe(true);
  });

  it('chat(): one bad tool among many is quarantined, the rest reach the request', async () => {
    const recorder = recordingSink();
    setGlobalLoggerSink(recorder.sink);
    generateContentMock.mockResolvedValue(makeTextResponse('done'));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    await provider.chat([createUserMessage('hello')], { model: 'gemini-pro', tools });

    expect(sentFunctionDeclarations().map((tool) => tool.name)).toEqual([
      'good_tool_one',
      'good_tool_two',
    ]);
    const quarantineLines = recorder.lines.filter((line) =>
      line.includes('tool_schema_quarantined'),
    );
    expect(quarantineLines).toHaveLength(1);
    expect(quarantineLines[0]).toContain('tool=bad_tool');
  });

  it('chatStream(): projects tools and omits the rejected one too', async () => {
    generateContentStreamMock.mockResolvedValue(streamOf([makeTextResponse('done')]));
    const provider = new GeminiProvider({ apiKey: 'test-key' });

    const tools = [...fixtures.oneInvalidAmongMany] as IToolSchema[];
    for await (const _chunk of provider.chatStream([createUserMessage('hello')], {
      model: 'gemini-pro',
      tools,
    })) {
      // drain
    }

    const payload = generateContentStreamMock.mock.calls[0]?.[0];
    const sent = payload?.config?.tools?.[0]?.functionDeclarations ?? [];
    expect(sent.map((tool: { name: string }) => tool.name)).toEqual([
      'good_tool_one',
      'good_tool_two',
    ]);
  });
});
