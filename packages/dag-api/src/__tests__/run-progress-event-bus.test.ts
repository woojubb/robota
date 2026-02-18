import { describe, expect, it, vi } from 'vitest';
import { EXECUTION_PROGRESS_EVENTS, type TRunProgressEvent } from '@robota-sdk/dag-core';
import { RunProgressEventBus } from '../composition/run-progress-event-bus.js';

function createStartedEvent(): TRunProgressEvent {
    return {
        dagRunId: 'run-test-1',
        eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
        occurredAt: '2026-02-18T00:00:00.000Z',
        dagId: 'dag-test-1',
        version: 1
    };
}

describe('RunProgressEventBus', () => {
    it('keeps publishing when one listener throws', () => {
        const bus = new RunProgressEventBus();
        const healthyListener = vi.fn();
        bus.subscribe(() => {
            throw new Error('listener failure');
        });
        bus.subscribe(healthyListener);

        expect(() => bus.publish(createStartedEvent())).not.toThrow();
        expect(healthyListener).toHaveBeenCalledTimes(1);
    });

    it('removes failed listener after throw', () => {
        const bus = new RunProgressEventBus();
        const flaky = vi.fn(() => {
            throw new Error('listener failure');
        });
        const healthy = vi.fn();
        bus.subscribe(flaky);
        bus.subscribe(healthy);

        bus.publish(createStartedEvent());
        bus.publish(createStartedEvent());

        expect(flaky).toHaveBeenCalledTimes(1);
        expect(healthy).toHaveBeenCalledTimes(2);
    });
});
