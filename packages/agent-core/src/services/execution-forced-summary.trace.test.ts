import { describe, expect, it, vi } from 'vitest';

import { forceSummaryCall } from './execution-forced-summary.js';
import { PROVIDER_CALL_EVENTS } from '../event-service/span-events.js';

describe('forced-summary provider lifecycle', () => {
  it('carries final provider-reported usage separately from its content', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    await forceSummaryCall(
      { getMessages: () => [], addAssistantMessage: vi.fn() } as never,
      { provider: { chat: async () => ({ role: 'assistant', content: 'private summary', metadata: { usageProvenance: 'complete', inputTokens: 20, outputTokens: 5 } }) }, currentInfo: { provider: 'anthropic' }, aiProviderInfo: { model: 'claude-sonnet-4-6' } } as never,
      { defaultModel: { model: 'claude-sonnet-4-6' } } as never,
      'execution', { currentRound: 3 } as never, 'conversation',
      { onExecutionEvent: (name: string, data: Record<string, unknown>) => events.push({ name, data }) } as never,
      { warn: vi.fn() } as never,
    );
    const completion = events.find((event) => event.name === PROVIDER_CALL_EVENTS.COMPLETED)!.data;
    expect(completion).toMatchObject({ disposition: 'invoked', usageProvenance: 'complete', promptTokens: 20, completionTokens: 5, totalTokens: 25 });
    expect(JSON.stringify(completion)).not.toContain('private summary');
  });
  it.each(['success', 'failure', 'interrupted'] as const)(
    'records a content-free %s completion for the actual summary call',
    async (outcome) => {
      const events: Array<{ name: string; data: Record<string, unknown> }> = [];
      const chat = async () => {
        if (outcome === 'failure') throw new Error('private provider failure');
        if (outcome === 'interrupted') throw new DOMException('Aborted', 'AbortError');
        return { role: 'assistant', content: 'private summary', metadata: {} };
      };
      const addAssistantMessage = vi.fn();

      await forceSummaryCall(
        { getMessages: () => [], addAssistantMessage } as never,
        {
          provider: { chat },
          currentInfo: { provider: 'private-provider' },
          aiProviderInfo: { model: 'private-model' },
        } as never,
        { defaultModel: { model: 'private-model' } } as never,
        'private-execution',
        { currentRound: 3 } as never,
        'private-conversation',
        {
          onExecutionEvent: (name: string, data: Record<string, unknown>) =>
            events.push({ name, data }),
        } as never,
        { warn: vi.fn() } as never,
        2,
      );

      const completions = events.filter((event) => event.name === PROVIDER_CALL_EVENTS.COMPLETED);
      expect(completions).toHaveLength(1);
      expect(completions[0]!.data).toMatchObject({ round: 3, outcome });
      expect(completions[0]!.data).toMatchObject({
        disposition: 'invoked',
        usageProvenance: 'absent',
        providerId: 'private-provider',
        modelId: 'private-model',
      });
      expect(typeof completions[0]!.data['callId']).toBe('string');
      expect(JSON.stringify(completions[0]!.data)).not.toMatch(/private summary|private provider failure/);
      expect(addAssistantMessage).toHaveBeenCalledTimes(outcome === 'success' ? 1 : 0);
    },
  );
});
