import { describe, expect, it, vi } from 'vitest';

import { forceSummaryCall } from './execution-forced-summary.js';
import { PROVIDER_CALL_EVENTS } from '../event-service/span-events.js';

describe('forced-summary provider lifecycle', () => {
  it('carries final provider-reported usage separately from its content', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    const addAssistantMessage = vi.fn();
    await forceSummaryCall(
      { getMessages: () => [], addAssistantMessage } as never,
      {
        provider: {
          chat: async () => ({
            role: 'assistant',
            content: 'private summary',
            metadata: { usageProvenance: 'complete' },
            usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
          }),
        },
        currentInfo: { provider: 'anthropic' },
        aiProviderInfo: { model: 'claude-sonnet-4-6' },
      } as never,
      { defaultModel: { model: 'claude-sonnet-4-6' } } as never,
      'execution',
      { currentRound: 3 } as never,
      'conversation',
      {
        onExecutionEvent: (name: string, data: Record<string, unknown>) =>
          events.push({ name, data }),
      } as never,
      { warn: vi.fn() } as never,
    );
    const completion = events.find((event) => event.name === PROVIDER_CALL_EVENTS.COMPLETED)!.data;
    expect(completion).toMatchObject({
      disposition: 'invoked',
      usageProvenance: 'complete',
      promptTokens: 20,
      completionTokens: 5,
      totalTokens: 25,
    });
    expect(addAssistantMessage).toHaveBeenCalledWith(
      'private summary',
      [],
      expect.objectContaining({ inputTokens: 20, outputTokens: 5, totalTokens: 25 }),
    );
    expect(JSON.stringify(completion)).not.toContain('private summary');
  });
  it('carries an adapter-attested providerRequestId for the forced-summary call', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    await forceSummaryCall(
      { getMessages: () => [], addAssistantMessage: vi.fn() } as never,
      {
        provider: {
          chat: async () => ({
            role: 'assistant',
            content: 'private summary',
            metadata: { providerRequestId: 'req_forced_1' },
          }),
        },
        currentInfo: { provider: 'anthropic' },
        aiProviderInfo: { model: 'claude-sonnet-4-6' },
      } as never,
      { defaultModel: { model: 'claude-sonnet-4-6' } } as never,
      'execution',
      { currentRound: 3 } as never,
      'conversation',
      {
        onExecutionEvent: (name: string, data: Record<string, unknown>) =>
          events.push({ name, data }),
      } as never,
      { warn: vi.fn() } as never,
    );
    const completion = events.find((event) => event.name === PROVIDER_CALL_EVENTS.COMPLETED)!.data;
    expect(completion['providerRequestId']).toBe('req_forced_1');
  });
  it('keeps a committed summary as the answer when only announcing it fails', async () => {
    const addAssistantMessage = vi.fn();
    const logger = { warn: vi.fn(), error: vi.fn() };
    const roundState: { currentRound: number; providerFailure?: unknown } = { currentRound: 3 };

    await forceSummaryCall(
      { getMessages: () => [], addAssistantMessage } as never,
      {
        provider: { chat: async () => ({ role: 'assistant', content: 'the summary' }) },
        currentInfo: { provider: 'p' },
        aiProviderInfo: { model: 'm' },
      } as never,
      { defaultModel: { model: 'm' } } as never,
      'execution',
      roundState as never,
      'conversation',
      {
        onExecutionEvent: (name: string) => {
          if (name === 'assistant_message_committed') throw new Error('sink failed');
        },
      } as never,
      logger as never,
    );

    expect(addAssistantMessage).toHaveBeenCalledTimes(1);
    expect(addAssistantMessage).toHaveBeenCalledWith('the summary', [], expect.any(Object));
    expect(roundState.providerFailure).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('Forced summary announcement failed', {
      error: 'sink failed',
    });
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
      const roundState: { currentRound: number; providerFailure?: unknown } = { currentRound: 3 };

      const call = forceSummaryCall(
        { getMessages: () => [], addAssistantMessage } as never,
        {
          provider: { chat },
          currentInfo: { provider: 'private-provider' },
          aiProviderInfo: { model: 'private-model' },
        } as never,
        { defaultModel: { model: 'private-model' } } as never,
        'private-execution',
        roundState as never,
        'private-conversation',
        {
          onExecutionEvent: (name: string, data: Record<string, unknown>) =>
            events.push({ name, data }),
        } as never,
        { warn: vi.fn(), error: vi.fn() } as never,
        2,
      );
      // An aborted summary propagates like an aborted round, so the turn resolves as interrupted.
      if (outcome === 'interrupted')
        await expect(call).rejects.toMatchObject({ name: 'AbortError' });
      else await call;

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
      expect(JSON.stringify(completions[0]!.data)).not.toMatch(
        /private summary|private provider failure/,
      );
      // A failed summary is recorded like a failed round (display text + the thrown value carried
      // out on the round state); an interrupted one leaves the turn to resolve as interrupted.
      expect(addAssistantMessage).toHaveBeenCalledTimes(outcome === 'interrupted' ? 0 : 1);
      if (outcome === 'failure') {
        expect(addAssistantMessage).toHaveBeenCalledWith(
          'Request failed: private provider failure',
          [],
          expect.objectContaining({ providerError: true, forcedSummary: true, round: 3 }),
        );
        expect((roundState.providerFailure as Error).message).toBe('private provider failure');
      } else {
        expect(roundState.providerFailure).toBeUndefined();
      }
    },
  );
});
