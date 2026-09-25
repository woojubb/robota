import { describe, expect, it, vi } from 'vitest';

import { callProviderWithCache } from './execution-round-provider.js';
import { callRoundProviderWithEvents } from './execution-round-streaming.js';

vi.mock('./execution-round-provider.js', () => ({ callProviderWithCache: vi.fn() }));

function runProviderCall() {
  const events: Array<{ name: string; data: Record<string, unknown> }> = [];
  const store = {
    getPendingContent: () => 'private response',
    discardPending: vi.fn(),
    commitAssistant: vi.fn(),
    addAssistantMessage: vi.fn(),
    getMessages: () => [],
  };
  const context = {
    conversationId: 'private-conversation',
    onExecutionEvent: (name: string, data: Record<string, unknown>) => events.push({ name, data }),
  };
  const call = () =>
    callRoundProviderWithEvents(
      [],
      { defaultModel: { model: 'private-model' } } as never,
      { currentInfo: { provider: 'private-provider' }, aiProviderInfo: { model: 'private-model' } } as never,
      undefined,
      context as never,
      store as never,
      2,
      'private-execution',
      'observation-1',
      { error: vi.fn(), warn: vi.fn() } as never,
      vi.fn(),
      vi.fn(),
    );
  return { call, events, store };
}

describe('provider-call completion observations', () => {
  it('emits one content-free lifecycle for an attempted provider round', async () => {
    const response = { role: 'assistant', content: 'private response' };
    vi.mocked(callProviderWithCache).mockResolvedValue(response as never);
    const { call, events } = runProviderCall();
    const result = await call();

    const completions = events.filter((event) => event.name === 'provider_call_completed');
    expect(completions).toHaveLength(1);
    expect(result).toBe(response);
    expect(completions[0]!.data).toMatchObject({
      executionId: 'private-execution',
      round: 2,
      outcome: 'success',
    });
    expect(new Date(completions[0]!.data['startedAt'] as string).getTime()).toBeLessThanOrEqual(
      new Date(completions[0]!.data['endedAt'] as string).getTime(),
    );
    expect(JSON.stringify(completions[0]!.data)).not.toMatch(/private response|private-model|private-provider/);
  });

  it('marks an actual SDK call with a stable id and verified, content-free usage', async () => {
    const response = {
      role: 'assistant',
      content: 'private response',
      metadata: { usageProvenance: 'complete' },
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };
    vi.mocked(callProviderWithCache).mockImplementation(async (...args) => {
      args[7]?.('invoked', 'private-model');
      return response as never;
    });
    const { call, events } = runProviderCall();
    await call();
    const completion = events.find((event) => event.name === 'provider_call_completed')!.data;
    expect(completion).toMatchObject({
      disposition: 'invoked',
      usageProvenance: 'complete',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
    });
    expect(typeof completion['callId']).toBe('string');
    expect(JSON.stringify(completion)).not.toContain('private response');
  });

  it('carries an adapter-attested providerRequestId only for an invoked call', async () => {
    const response = {
      role: 'assistant',
      content: 'private response',
      metadata: { providerRequestId: 'req_abc123' },
    };
    vi.mocked(callProviderWithCache).mockImplementation(async (...args) => {
      args[7]?.('invoked', 'private-model');
      return response as never;
    });
    const { call, events } = runProviderCall();
    await call();
    const completion = events.find((event) => event.name === 'provider_call_completed')!.data;
    expect(completion['providerRequestId']).toBe('req_abc123');
  });

  it('never carries providerRequestId for a cache hit, even if metadata happens to have one', async () => {
    vi.mocked(callProviderWithCache).mockImplementation(async (...args) => {
      args[7]?.('cache-hit', 'private-model');
      return {
        role: 'assistant',
        content: 'private response',
        metadata: { providerRequestId: 'req_should_not_appear' },
      } as never;
    });
    const { call, events } = runProviderCall();
    await call();
    const completion = events.find((event) => event.name === 'provider_call_completed')!.data;
    expect(completion['providerRequestId']).toBeUndefined();
  });

  it('omits providerRequestId when the response metadata value is not a string', async () => {
    vi.mocked(callProviderWithCache).mockImplementation(async (...args) => {
      args[7]?.('invoked', 'private-model');
      return {
        role: 'assistant',
        content: 'private response',
        metadata: { providerRequestId: 42 },
      } as never;
    });
    const { call, events } = runProviderCall();
    await call();
    const completion = events.find((event) => event.name === 'provider_call_completed')!.data;
    expect(completion['providerRequestId']).toBeUndefined();
  });

  it('does not call a cache hit or preflight refusal an SDK invocation', async () => {
    vi.mocked(callProviderWithCache).mockImplementation(async (...args) => {
      args[7]?.('cache-hit', 'private-model');
      return { role: 'assistant', content: 'private response' } as never;
    });
    const cache = runProviderCall();
    await cache.call();
    expect(cache.events.find((event) => event.name === 'provider_call_completed')!.data).toMatchObject({
      disposition: 'cache-hit',
      usageProvenance: 'absent',
    });

    vi.mocked(callProviderWithCache).mockRejectedValueOnce(new Error('preflight'));
    const refused = runProviderCall();
    await refused.call();
    expect(refused.events.find((event) => event.name === 'provider_call_completed')!.data).toMatchObject({
      disposition: 'preflight-refused',
      usageProvenance: 'absent',
    });
  });
});
