/**
 * Trusted `traceparent` on the wire: captured at the SDK's own fetch, for every Gemma Chat
 * Completions call site (non-stream, streaming-assembly, and raw stream).
 */
import OpenAI from 'openai';
import { describe, expect, it } from 'vitest';

import { GemmaProvider } from '../provider';

import type { IChatOptions, IOutboundTraceContext, TUniversalMessage } from '@robota-sdk/agent-core';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

const completion = {
  id: 'c1', object: 'chat.completion', created: 0, model: 'gemma-test',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
};
const completionChunks = [
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemma-test', choices: [{ index: 0, delta: { role: 'assistant', content: 'hi' }, finish_reason: null }] },
  { id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'gemma-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
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
    if (body.stream) {
      return new Response(sse(completionChunks), {
        status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_1' },
      });
    }
    return new Response(JSON.stringify(completion), {
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

/** chat() without and with a delta callback, then chatStream(): every Gemma call site. */
async function everyCallSite(provider: GemmaProvider, options: IChatOptions): Promise<void> {
  await provider.chat(messages, { model: 'gemma-test', ...options });
  await provider.chat(messages, { model: 'gemma-test', onTextDelta: () => undefined, ...options });
  for await (const _chunk of provider.chatStream(messages, { model: 'gemma-test', ...options })) {
    // drain
  }
}

describe('Gemma trusted trace context', () => {
  it('sends traceparent from every call site when the client origin is listed', async () => {
    const { client, seen } = wire('http://localhost:11434/v1');
    const provider = new GemmaProvider({ client });
    const raw: unknown[] = [];
    await everyCallSite(provider, {
      outboundTraceContext: traceTo('http://localhost:11434'),
      onProviderNativeRawPayload: (event) => raw.push(event),
    });
    expect(provider.canPropagateTraceContext()).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);
    expect(raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).not.toContain('traceparent');
    expect(JSON.stringify(raw)).not.toContain(TRACEPARENT);
  });

  it('sends nothing to an unlisted origin', async () => {
    const unlisted = wire('http://localhost:11434/v1');
    await everyCallSite(new GemmaProvider({ client: unlisted.client }), {
      outboundTraceContext: traceTo('https://gateway.example.com'),
    });
    expect(unlisted.seen.map((request) => request.traceparent)).toEqual([null, null, null]);

    const none = wire('http://localhost:11434/v1');
    await everyCallSite(new GemmaProvider({ client: none.client }), {});
    expect(none.seen.map((request) => request.traceparent)).toEqual([null, null, null]);
  });

  it('cannot propagate through an executor or a client whose base URL is unreadable', () => {
    const executor = { name: 'remote', version: '1', executeChat: async () => ({}), supportsTools: () => true, validateConfig: () => true };
    expect(new GemmaProvider({ executor } as never).canPropagateTraceContext()).toBe(false);
    const opaque = { chat: { completions: { create: () => undefined } } } as unknown as OpenAI;
    expect(new GemmaProvider({ client: opaque }).canPropagateTraceContext()).toBe(false);
  });
});
