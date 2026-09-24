/**
 * Trusted `traceparent` on the wire: captured at the SDK's own fetch, for every call site.
 */
import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../provider';

import type { IChatOptions, IOutboundTraceContext, TUniversalMessage } from '@robota-sdk/agent-core';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

function sse(): string {
  const events = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ] as const;
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('');
}

function wire(baseURL?: string) {
  const seen: Array<{ url: string; traceparent: string | null }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    seen.push({ url: String(url), traceparent: new Headers(init?.headers).get('traceparent') });
    return new Response(sse(), { status: 200, headers: { 'content-type': 'text/event-stream', 'request-id': 'req_1' } });
  };
  const client = new Anthropic({ apiKey: 'test-key', ...(baseURL ? { baseURL } : {}), fetch, maxRetries: 0 });
  return { client, seen };
}

const messages: TUniversalMessage[] = [{ id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() }];

function traceTo(...allowedOrigins: string[]): IOutboundTraceContext {
  return { traceparent: TRACEPARENT, allowedOrigins };
}

async function everyCallSite(provider: AnthropicProvider, options: IChatOptions): Promise<void> {
  await provider.chat(messages, { model: 'claude-test', ...options });
  for await (const _chunk of provider.chatStream(messages, { model: 'claude-test', ...options })) {
    // drain
  }
}

describe('Anthropic trusted trace context', () => {
  it('sends traceparent from chat and chatStream when the client origin is listed', async () => {
    const { client, seen } = wire('https://gateway.example.com/anthropic');
    const provider = new AnthropicProvider({ client });
    const raw: unknown[] = [];
    await everyCallSite(provider, {
      outboundTraceContext: traceTo('https://gateway.example.com'),
      onProviderNativeRawPayload: (event) => raw.push(event),
    });
    expect(provider.canPropagateTraceContext()).toBe(true);
    expect(seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT]);
    expect(raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).not.toContain('traceparent');
    expect(JSON.stringify(raw)).not.toContain(TRACEPARENT);
  });

  it('sends nothing to the default vendor origin unless it is listed', async () => {
    const unlisted = wire();
    await everyCallSite(new AnthropicProvider({ client: unlisted.client }), {
      outboundTraceContext: traceTo('https://gateway.example.com'),
    });
    expect(unlisted.seen.map((request) => request.traceparent)).toEqual([null, null]);

    const listed = wire();
    await everyCallSite(new AnthropicProvider({ client: listed.client }), {
      outboundTraceContext: traceTo('https://api.anthropic.com'),
    });
    expect(listed.seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT]);
  });

  it('sends nothing without an outbound trace context', async () => {
    const { client, seen } = wire();
    await everyCallSite(new AnthropicProvider({ client }), {});
    expect(seen.map((request) => request.traceparent)).toEqual([null, null]);
  });

  it('cannot propagate through an executor or a client whose base URL is unreadable', () => {
    const executor = { name: 'remote', version: '1', executeChat: async () => ({}), supportsTools: () => true, validateConfig: () => true };
    expect(new AnthropicProvider({ executor } as never).canPropagateTraceContext()).toBe(false);
    const opaque = { messages: { create: () => undefined } } as unknown as Anthropic;
    expect(new AnthropicProvider({ client: opaque }).canPropagateTraceContext()).toBe(false);
  });
});
