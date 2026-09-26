/**
 * The run's `AbortSignal` reaches the SDK request on every call site of every provider here
 * (agent-core SPEC, Cancellation Contract). The non-streaming `chat()` path — the one agent-core's
 * forced summary takes — and the raw `chatStream()` path on Chat Completions used to send no
 * signal, so aborting a run left those requests running to completion.
 */
import { describe, expect, it, vi } from 'vitest';

import { DeepSeekProvider, GemmaProvider, QwenProvider } from './index';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import type OpenAI from 'openai';

const completion = {
  id: 'c1',
  object: 'chat.completion',
  created: 0,
  model: 'test-model',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
};
const completionChunks = [
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }],
  },
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  },
];
const response = {
  id: 'resp_1',
  model: 'test-model',
  status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};
const responseEvents = [
  { type: 'response.output_text.delta', delta: 'hi' },
  { type: 'response.completed', response },
];

const messages: TUniversalMessage[] = [
  { id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() },
];

async function* iterate(items: readonly object[]): AsyncGenerator<object> {
  for (const item of items) yield item;
}

/** An SDK client double whose `create` answers like the SDK and records the request options. */
function fakeClient() {
  const chatCreate = vi.fn(
    (params: { stream?: boolean }, _requestOptions?: OpenAI.RequestOptions) =>
      Promise.resolve(params.stream ? iterate(completionChunks) : completion),
  );
  const responsesCreate = vi.fn(
    (params: { stream?: boolean }, _requestOptions?: OpenAI.RequestOptions) =>
      Promise.resolve(params.stream ? iterate(responseEvents) : response),
  );
  const client = {
    chat: { completions: { create: chatCreate } },
    responses: { create: responsesCreate },
  } as unknown as OpenAI;
  return { client, chatCreate, responsesCreate };
}

interface IChatProvider {
  chat(messages: TUniversalMessage[], options: IChatOptions): Promise<TUniversalMessage>;
  chatStream(
    messages: TUniversalMessage[],
    options: IChatOptions,
  ): AsyncIterable<TUniversalMessage>;
}

const PROVIDERS: ReadonlyArray<
  readonly [string, (client: OpenAI) => IChatProvider, string, 'chat' | 'responses']
> = [
  ['deepseek', (client) => new DeepSeekProvider({ client }), 'deepseek-chat', 'chat'],
  ['gemma', (client) => new GemmaProvider({ client }), 'gemma-4', 'chat'],
  ['qwen chat-completions', (client) => new QwenProvider({ client }), 'qwen3.6-plus', 'chat'],
  [
    'qwen responses',
    (client) => new QwenProvider({ client, builtInWebTools: { webSearch: true } }),
    'qwen3.6-plus',
    'responses',
  ],
];

const CALL_SITES: ReadonlyArray<
  readonly [string, (provider: IChatProvider, options: IChatOptions) => Promise<void>]
> = [
  [
    'chat() without a delta callback (non-streaming request, the forced-summary path)',
    async (provider, options) => {
      await provider.chat(messages, options);
    },
  ],
  [
    'chat() with a delta callback (streaming assembly)',
    async (provider, options) => {
      await provider.chat(messages, { ...options, onTextDelta: () => undefined });
    },
  ],
  [
    'chatStream()',
    async (provider, options) => {
      for await (const _chunk of provider.chatStream(messages, options)) {
        // drain
      }
    },
  ],
];

describe('OpenAI-compatible run AbortSignal on the wire', () => {
  for (const [label, makeProvider, model, endpoint] of PROVIDERS) {
    for (const [callSite, run] of CALL_SITES) {
      it(`${label}: ${callSite} hands the run's own signal to the SDK request`, async () => {
        const { client, chatCreate, responsesCreate } = fakeClient();
        const create = endpoint === 'responses' ? responsesCreate : chatCreate;
        const controller = new AbortController();

        await run(makeProvider(client), { model, signal: controller.signal });

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      });
    }
  }
});
