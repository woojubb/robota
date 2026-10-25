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
    properties: { category: { type: 'string' } },
    required: ['category'],
  },
};
const call = {
  id: 'call_0',
  type: 'function',
  function: { name: tool.name, arguments: JSON.stringify({ category: 'invoice' }) },
};
const completion = {
  id: 'completion-fixture',
  object: 'chat.completion',
  created: 0,
  model: 'fixture-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '', tool_calls: [call] },
      finish_reason: 'tool_calls',
    },
  ],
};
const response = {
  id: 'response-fixture',
  object: 'response',
  created_at: 0,
  model: 'fixture-model',
  status: 'completed',
  output: [
    {
      type: 'function_call',
      id: 'item_0',
      call_id: call.id,
      status: 'completed',
      name: call.function.name,
      arguments: call.function.arguments,
    },
  ],
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
const gatewayOptions = { anthropic: { disableParallelToolUse: true } };
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
  if (body.stream === true) {
    reply.setHeader('content-type', 'text/event-stream');
    const event = responses
      ? { type: 'response.completed', response, sequence_number: 1 }
      : {
          id: completion.id,
          object: 'chat.completion.chunk',
          created: 0,
          model: 'fixture-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '', tool_calls: [{ ...call, index: 0 }] },
              finish_reason: 'tool_calls',
            },
          ],
        };
    reply.end(`data: ${JSON.stringify(event)}\n\n${responses ? '' : 'data: [DONE]\n\n'}`);
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

/** Bypasses the public type so the runtime boundary sees values TypeScript would reject. */
function withRawExtraBody(options: IOpenAIProviderOptions, value: unknown): IOpenAIProviderOptions {
  Object.defineProperty(options, 'extraBody', { value, enumerable: true });
  return options;
}

function createProfileProvider(apiSurface: TOpenAIApiSurface, extraBody: unknown) {
  const options = { apiSurface };
  if (extraBody !== undefined) {
    Object.defineProperty(options, 'extraBody', { value: extraBody, enumerable: true });
  }
  return createOpenAIProviderDefinition().createProvider({
    name: 'openai',
    model: 'fixture-model',
    apiKey: 'fixture-key',
    baseURL,
    options,
  });
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

const forms = ['chat', 'callback', 'stream'] as const;

describe.each<TOpenAIApiSurface>(['chat-completions', 'responses'])(
  '%s extra body',
  (apiSurface) => {
    it.each(forms)(
      'sends nested fields unchanged next to the parallel policy and a forced tool (%s)',
      async (form) => {
        const provider = new OpenAIProvider({
          ...providerOptions(apiSurface),
          parallelToolCalls: false,
          extraBody: { providerOptions: gatewayOptions },
        });
        const observed: unknown[] = [];
        const result = await invoke(provider, form, {
          model: 'fixture-model',
          tools: [tool],
          toolChoice: { tool: tool.name },
          onProviderNativeRawPayload: (event) => {
            if (event.payloadKind === 'request') observed.push(event.payload);
          },
        });
        expect(received).toHaveLength(1);
        const body = received[0];
        expect(body).toMatchObject({
          model: 'fixture-model',
          parallel_tool_calls: false,
          tool_choice:
            apiSurface === 'responses'
              ? { type: 'function', name: tool.name }
              : { type: 'function', function: { name: tool.name } },
          providerOptions: gatewayOptions,
        });
        expect(body?.providerOptions).toEqual(gatewayOptions);
        expect(observed).toEqual([body]);
        const assistant = result.find((message) => message.role === 'assistant');
        expect(assistant).toMatchObject({ toolCalls: [call] });
      },
    );

    it.each(forms)('sends the fields on requests without tools (%s)', async (form) => {
      const provider = new OpenAIProvider({
        ...providerOptions(apiSurface),
        extraBody: { providerOptions: gatewayOptions, user: 'fixture-user' },
      });
      await invoke(provider, form, { model: 'fixture-model' });
      expect(received[0]).not.toHaveProperty('tools');
      expect(received[0]).toMatchObject({ providerOptions: gatewayOptions, user: 'fixture-user' });
    });

    it('captures a copy at construction', async () => {
      const upstream = { disableParallelToolUse: true };
      const tags = ['first'];
      const extraBody: Record<string, { anthropic: typeof upstream } | string[]> = {
        providerOptions: { anthropic: upstream },
        tags,
      };
      const options = { ...providerOptions(apiSurface), extraBody };
      const provider = new OpenAIProvider(options);
      upstream.disableParallelToolUse = false;
      tags.push('second');
      extraBody['later'] = ['added'];
      Object.assign(options, { extraBody: { model: 'private-override-model', replaced: true } });
      await provider.chat(messages, { model: 'fixture-model' });
      expect(received[0]).toMatchObject({
        model: 'fixture-model',
        providerOptions: gatewayOptions,
        tags: ['first'],
      });
      expect(received[0]).not.toHaveProperty('later');
      expect(received[0]).not.toHaveProperty('replaced');
    });

    it('reserves every field the provider writes', async () => {
      const provider = new OpenAIProvider({
        ...providerOptions(apiSurface),
        parallelToolCalls: false,
        strictTools: true,
        responseFormat: 'json_schema',
        jsonSchema: { name: 'classification', schema: { type: 'object' } },
        ...(apiSurface === 'responses' && {
          reasoning: { summary: 'auto' },
          includeEncryptedReasoning: true,
          store: false,
        }),
      });
      for (const form of forms) {
        await invoke(provider, form, {
          model: 'fixture-model',
          tools: [tool],
          toolChoice: 'required',
          temperature: 0,
          maxTokens: 64,
        });
      }
      const written = [...new Set(received.flatMap((body) => Object.keys(body)))];
      expect(written).toEqual(
        expect.arrayContaining(['model', 'tools', 'parallel_tool_calls', 'stream']),
      );
      for (const field of written) {
        expect(
          () =>
            new OpenAIProvider({ ...providerOptions(apiSurface), extraBody: { [field]: null } }),
        ).toThrow(`extraBody cannot set the provider-managed field ${field}`);
      }
    });

    it('keeps a raw-payload observer from changing later requests', async () => {
      const provider = new OpenAIProvider({
        ...providerOptions(apiSurface),
        extraBody: { metadata: { tag: 'captured' } },
      });
      await provider.chat(messages, {
        model: 'fixture-model',
        onProviderNativeRawPayload: (event) => {
          const metadata = isRecord(event.payload) ? event.payload['metadata'] : undefined;
          if (event.payloadKind === 'request' && isRecord(metadata)) metadata['tag'] = 'mutated';
        },
      });
      await provider.chat(messages, { model: 'fixture-model' });
      expect(received[1]).toHaveProperty('metadata', { tag: 'captured' });
    });

    it('leaves request bodies unchanged when omitted or empty', async () => {
      for (const extraBody of [undefined, {}]) {
        const provider = new OpenAIProvider({ ...providerOptions(apiSurface), extraBody });
        await provider.chat(messages, { model: 'fixture-model', tools: [tool] });
      }
      const baseline = new OpenAIProvider(providerOptions(apiSurface));
      await baseline.chat(messages, { model: 'fixture-model', tools: [tool] });
      expect(received).toHaveLength(3);
      expect(received[0]).toEqual(received[2]);
      expect(received[1]).toEqual(received[2]);
    });

    it('forwards a profile extra body', async () => {
      const provider = createProfileProvider(apiSurface, { providerOptions: gatewayOptions });
      await provider.chat(messages, { tools: [tool] });
      expect(received[0]).toHaveProperty('providerOptions', gatewayOptions);
    });
  },
);

describe('extra body boundary', () => {
  const managedFields = [
    'model',
    'messages',
    'input',
    'previous_response_id',
    'conversation',
    'tools',
    'tool_choice',
    'parallel_tool_calls',
    'functions',
    'function_call',
    'web_search_options',
    'stream',
    'stream_options',
    'n',
    'background',
    'modalities',
    'audio',
    'response_format',
    'text',
    'max_tokens',
    'max_completion_tokens',
    'max_output_tokens',
    'temperature',
    'reasoning',
    'reasoning_effort',
    'include',
    'store',
  ];

  it.each(managedFields)('rejects the provider-managed field %s', (field) => {
    const extraBody = { [field]: 'private-override-value' };
    const direct = () => new OpenAIProvider({ ...providerOptions('chat-completions'), extraBody });
    const profile = () => createProfileProvider('chat-completions', extraBody);
    for (const create of [direct, profile]) {
      expect(create).toThrow(`extraBody cannot set the provider-managed field ${field}`);
      expect(create).not.toThrow('private-override-value');
    }
    expect(received).toHaveLength(0);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'private-invalid-value'],
    ['a number', 1],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a class instance', new (class Options {})()],
  ])('rejects %s as the extra body', (_label, value) => {
    const direct = () => new OpenAIProvider(withRawExtraBody(providerOptions('responses'), value));
    const profile = () => createProfileProvider('responses', value);
    for (const create of [direct, profile]) {
      expect(create).toThrow('extraBody must be a plain JSON object');
      expect(create).not.toThrow('private-invalid-value');
    }
    expect(received).toHaveLength(0);
  });

  const symbolKeyed = { [Symbol('hidden')]: true };
  const hiddenKeyed = {};
  Object.defineProperty(hiddenKeyed, 'hidden', { value: true, enumerable: false });
  const cyclic: Record<string, unknown> = {};
  cyclic['self'] = cyclic;
  const indexedWithExtra: unknown[] & { extra?: boolean } = [1];
  indexedWithExtra.extra = true;
  // eslint-disable-next-line no-sparse-arrays -- a hole is one of the rejected shapes
  const sparse = [1, , 2];
  it.each([
    ['undefined', undefined],
    ['a function', () => 'private-invalid-value'],
    ['a symbol', Symbol('private-invalid-value')],
    ['a bigint', 1n],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a Date', new Date(0)],
    ['a Map', new Map()],
    ['a class instance', new (class Options {})()],
    ['a sparse array', sparse],
    ['an array with an undefined item', [undefined]],
    ['an array with extra properties', indexedWithExtra],
    ['a symbol key', symbolKeyed],
    ['a non-enumerable key', hiddenKeyed],
    ['a cycle', cyclic],
  ])('rejects nested %s', (_label, value) => {
    const extraBody = { secret: 'private-secret-value', nested: { value } };
    const direct = () =>
      new OpenAIProvider(withRawExtraBody(providerOptions('chat-completions'), extraBody));
    const profile = () => createProfileProvider('chat-completions', extraBody);
    for (const create of [direct, profile]) {
      expect(create).toThrow('extraBody must contain only JSON data');
      expect(create).not.toThrow('private-secret-value');
      expect(create).not.toThrow('private-invalid-value');
    }
    expect(received).toHaveLength(0);
  });

  it('accepts shared references that are not cycles', async () => {
    const shared = { tag: 'shared' };
    const provider = new OpenAIProvider({
      ...providerOptions('chat-completions'),
      extraBody: { first: shared, second: [shared], none: null, count: -1.5 },
    });
    await provider.chat(messages, { model: 'fixture-model' });
    expect(received[0]).toMatchObject({
      first: shared,
      second: [shared],
      none: null,
      count: -1.5,
    });
  });

  it('sends a __proto__ key as plain data', async () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true}}');
    const provider = new OpenAIProvider(
      withRawExtraBody(providerOptions('chat-completions'), parsed),
    );
    await provider.chat(messages, { model: 'fixture-model' });
    expect(Object.getOwnPropertyDescriptor(received[0], '__proto__')?.value).toEqual({
      polluted: true,
    });
    expect(Object.prototype).not.toHaveProperty('polluted');
  });
});

describe('extra body with executors', () => {
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

  it('rejects constructor injection before the client is read', () => {
    const fixture = executor();
    const options = { executor: fixture.value, extraBody: { providerOptions: gatewayOptions } };
    const client = vi.fn(() => {
      throw new Error('Client must not be read');
    });
    Object.defineProperty(options, 'client', { get: client });
    expect(() => new OpenAIProvider(options)).toThrow('extraBody cannot be used with an executor');
    expect(client).not.toHaveBeenCalled();
    expect(fixture.executeChat).not.toHaveBeenCalled();
  });

  it('rejects a later configure injection before callbacks or dispatch', async () => {
    const fixture = executor();
    const provider = new OpenAIProvider({
      ...providerOptions('chat-completions'),
      extraBody: { providerOptions: gatewayOptions },
    });
    const config = {};
    Object.defineProperty(config, 'executor', { value: fixture.value });
    await provider.configure(config);
    const callback = vi.fn();
    for (const form of forms) {
      await expect(
        invoke(provider, form, {
          model: 'fixture-model',
          onProviderNativeRawPayload: callback,
          onModelEffortOutcome: callback,
        }),
      ).rejects.toThrow('extraBody cannot be used with an executor');
    }
    expect(callback).not.toHaveBeenCalled();
    expect(fixture.executeChat).not.toHaveBeenCalled();
    expect(fixture.executeChatStream).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
  });

  it('treats an empty extra body as omitted', async () => {
    const fixture = executor();
    const provider = new OpenAIProvider({ executor: fixture.value, extraBody: {} });
    expect(await invoke(provider, 'chat', { model: 'fixture-model' })).toHaveLength(1);
    expect(fixture.executeChat).toHaveBeenCalledTimes(1);
  });
});
