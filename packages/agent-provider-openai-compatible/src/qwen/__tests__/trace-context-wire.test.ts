/**
 * Trusted `traceparent` on the wire: captured at the SDK's own fetch, for every Qwen call site on
 * both API surfaces (Chat Completions, and Responses when built-in web tools select it).
 */
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { DEFAULT_QWEN_PROVIDER_BASE_URL, DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL } from '../defaults';
import { QwenProvider } from '../provider';

import type { IChatOptions, IOutboundTraceContext, TUniversalMessage } from '@robota-sdk/agent-core';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const completion = {
  id: 'c1', object: 'chat.completion', created: 0, model: 'qwen-test',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
};
const completionChunks = [
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'qwen-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }] },
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'qwen-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
];
const response = {
  id: 'resp_1', model: 'qwen-test', status: 'completed',
  output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
};
const responseEvents = [
  { type: 'response.output_text.delta', delta: 'hi' },
  { type: 'response.completed', response },
];

function sse(events: readonly object[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function wire(baseURL?: string) {
  const seen: Array<{ url: string; traceparent: string | null }> = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = String(url);
    seen.push({ url: target, traceparent: new Headers(init?.headers as HeadersInit).get('traceparent') });
    const body = JSON.parse(String(init?.body)) as { stream?: boolean };
    const isResponses = target.includes('/responses');
    if (body.stream) {
      return new Response(sse(isResponses ? responseEvents : completionChunks), {
        status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_1' },
      });
    }
    return new Response(JSON.stringify(isResponses ? response : completion), {
      status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req_1' },
    });
  };
  const client = new OpenAI({ apiKey: 'test-key', ...(baseURL ? { baseURL } : {}), fetch: fetch as never, maxRetries: 0 });
  return { client, seen };
}

const messages: TUniversalMessage[] = [{ id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() }];

function traceTo(...allowedOrigins: string[]): IOutboundTraceContext {
  return { traceparent: TRACEPARENT, allowedOrigins };
}

/** chat() without and with a delta callback, then chatStream(): every call site of one surface. */
async function everyCallSite(provider: QwenProvider, options: IChatOptions): Promise<void> {
  await provider.chat(messages, { model: 'qwen-test', ...options });
  await provider.chat(messages, { model: 'qwen-test', onTextDelta: () => undefined, ...options });
  for await (const _chunk of provider.chatStream(messages, { model: 'qwen-test', ...options })) {
    // drain
  }
}

describe('Qwen trusted trace context', () => {
  describe('chat-completions surface', () => {
    it('sends traceparent from every call site when the client origin is listed', async () => {
      const { client, seen } = wire('https://gateway.example.com/v1');
      const provider = new QwenProvider({ client });
      const raw: unknown[] = [];
      await everyCallSite(provider, {
        outboundTraceContext: traceTo('https://gateway.example.com'),
        onProviderNativeRawPayload: (event) => raw.push(event),
      });
      expect(provider.canPropagateTraceContext()).toBe(true);
      expect(seen).toHaveLength(3);
      expect(seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);
      expect(raw.length).toBeGreaterThan(0);
      expect(JSON.stringify(raw)).not.toContain('traceparent');
      expect(JSON.stringify(raw)).not.toContain(TRACEPARENT);
    });

    it('sends nothing to the default vendor origin unless it is listed', async () => {
      const unlisted = wire();
      await everyCallSite(new QwenProvider({ client: unlisted.client }), {
        outboundTraceContext: traceTo('https://gateway.example.com'),
      });
      expect(unlisted.seen.map((request) => request.traceparent)).toEqual([null, null, null]);

      const listed = wire(DEFAULT_QWEN_PROVIDER_BASE_URL);
      await everyCallSite(new QwenProvider({ client: listed.client }), {
        outboundTraceContext: traceTo(new URL(DEFAULT_QWEN_PROVIDER_BASE_URL).origin),
      });
      expect(listed.seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);

      const none = wire();
      await everyCallSite(new QwenProvider({ client: none.client }), {});
      expect(none.seen.map((request) => request.traceparent)).toEqual([null, null, null]);
    });
  });

  describe('responses surface (built-in web tools)', () => {
    /** chat() without and with a delta callback, then chatStream(): every Responses call site. */
    async function everyResponsesCallSite(provider: QwenProvider, options: IChatOptions): Promise<void> {
      await provider.chat(messages, { model: 'qwen-test', ...options });
      await provider.chat(messages, { model: 'qwen-test', onTextDelta: () => undefined, ...options });
      for await (const _chunk of provider.chatStream(messages, { model: 'qwen-test', ...options })) {
        // drain
      }
    }

    it('sends traceparent from every Responses call site when the client origin is listed', async () => {
      const { client, seen } = wire('https://gateway.example.com/v1');
      const provider = new QwenProvider({ client, builtInWebTools: { webSearch: true } });
      const raw: unknown[] = [];
      await everyResponsesCallSite(provider, {
        outboundTraceContext: traceTo('https://gateway.example.com'),
        onProviderNativeRawPayload: (event) => raw.push(event),
      });
      expect(seen).toHaveLength(3);
      expect(seen.every((request) => request.url.includes('/responses'))).toBe(true);
      expect(seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);
      expect(raw.length).toBeGreaterThan(0);
      expect(JSON.stringify(raw)).not.toContain('traceparent');
      expect(JSON.stringify(raw)).not.toContain(TRACEPARENT);
    });

    it('sends nothing to the default vendor Responses origin unless it is listed', async () => {
      const unlisted = wire();
      await everyResponsesCallSite(
        new QwenProvider({ client: unlisted.client, builtInWebTools: { webSearch: true } }),
        { outboundTraceContext: traceTo('https://gateway.example.com') },
      );
      expect(unlisted.seen.map((request) => request.traceparent)).toEqual([null, null, null]);

      const listed = wire(DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL);
      await everyResponsesCallSite(
        new QwenProvider({ client: listed.client, builtInWebTools: { webSearch: true } }),
        { outboundTraceContext: traceTo(new URL(DEFAULT_QWEN_PROVIDER_RESPONSES_BASE_URL).origin) },
      );
      expect(listed.seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);

      const none = wire();
      await everyResponsesCallSite(
        new QwenProvider({ client: none.client, builtInWebTools: { webSearch: true } }),
        {},
      );
      expect(none.seen.map((request) => request.traceparent)).toEqual([null, null, null]);
    });
  });

  it('cannot propagate through an executor or a client whose base URL is unreadable', () => {
    const executor = { name: 'remote', version: '1', executeChat: async () => ({}), supportsTools: () => true, validateConfig: () => true };
    expect(new QwenProvider({ executor } as never).canPropagateTraceContext()).toBe(false);
    const opaque = { chat: { completions: { create: () => undefined } }, responses: { create: () => undefined } } as unknown as OpenAI;
    expect(new QwenProvider({ client: opaque }).canPropagateTraceContext()).toBe(false);
  });
});
