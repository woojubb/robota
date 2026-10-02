import { describe, expect, it, vi } from 'vitest';
import { ObservableEventService, TOOL_QUEUE_EVENTS } from '@robota-sdk/agent-core';
import { collectSpanEntries } from '../interactive-session-execution.js';

const AT = '2026-10-02T00:00:00.000Z';
describe('content-free queue summary', () => {
  it('aggregates every queue interval without retaining names, arguments, or IDs', () => {
    const bus = new ObservableEventService();
    const onToolCallObserved = vi.fn();
    const collector = collectSpanEntries(bus, { onToolCallObserved });
    for (let index = 0; index < 100; index++) bus.emit(`tool.${TOOL_QUEUE_EVENTS.COMPLETED}`, {
      timestamp: new Date(AT), executionId: `call-${index}`, queuedAt: AT, endedAt: new Date(Date.parse(AT) + index).toISOString(),
      disposition: index === 99 ? 'not-dispatched' : 'admission-started', private: 'never-export-this',
    });
    expect(collector).toHaveProperty('queueSummary', { durationMs: 4950, samples: 100, invalid: 0, admissionStarted: 99, notDispatched: 1 });
    expect(collector.completions).toHaveLength(0);
    expect(onToolCallObserved).not.toHaveBeenCalled();
    expect(JSON.stringify(collector.queueSummary)).not.toMatch(/call-|never-export/);
    collector.dispose();
  });
  it('reports malformed or reversed intervals as unknown and disposes the listener', () => {
    const bus = new ObservableEventService(); const collector = collectSpanEntries(bus);
    bus.emit(`tool.${TOOL_QUEUE_EVENTS.COMPLETED}`, { timestamp: new Date(AT), executionId: 'one', queuedAt: AT, endedAt: 'invalid', disposition: 'admission-started' });
    bus.emit(`tool.${TOOL_QUEUE_EVENTS.COMPLETED}`, { timestamp: new Date(AT), executionId: 'two', queuedAt: AT, endedAt: new Date(Date.parse(AT) - 1).toISOString(), disposition: 'admission-started' });
    bus.emit(`tool.${TOOL_QUEUE_EVENTS.COMPLETED}`, { timestamp: new Date(AT), executionId: 'three', queuedAt: AT, endedAt: AT, disposition: 'effect-completed' });
    expect(collector).toHaveProperty('queueSummary', { durationMs: 0, samples: 0, invalid: 3, admissionStarted: 0, notDispatched: 0 });
    collector.dispose();
    bus.emit(`tool.${TOOL_QUEUE_EVENTS.COMPLETED}`, { timestamp: new Date(AT), executionId: 'late', queuedAt: AT, endedAt: AT, disposition: 'admission-started' });
    expect(collector).toHaveProperty('queueSummary.samples', 0);
  });
});
