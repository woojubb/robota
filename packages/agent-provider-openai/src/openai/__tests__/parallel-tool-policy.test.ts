import { once } from 'node:events';
import { createServer } from 'node:http';

import OpenAI from 'openai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';
import { createOpenAIProviderDefinition } from '../provider-definition';

import type { IOpenAIProviderOptions, TOpenAIApiSurface } from '../types';
import type {
  IAssistantMessage,
  IChatOptions,
  IExecutor,
  IToolSchema,
  TUniversalMessage,
} from '@robota-sdk/agent-core';

const tool: IToolSchema = {
  name: 'classify_invoice',
  description: 'Classify an invoice.',
  parameters: {
    type: 'object',
    properties: { category: { type: 'string' }, note: { type: 'string' } },
    required: ['category'],
  },
};
const calls = ['invoice', 'policy'].map((category, index) => ({
  id: `call_${index}`,
  type: 'function',
  function: { name: tool.name, arguments: JSON.stringify({ category }) },
}));
const usage = { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 };
const completion = {
  id: 'completion-fixture',
  object: 'chat.completion',
  created: 0,
  model: 'fixture-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '', tool_calls: calls },
      finish_reason: 'tool_calls',
    },
  ],
  usage,
};
const response = {
  id: 'response-fixture',
  object: 'response',
  created_at: 0,
  model: 'fixture-model',
  status: 'completed',
  output: calls.map((call, index) => ({
    type: 'function_call',
    id: `item_${index}`,
    call_id: call.id,
    status: 'completed',
    name: call.function.name,
    arguments: call.function.arguments,
  })),
  usage: { input_tokens: 12, output_tokens: 6, total_tokens: 18 },
};
const messages: TUniversalMessage[] = [
  {
    id: 'user-fixture',
    role: 'user',
    content: 'Classify this invoice.',
    state: 'complete',
    timestamp: new Date(0),
  },
];
const received: Record<string, unknown>[] = [];
let baseURL: string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const server = createServer(async (request, reply) => {
  let data = '';
  for await (const chunk of request) data += String(chunk);
  const body: unknown = JSON.parse(data);
  if (!isRecord(body)) throw new Error('Expected fixture request object');
  received.push(body);
  const responses = request.url === '/v1/responses';
  reply.setHeader('x-request-id', 'request-fixture');
  if (body.stream === true) {
    reply.setHeader('content-type', 'text/event-stream');
    const events = responses
      ? [{ type: 'response.completed', response, sequence_number: 1 }]
      : [
          {
            id: completion.id,
            object: 'chat.completion.chunk',
            created: 0,
            model: 'fixture-model',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  content: '',
                  tool_calls: calls.map((call, index) => ({ ...call, index })),
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage,
          },
        ];
    reply.end(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
        (responses ? '' : 'data: [DONE]\n\n'),
    );
  } else {
    reply.setHeader('content-type', 'application/json');
    reply.end(JSON.stringify(responses ? response : completion));
  }
});

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  baseURL = `http://127.0.0.1:${address.port}/v1`;
});
afterEach(() => {
  received.length = 0;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function providerOptions(apiSurface: TOpenAIApiSurface): IOpenAIProviderOptions {
  return { apiSurface, client: new OpenAI({ apiKey: 'fixture-key', baseURL, maxRetries: 0 }) };
}

async function invoke(
  provider: OpenAIProvider,
  form: 'chat' | 'callback' | 'stream',
  options: IChatOptions,
): Promise<TUniversalMessage[]> {
  if (form !== 'stream') {
    return [
      await provider.chat(messages, {
        ...options,
        ...(form === 'callback' && { onTextDelta: () => undefined }),
      }),
    ];
  }
  const result: TUniversalMessage[] = [];
  for await (const message of provider.chatStream(messages, options)) result.push(message);
  return result;
}

describe.each<TOpenAIApiSurface>(['chat-completions', 'responses'])(
  '%s parallel tool policy',
  (apiSurface) => {
    it.each([undefined, false, true])('serializes %s on every invocation form', async (policy) => {
      const provider = new OpenAIProvider({
        ...providerOptions(apiSurface),
        parallelToolCalls: policy,
      });
      const schemaBefore = JSON.stringify(tool);
      for (const form of ['chat', 'callback', 'stream'] as const) {
        const observed: unknown[] = [];
        const result = await invoke(provider, form, {
          model: 'fixture-model',
          tools: [tool],
          toolChoice: 'auto',
          onProviderNativeRawPayload: (event) => {
            if (event.payloadKind === 'request') observed.push(event.payload);
          },
        });
        const body = received.at(-1);
        if (policy === undefined) expect(body).not.toHaveProperty('parallel_tool_calls');
        else expect(body).toHaveProperty('parallel_tool_calls', policy);
        expect(observed).toEqual([body]);
        expect(body).toHaveProperty(
          apiSurface === 'responses' ? 'tools.0.parameters' : 'tools.0.function.parameters',
          tool.parameters,
        );
        const assistant = result.find((message) => message.role === 'assistant');
        expect(assistant).toMatchObject({ toolCalls: calls });
        if (form !== 'stream' || apiSurface === 'responses') {
          expect(assistant).toMatchObject({
            usage: {
              promptTokens: 12,
              completionTokens: 6,
              totalTokens: 18,
            },
          });
        }
        expect(assistant?.metadata).toHaveProperty('providerRequestId', 'request-fixture');
      }
      expect(JSON.stringify(tool)).toBe(schemaBefore);
      expect(received).toHaveLength(3);
    });

    it('keeps explicit false without tools and with toolChoice none', async () => {
      const provider = new OpenAIProvider({
        ...providerOptions(apiSurface),
        parallelToolCalls: false,
      });
      await provider.chat(messages, { model: 'fixture-model' });
      await provider.chat(messages, { model: 'fixture-model', tools: [tool], toolChoice: 'none' });
      expect(received[0]).toHaveProperty('parallel_tool_calls', false);
      expect(received[0]).not.toHaveProperty('tools');
      expect(received[1]).toMatchObject({ parallel_tool_calls: false, tool_choice: 'none' });
    });

    it('captures the primitive without freezing the caller options', async () => {
      const options = { ...providerOptions(apiSurface), parallelToolCalls: false };
      const provider = new OpenAIProvider(options);
      options.parallelToolCalls = true;
      options.defaultModel = 'fixture-model';
      await provider.chat(messages);
      expect(received[0]).toMatchObject({ parallel_tool_calls: false, model: 'fixture-model' });
      expect(Object.isFrozen(options)).toBe(false);
    });

    it.each([undefined, false, true])('preserves profile policy %s on the wire', async (policy) => {
      const provider = createOpenAIProviderDefinition().createProvider({
        name: 'openai',
        model: 'fixture-model',
        apiKey: 'fixture-key',
        baseURL,
        options: { apiSurface, ...(policy !== undefined && { parallelToolCalls: policy }) },
      });
      await provider.chat(messages);
      if (policy === undefined) expect(received[0]).not.toHaveProperty('parallel_tool_calls');
      else expect(received[0]).toHaveProperty('parallel_tool_calls', policy);
    });
  },
);

describe('parallel tool policy boundary', () => {
  it.each([null, 0, 'private-invalid-value', {}, []])('rejects non-boolean policy %j', (value) => {
    const options = providerOptions('responses');
    Object.defineProperty(options, 'parallelToolCalls', { value });
    const direct = () => new OpenAIProvider(options);
    const profile = () =>
      createOpenAIProviderDefinition().createProvider({
        name: 'openai',
        model: 'fixture-model',
        apiKey: 'fixture-key',
        baseURL,
        options: { parallelToolCalls: value },
      });
    for (const create of [direct, profile]) {
      expect(create).toThrow('parallelToolCalls must be a boolean');
      expect(create).not.toThrow('private-invalid-value');
    }
    expect(received).toHaveLength(0);
  });

  it.each([null, false, 1, 'private-unsupported-surface', {}, []])(
    'rejects original invalid surface %j before profile fallback',
    (apiSurface) => {
      const options = { ...providerOptions('responses'), parallelToolCalls: false };
      Object.defineProperty(options, 'apiSurface', { value: apiSurface });
      expect(() => new OpenAIProvider(options)).toThrow('supported OpenAI API surface');
      expect(() =>
        createOpenAIProviderDefinition().createProvider({
          name: 'openai',
          model: 'fixture-model',
          apiKey: 'fixture-key',
          baseURL,
          options: { apiSurface, parallelToolCalls: false },
        }),
      ).toThrow('supported OpenAI API surface');
      expect(received).toHaveLength(0);
    },
  );

  it('retains legacy profile surface fallback when policy is omitted', async () => {
    const provider = createOpenAIProviderDefinition().createProvider({
      name: 'openai',
      apiKey: 'fixture-key',
      model: 'fixture-model',
      baseURL,
      options: { apiSurface: 'legacy-invalid-surface' },
    });
    await provider.chat(messages);
    expect(received[0]).toHaveProperty('messages');
    expect(received[0]).not.toHaveProperty('parallel_tool_calls');
  });
});

describe('opaque executors', () => {
  async function configureExecutor(provider: OpenAIProvider, executor: IExecutor) {
    const config = {};
    Object.defineProperty(config, 'executor', { value: executor });
    await provider.configure(config);
  }

  function executor() {
    const message: IAssistantMessage = {
      id: 'executor-fixture',
      role: 'assistant',
      content: 'Invoice classified.',
      state: 'complete',
      timestamp: new Date(0),
    };
    const executeChat = vi.fn(async () => ({ message }));
    const executeChatStream = vi.fn(async function* () {
      yield { kind: 'message' as const, message };
      yield { kind: 'terminal' as const };
    });
    const value: IExecutor = {
      name: 'fixture',
      version: '1',
      executeChat,
      executeChatStream,
      supportsTools: () => true,
      validateConfig: () => true,
    };
    return { value, executeChat, executeChatStream };
  }

  it.each([false, true])(
    'rejects constructor policy %s before client or executor dispatch',
    (policy) => {
      const fixture = executor();
      const options = { executor: fixture.value, parallelToolCalls: policy };
      const client = vi.fn(() => {
        throw new Error('Client must not be read');
      });
      Object.defineProperty(options, 'client', { get: client });
      expect(() => new OpenAIProvider(options)).toThrow(
        'parallelToolCalls cannot be used with an executor',
      );
      expect(client).not.toHaveBeenCalled();
      expect(fixture.executeChat).not.toHaveBeenCalled();
      expect(received).toHaveLength(0);
    },
  );

  it.each([false, true])(
    'rejects policy %s after late configure injection before callbacks',
    async (policy) => {
      const fixture = executor();
      const provider = new OpenAIProvider({
        ...providerOptions('responses'),
        parallelToolCalls: policy,
      });
      await configureExecutor(provider, fixture.value);
      const callback = vi.fn();
      for (const form of ['chat', 'callback', 'stream'] as const) {
        await expect(
          invoke(provider, form, {
            model: 'fixture-model',
            onProviderNativeRawPayload: callback,
            onModelEffortOutcome: callback,
          }),
        ).rejects.toThrow('parallelToolCalls cannot be used with an executor');
      }
      expect(callback).not.toHaveBeenCalled();
      expect(fixture.executeChat).not.toHaveBeenCalled();
      expect(fixture.executeChatStream).not.toHaveBeenCalled();
      expect(received).toHaveLength(0);
    },
  );

  it.each(['constructor', 'configure'])(
    'preserves omitted policy with %s executor injection',
    async (injection) => {
      const fixture = executor();
      const provider = new OpenAIProvider(
        injection === 'constructor' ? { executor: fixture.value } : providerOptions('responses'),
      );
      if (injection === 'configure') await configureExecutor(provider, fixture.value);
      for (const form of ['chat', 'callback', 'stream'] as const) {
        expect(await invoke(provider, form, { model: 'fixture-model' })).toHaveLength(1);
      }
      expect(fixture.executeChat).toHaveBeenCalledTimes(2);
      expect(fixture.executeChatStream).toHaveBeenCalledTimes(1);
      expect(received).toHaveLength(0);
    },
  );
});
