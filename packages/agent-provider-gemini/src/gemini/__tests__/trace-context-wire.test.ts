/**
 * Trusted `traceparent` on the wire: captured at the fetch the Gemini SDK itself calls, for every
 * call site, and never in the captured raw request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GeminiProvider } from '../provider';

import type { IChatOptions, IOutboundTraceContext, TUniversalMessage } from '@robota-sdk/agent-core';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

const chunk = {
  candidates: [{ content: { role: 'model', parts: [{ text: 'hi' }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  responseId: 'resp_1',
};

let seen: Array<{ url: string; traceparent: string | null; apiKey: string | null }> = [];

beforeEach(() => {
  seen = [];
  vi.stubEnv('GOOGLE_GEMINI_BASE_URL', undefined);
  vi.stubEnv('GOOGLE_VERTEX_BASE_URL', undefined);
  vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', undefined);
  vi.stubEnv('GOOGLE_GENAI_USE_ENTERPRISE', undefined);
  vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(url), traceparent: headers.get('traceparent'), apiKey: headers.get('x-goog-api-key') });
    if (String(url).includes('streamGenerateContent')) {
      return new Response(`data: ${JSON.stringify(chunk)}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response(JSON.stringify(chunk), { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const messages: TUniversalMessage[] = [{ id: 'u1', role: 'user', content: 'hello', state: 'complete', timestamp: new Date() }];

function traceTo(...allowedOrigins: string[]): IOutboundTraceContext {
  return { traceparent: TRACEPARENT, allowedOrigins };
}

/** chat() without and with a delta callback, then chatStream(): every call site. */
async function everyCallSite(provider: GeminiProvider, options: IChatOptions): Promise<void> {
  await provider.chat(messages, { model: 'gemini-test', ...options });
  await provider.chat(messages, { model: 'gemini-test', onTextDelta: () => undefined, ...options });
  for await (const _chunk of provider.chatStream(messages, { model: 'gemini-test', ...options })) {
    // drain
  }
}

describe('Gemini trusted trace context', () => {
  it('sends traceparent from every call site when the Gemini API origin is listed', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key' });
    const raw: unknown[] = [];
    await everyCallSite(provider, {
      outboundTraceContext: traceTo(GEMINI_ORIGIN),
      onProviderNativeRawPayload: (event) => raw.push(event),
    });
    expect(provider.canPropagateTraceContext()).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen.map((request) => request.traceparent)).toEqual([TRACEPARENT, TRACEPARENT, TRACEPARENT]);
    // Per-call headers merge with, and do not replace, the SDK's own authentication.
    expect(seen.every((request) => request.apiKey === 'test-key')).toBe(true);
    expect(raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).not.toContain('traceparent');
    expect(JSON.stringify(raw)).not.toContain(TRACEPARENT);
  });

  it('sends nothing when the Gemini API origin is not listed, or without a trace context', async () => {
    await everyCallSite(new GeminiProvider({ apiKey: 'test-key' }), { outboundTraceContext: traceTo('https://gateway.example.com') });
    await everyCallSite(new GeminiProvider({ apiKey: 'test-key' }), {});
    expect(seen.map((request) => request.traceparent)).toEqual([null, null, null, null, null, null]);
  });

  it('cannot propagate with a base-URL override, in Vertex mode, or through an executor', async () => {
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com');
    const overridden = new GeminiProvider({ apiKey: 'test-key' });
    expect(overridden.canPropagateTraceContext()).toBe(false);
    await everyCallSite(overridden, { outboundTraceContext: traceTo(GEMINI_ORIGIN) });
    expect(seen.map((request) => request.traceparent)).toEqual([null, null, null]);
    vi.stubEnv('GOOGLE_GEMINI_BASE_URL', undefined);

    vi.stubEnv('GOOGLE_VERTEX_BASE_URL', 'https://vertex.example.com');
    expect(new GeminiProvider({ apiKey: 'test-key' }).canPropagateTraceContext()).toBe(false);
    vi.stubEnv('GOOGLE_VERTEX_BASE_URL', undefined);

    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', 'true');
    expect(new GeminiProvider({ apiKey: 'test-key' }).canPropagateTraceContext()).toBe(false);
    vi.stubEnv('GOOGLE_GENAI_USE_VERTEXAI', undefined);

    const executor = { name: 'remote', version: '1', executeChat: async () => ({}), supportsTools: () => true, validateConfig: () => true };
    expect(new GeminiProvider({ executor } as never).canPropagateTraceContext()).toBe(false);
  });
});
