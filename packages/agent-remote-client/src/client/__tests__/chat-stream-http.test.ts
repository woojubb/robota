import { describe, expect, it, vi } from 'vitest';

import { HttpClient } from '../http-client';

const SERVER_MODEL_EFFORT_OUTCOME = {
  resolution: {
    selection: 'high' as const,
    effective: 'high' as const,
    disposition: 'exact' as const,
    fingerprint: 'gpt-5.1|high|high|exact|responses.reasoning.effort|2026-09-11',
  },
  nativeControl: { state: 'sent' as const, id: 'responses.reasoning.effort' },
  providerDispatch: { state: 'sent' as const },
};

describe('remote streaming model-effort outcome transport (API-001)', () => {
  it('preserves the one server outcome frame after deltas and the terminal message', async () => {
    const sse = [
      'event: delta\ndata: {"text":"Hel"}\n\n',
      'event: message\ndata: {"role":"assistant","content":"Hello"}\n\n',
      `event: model-effort-outcome\ndata: ${JSON.stringify(SERVER_MODEL_EFFORT_OUTCOME)}\n\n`,
      'event: done\ndata: [DONE]\n\n',
    ].join('');
    const response = {
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        },
      }),
    };
    const fetchMock = vi.fn().mockResolvedValue(response);
    global.fetch = fetchMock;
    const httpClient = new HttpClient({
      baseUrl: 'https://api.test.com',
      timeout: 30_000,
      headers: { Authorization: 'Bearer test-key' },
    });
    const deltas: string[] = [];

    const result = await httpClient.chatStream(
      [{ role: 'user', content: 'Hi' }],
      'openai',
      'gpt-5.1',
      (delta) => deltas.push(delta),
      undefined,
      { effort: 'high' },
    );

    expect(deltas).toEqual(['Hel']);
    expect(result.content).toBe('Hello');
    expect(result.modelEffortOutcome).toEqual(SERVER_MODEL_EFFORT_OUTCOME);
  });
});
