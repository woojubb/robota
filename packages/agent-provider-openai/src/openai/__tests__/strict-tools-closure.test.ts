import { closeObjectSchemas } from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';

import type { IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';

/**
 * MCP-005 (TC-08) — `strictTools` no longer closes schemas inside `responses-converter.ts`; the
 * projection step (`AbstractAIProvider.projectTools()`, `STRICT_TOOL_SCHEMA_PROFILE`) runs BEFORE the
 * converter now. This test drives the real `OpenAIProvider` end to end (profile → projector →
 * converter) over a fake Responses client and asserts the request's `parameters` is byte-identical to
 * today's `closeObjectSchemas(input, { requireAllProperties: true, optionalAsNullable: true })` for a
 * fixture the projector does not reject — the capability-preservation premise GATE-WRITE recorded.
 *
 * PROV-007's original story stays true below: strict mode does not accept an arbitrary JSON Schema —
 * every object node, nested included, must carry `additionalProperties: false` and list all of its
 * properties in `required` — so a schema that is correct for this repository was rejected whenever a
 * caller opted in, root included.
 */

vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
    responses: { create: vi.fn() },
  }));
  return { default: MockOpenAI };
});

interface IFakeOpenAIClient {
  responses: { create: ReturnType<typeof vi.fn> };
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
}

function createUserMessage(content: string): TUniversalMessage {
  return { id: 'msg-1', state: 'complete' as const, role: 'user', content, timestamp: new Date() };
}

function fakeResponsesResult(): Record<string, unknown> {
  return {
    id: 'resp-strict-tools-closure',
    model: 'gpt-4o',
    output_text: '',
    output: [],
    status: 'completed',
  };
}

async function sendChat(
  provider: OpenAIProvider,
  tools: IToolSchema[],
): Promise<Record<string, unknown>> {
  const client = (provider as unknown as { client: IFakeOpenAIClient }).client;
  client.responses.create.mockResolvedValue(fakeResponsesResult());
  await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools });
  const [requestParams] = client.responses.create.mock.calls[
    client.responses.create.mock.calls.length - 1
  ] as [Record<string, unknown>];
  return requestParams;
}

/** The same request through the Chat Completions surface (the default once `baseURL` is set). */
async function sendChatCompletions(
  provider: OpenAIProvider,
  tools: IToolSchema[],
): Promise<Record<string, unknown>> {
  const client = (provider as unknown as { client: IFakeOpenAIClient }).client;
  client.chat.completions.create.mockResolvedValue({
    id: 'chatcmpl-strict-tools',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  });
  await provider.chat([createUserMessage('hello')], { model: 'gpt-4o', tools });
  const calls = client.chat.completions.create.mock.calls;
  const [requestParams] = calls[calls.length - 1] as [Record<string, unknown>];
  return requestParams;
}

const NESTED_TOOL: IToolSchema = {
  name: 'create_user',
  description: 'Creates a user',
  parameters: {
    type: 'object',
    additionalProperties: true,
    properties: {
      email: { type: 'string' },
      profile: {
        type: 'object',
        additionalProperties: true,
        properties: { nickname: { type: 'string' }, bio: { type: 'string' } },
        required: ['nickname'],
      },
    },
    required: ['email'],
  },
};

const FLAT_TOOL: IToolSchema = {
  name: 'ping',
  description: 'Pings',
  parameters: { type: 'object', additionalProperties: true, properties: {}, required: [] },
};

describe('MCP-005 TC-08 — the strict path (profile → projector → converter)', () => {
  it('closes and completes every object node, root and nested, byte-identical to closeObjectSchemas', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', strictTools: true });
    const requestParams = await sendChat(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<Record<string, unknown>>;

    expect(tool.strict).toBe(true);
    expect(tool.parameters).toEqual(
      closeObjectSchemas(NESTED_TOOL.parameters, {
        requireAllProperties: true,
        optionalAsNullable: true,
      }),
    );
  });

  it('is not only about nesting — an open ROOT is refused too', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', strictTools: true });
    const requestParams = await sendChat(provider, [FLAT_TOOL]);
    const [tool] = requestParams.tools as Array<Record<string, unknown>>;

    expect((tool.parameters as Record<string, unknown>).additionalProperties).toBe(false);
  });

  it('leaves the description byte-identical for a fixture with no lossy strip', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', strictTools: true });
    const requestParams = await sendChat(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<Record<string, unknown>>;

    expect(tool.description).toBe(NESTED_TOOL.description);
  });
});

describe('MCP-005 TC-08 — the non-strict path carries the permissive projection', () => {
  it('forwards the schema unchanged and sends strict: false', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test', strictTools: false });
    const requestParams = await sendChat(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<Record<string, unknown>>;

    expect(tool.strict).toBe(false);
    expect(tool.parameters).toEqual(NESTED_TOOL.parameters);
  });

  it('treats an unset strictTools as non-strict', async () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const requestParams = await sendChat(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<Record<string, unknown>>;

    expect(tool.strict).toBe(false);
    expect(tool.parameters).toEqual(NESTED_TOOL.parameters);
  });
});

describe('strictTools on the Chat Completions surface (#3209)', () => {
  const GATEWAY = { apiKey: 'sk-test', baseURL: 'https://gateway.example/v1' };

  it('declares each function strict, with the same closed schema the Responses surface sends', async () => {
    const provider = new OpenAIProvider({ ...GATEWAY, strictTools: true });
    const requestParams = await sendChatCompletions(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<{ function: Record<string, unknown> }>;

    expect(tool?.function.strict).toBe(true);
    expect(tool?.function.parameters).toEqual(
      closeObjectSchemas(NESTED_TOOL.parameters, {
        requireAllProperties: true,
        optionalAsNullable: true,
      }),
    );
  });

  it('sends no strict key when strictTools is off', async () => {
    const provider = new OpenAIProvider(GATEWAY);
    const requestParams = await sendChatCompletions(provider, [NESTED_TOOL]);
    const [tool] = requestParams.tools as Array<{ function: Record<string, unknown> }>;

    expect(tool?.function).not.toHaveProperty('strict');
    expect(tool?.function.parameters).toEqual(NESTED_TOOL.parameters);
  });
});
