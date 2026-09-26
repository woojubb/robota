/**
 * The run's `AbortSignal` reaches the SDK request on every call site of both API surfaces
 * (agent-core SPEC, Cancellation Contract). The non-streaming Chat Completions path is the one the
 * forced summary takes, and it used to send no signal, so an aborted run left that request running.
 */
import { createServer } from 'node:http';

import { classifyProviderFailure } from '@robota-sdk/agent-core';
import { APIUserAbortError } from 'openai';
import { describe, expect, it, vi } from 'vitest';

import { OpenAIProvider } from '../provider';

import type { IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import type { AddressInfo } from 'node:net';
import type OpenAI from 'openai';

const completion = {
  id: 'c1',
  object: 'chat.completion',
  created: 0,
  model: 'gpt-test',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
};
const completionChunks = [
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-test',
    choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }],
  },
  {
    id: 'c1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-test',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  },
];
const response = {
  id: 'resp_1',
  object: 'response',
  created_at: 0,
  model: 'gpt-test',
  status: 'completed',
  output: [
    {
      type: 'message',
      id: 'msg_1',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'hi', annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};
const responseEvents = [
  {
    type: 'response.output_text.delta',
    item_id: 'msg_1',
    output_index: 0,
    content_index: 0,
    delta: 'hi',
    sequence_number: 1,
  },
  { type: 'response.completed', response, sequence_number: 2 },
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

const CALL_SITES: ReadonlyArray<
  readonly [string, (provider: OpenAIProvider, options: IChatOptions) => Promise<void>]
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

describe('OpenAI run AbortSignal on the wire', () => {
  for (const apiSurface of ['chat-completions', 'responses'] as const) {
    for (const [callSite, run] of CALL_SITES) {
      it(`${apiSurface}: ${callSite} hands the run's own signal to the SDK request`, async () => {
        const { client, chatCreate, responsesCreate } = fakeClient();
        const create = apiSurface === 'responses' ? responsesCreate : chatCreate;
        const controller = new AbortController();

        await run(new OpenAIProvider({ client, apiSurface }), {
          model: 'gpt-test',
          signal: controller.signal,
        });

        expect(create).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      });
    }
  }

  it('closes the HTTP request when the run aborts a non-streaming Chat Completions call', async () => {
    const server = await startUnansweringServer();
    let bound: ReturnType<typeof setTimeout> | undefined;
    try {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: server.baseURL,
        apiSurface: 'chat-completions',
      });
      const controller = new AbortController();
      const pending = provider.chat(messages, { model: 'gpt-test', signal: controller.signal });
      const outcome = pending.then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );

      await server.requestReceived;
      controller.abort();

      // The server never answers, so only the client hanging up can close the request. Without the
      // signal it stays open until the SDK's own 10-minute timeout; the bound only decides failure.
      const closed = await Promise.race([
        server.clientHungUp.then(() => 'closed' as const),
        new Promise<'still open'>((resolve) => {
          bound = setTimeout(() => resolve('still open'), 2_000);
        }),
      ]);
      expect(closed).toBe('closed');

      // The SDK's own abort error, passed through rather than wrapped as a provider failure, so the
      // run layer classifies it as an interruption — without needing the signal to tell it so.
      const error = await outcome;
      expect(error).toBeInstanceOf(APIUserAbortError);
      expect(classifyProviderFailure(error)).toEqual({ switchable: false, reason: 'aborted' });
    } finally {
      clearTimeout(bound);
      await server.close();
    }
  });
});

/** A local endpoint that accepts a request and never answers it, reporting when the client hangs up. */
async function startUnansweringServer(): Promise<{
  baseURL: string;
  requestReceived: Promise<void>;
  clientHungUp: Promise<void>;
  close: () => Promise<void>;
}> {
  let onRequest!: () => void;
  let onHangUp!: () => void;
  const requestReceived = new Promise<void>((resolve) => (onRequest = resolve));
  const clientHungUp = new Promise<void>((resolve) => (onHangUp = resolve));
  const server = createServer((request, reply) => {
    request.resume();
    reply.on('close', () => {
      if (!reply.writableEnded) onHangUp();
    });
    onRequest();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requestReceived,
    clientHungUp,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
