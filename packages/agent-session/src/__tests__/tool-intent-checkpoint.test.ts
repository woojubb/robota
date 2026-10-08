import { describe, expect, it, vi } from 'vitest';

import { createRunObservers } from '../session-run-observation.js';

describe('pre-effect history checkpoints', () => {
  it('saves user input and assistant tool intent synchronously at their append boundaries', () => {
    const checkpointHistory = vi.fn();
    const ctx = {
      knownToolNames: [], checkpointHistory, log: vi.fn(),
      agent: { getHistory: () => [] },
      contextTracker: { updateFromHistory: vi.fn(), getContextState: () => ({}) },
    } as never;
    const observe = createRunObservers(ctx).onExecutionEvent!;
    observe('history_mutation', { mutation: 'append_message', message: { role: 'user', content: 'run once' } });
    observe('history_mutation', { mutation: 'append_message', message: {
      role: 'assistant', toolCalls: [{ id: 'original', function: { name: 'Shell', arguments: '{}' } }],
    } });
    expect(checkpointHistory).toHaveBeenCalledTimes(2);
  });

  it('does not advance past a failed pre-effect save', () => {
    const observe = createRunObservers({
      knownToolNames: [], log: vi.fn(), checkpointHistory: () => { throw new Error('save failed'); },
    } as never).onExecutionEvent!;
    expect(() => observe('history_mutation', { mutation: 'append_message', message: {
      role: 'assistant', toolCalls: [{ id: 'original', function: { name: 'Shell', arguments: '{}' } }],
    } })).toThrow('save failed');
  });
});
