import { describe, expect, it, vi } from 'vitest';

import { SessionHistoryTracker } from '../interactive-session-history-tracker.js';

import type { IMemoryEvent } from '../../memory/automatic-memory-types.js';

function createTracker(): {
  tracker: SessionHistoryTracker;
  emitMemoryEvent: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
} {
  const emitMemoryEvent = vi.fn();
  const persist = vi.fn();
  const tracker = new SessionHistoryTracker(
    '/workspace',
    () => 'test-session',
    () => false,
    persist,
    vi.fn(),
    emitMemoryEvent,
  );
  return { tracker, emitMemoryEvent, persist };
}

function makeEvent(type: IMemoryEvent['type']): IMemoryEvent {
  return { type, at: '2026-06-11T00:00:00.000Z', topic: 'build commands', candidateId: 'c1' };
}

describe('SessionHistoryTracker — memory events', () => {
  it('TC-01: saved event appends a visible history entry and emits', () => {
    const { tracker, emitMemoryEvent, persist } = createTracker();
    tracker.recordMemoryEvent(makeEvent('memory_candidate_saved'));

    const entries = tracker.getState().history;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ category: 'event', type: 'memory-event' });
    const message = (entries[0]?.data as { message?: string }).message;
    expect(typeof message).toBe('string');
    expect(message?.length).toBeGreaterThan(0);
    expect(emitMemoryEvent).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalled();
  });

  it.each(['memory_candidate_approved', 'memory_candidate_rejected', 'memory_retrieved'] as const)(
    'TC-01: %s is a visible type with a history entry',
    (type) => {
      const { tracker } = createTracker();
      tracker.recordMemoryEvent(makeEvent(type));
      expect(tracker.getState().history).toHaveLength(1);
    },
  );

  it.each([
    'memory_candidate_extracted',
    'memory_candidate_queued',
    'memory_candidate_skipped',
  ] as const)('TC-02: internal type %s does not append history but still emits', (type) => {
    const { tracker, emitMemoryEvent } = createTracker();
    tracker.recordMemoryEvent(makeEvent(type));
    expect(tracker.getState().history).toHaveLength(0);
    expect(tracker.getState().memoryEvents).toHaveLength(1);
    expect(emitMemoryEvent).toHaveBeenCalledTimes(1);
  });
});
