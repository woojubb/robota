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
});
